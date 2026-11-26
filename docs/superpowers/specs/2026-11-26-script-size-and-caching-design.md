# Caching the built files, and the size of the script: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). Two items from the backlog: "The script is downloaded again after every deploy" (Pages and routing) and "Bundle size" (Error reporting).

## Intent

The tuner's script is 512 kB, about 166 kB compressed. A visitor should download it once and keep it for as long as it has not changed, and it should be no bigger than it has to be. This design is mostly measurement: what a browser transfers today, what would change that, and which changes are worth their cost.

## What was found first

Measured on the live site with `curl -sI` and in headless Chrome, read in Vercel's documentation, in `repos/foldkit/packages/vite-plugin-foldkit/src/` and in the installed Sentry packages, and tried in builds of a copy of the project.

### What a browser transfers today

- **Every file is served `Cache-Control: public, max-age=0, must-revalidate`,** the hashed ones included. That is Vercel's default for a static file.
- **A first visit** made 5 requests and transferred 184,428 bytes: the page 4,039, the stylesheet 6,262, the script 170,769, Vercel's analytics script 2,341, the icon 1,017.
- **A repeat visit** made 4 requests and transferred 297 bytes. The page, the stylesheet, the script and the icon were each asked for again and each answered `304 Not Modified`. So nothing is downloaded twice, but nothing is used without asking either: the script does not start until its question has been answered (17 ms from this machine, a round trip of a phone's connection for a visitor).
- **Vercel sends the script to Chrome as Brotli, and bigger than gzip would be:** 170,769 bytes, where gzip at its usual setting gives 164,778. Vercel compresses as it serves, at a low setting. Brotli at its highest would give 143,015. A static project cannot upload a compressed copy of its own.

### How Vercel's header rules combine

- Every rule in `headers` whose `source` and conditions fit a request is applied, not only the first (the documentation for `vercel.json`, "Routes vs higher-level properties": with `headers` continuing past a match "is the default behavior"). Its own example is the rule wanted here: `/assets/(.*)` with `public, max-age=31556952, immutable`.
- A `Cache-Control` set by a rule takes the place of Vercel's default on the responses the rule fits: the documentation's examples set it this way for static files. The default stays on every response no rule touches, so a page keeps `max-age=0, must-revalidate`.
- For hashed files the documentation recommends `max-age=31536000, immutable` ("Cache-Control headers", the table of recommended settings).
- **A rule is applied to a 404 as well.** The live site's answer for a file that does not exist carries the Content Security Policy, which comes from a rule. So the new rule will very probably mark a missing file under `/assets/` as cacheable for a year too. Not confirmed: it needs the rule deployed, and previews are behind Vercel's sign-in.

### The script's name, and what changes it

The backlog said the name changes because of Foldkit's build id. That is one of three reasons.

- **Foldkit's build id.** `foldkit()` generates a random id for each build (`buildToken.ts`, `randomUUID()`) and compiles it into the script and onto each page's root element. `Runtime.hydrate` compares the two and refuses a page from another build. The plugin does accept an id from the app: the `buildId` option of `foldkit()`, or the `FOLDKIT_BUILD_ID` environment variable. Tried: with a fixed id, two builds gave the same script and the same pages, byte for byte.
- **Sentry's release.** On a Vercel build the Sentry plugin writes `SENTRY_RELEASE={id:"<the commit>"}` at the top of the script (read in the live script, and in the plugin's `renderChunk`). The commit is new on every deploy, so the script is too. The plugin's own documentation for `release.inject` says so, and offers two ways out: `'html'`, which needs an `index.html` this project does not have and an inline script the Content Security Policy refuses, or `false`, with the release handed to `Sentry.init` from somewhere outside the script.
- **The stylesheet.** Vite gives the script a new name when the stylesheet changes, although the script's bytes are the same (tried: three builds, one script by its SHA-256, three names). And the stylesheet changed whenever a document gained a word that is also a Tailwind utility, because Tailwind scanned the documents.

### Where the script's bytes are

By source map, in bytes of the minified script (504 kB of the 512 kB is attributed):

| Part                                                      | kB    | Share |
| --------------------------------------------------------- | ----- | ----- |
| Effect                                                    | 153.8 | 30.5% |
| Foldkit                                                   | 150.2 | 29.8% |
| Sentry (`core` 65.7, `browser` 17.4, `browser-utils` 7.2) | 90.6  | 18.0% |
| Foldkit UI                                                | 47.3  | 9.4%  |
| The app itself                                            | 42.2  | 8.4%  |
| Floating UI (used by Foldkit UI)                          | 17.3  | 3.4%  |
| Vercel Analytics                                          | 1.9   | 0.4%  |

### What the Sentry switches save

All with the same build id, so the numbers compare. Raw and gzip as Vite prints them.

| Build                                                   | Raw       | gzip      | Saved                 |
| ------------------------------------------------------- | --------- | --------- | --------------------- |
| As it is                                                | 512.12 kB | 165.76 kB |                       |
| Debug statements out (`__SENTRY_DEBUG__: false`)        | 506.82 kB | 163.89 kB | 5.30 kB, 1.87 kB gzip |
| Tracing out (`__SENTRY_TRACING__: false`)               | 511.97 kB | 165.72 kB | 0.15 kB, 0.04 kB gzip |
| Both                                                    | 506.67 kB | 163.85 kB | 5.45 kB, 1.91 kB gzip |
| The four replay switches as well                        | 506.67 kB | 163.85 kB | nothing more          |
| An explicit list of integrations given to `Sentry.init` | 512.09 kB | 165.73 kB | 27 bytes              |

- **The plugin's `bundleSizeOptimizations` option does nothing in a build that does not upload.** With `disable: true` the plugin is replaced by an empty one, and the option goes with it. This project disables the plugin everywhere but on Vercel. So the option would trim the live script and no other: not a local build, not the one a browser check runs against. What the option does is replace a flag in the SDK's code, and Vite's `define` does the same in every build. The numbers above were made that way.
- **The replay switches save nothing** because no replay code is in the script: it is never imported.
- **An explicit list saves nothing** because `Sentry.init` names every default integration itself (`getDefaultIntegrations` in the SDK's `sdk.js`), so the bundler keeps them all whatever list is passed. Leaving `BrowserSession` out of the script would mean not calling `Sentry.init` and assembling the client by hand. That integration is 485 bytes. One default, `conversationIdIntegration`, is not exported by `@sentry/browser`, so a hand-written list could not even name the same set.

## Goals

- A returning visitor's browser uses the script and the stylesheet it already has without asking the server.
- A page is still checked with the server on every visit, so a deploy reaches everyone on their next visit.
- The numbers above are on record, so the next person does not measure them again.
- Reports to Sentry are exactly what they were.

## Not goals

- Moving pitch detection off the main thread, lazy loading, changing or removing a dependency (given).
- Changing anything in Vercel, Sentry or 1Password (given).
- A smaller Effect or Foldkit share. That is 60% of the script and is not this work.

## Approaches

### Caching the hashed files

1. **A header rule for `/assets/(.*)` in `vercel.json`: `public, max-age=31536000, immutable` (chosen, given).** A file under `/assets/` has a hash of its contents in its name, so a name never comes to mean different bytes. It is the rule Vercel's documentation shows.
2. **A shorter time,** a day or a week. It would bound the harm of a cached 404 (below), and would bring the 304s back for anyone who returns after it. Not chosen: the file cannot change, which is what `immutable` is for.

What it costs: a 404 for a file under `/assets/` is probably cacheable for a year as well. A browser asks for a missing file only when it holds a page from an older deploy and not that page's script. The cached 404 does harm only if that file's name comes back, which a rollback to that deploy would do. Written into the backlog to be checked on the live site.

### A build id that does not change with every build

1. **Leave the id random (chosen).**
2. **An id made from the contents of the files the script is built from,** given to `foldkit({ buildId })`. Safe as far as hydration goes: a page names its script by a hash of the script's contents, so a page can only ever load the script it was built with, whatever the id says. But it is not enough. The Sentry release is also in the script, and it is the commit. So the release would have to leave the script too: `release.inject: false`, the commit written into each page as a `<meta>` tag by `src/entry.server.ts`, and `initSentry` reading it from there.

Why not now:

- **It would rarely help.** Of the 19 commits on `main` so far, counting a merged pull request as one, one changed nothing that goes into the script, and one more changed only tests. In this project a change and its documents go in one pull request, and every release changes the version, which is in the script.
- **It moves how a report gets its release,** and the proof that reports still carry one can only be had from the live site.
- **It adds a hand-made hash of the inputs to `vite.config.ts`,** the one file nothing checks.

What was done instead is the third cause, which costs one line: Tailwind's scan is limited to `src`, so writing a document no longer renames the stylesheet and, with it, the script. The backlog item is reworded with what the other two would take.

### The Sentry switches

1. **Change nothing (chosen).** The debug switch saves 1.0% of the script (1.87 kB compressed), tracing a seventh of a kilobyte, the rest nothing. The brief asks for a meaningful saving and for proof from the tests that reports are unchanged. This is not the first, and the tests cannot give the second: Vitest does not read `vite.config.ts`.
2. **`define: { __SENTRY_DEBUG__: false }` in `vite.config.ts`.** Read through, it removes the SDK's debug logging and one check of the DSN's shape, and nothing a report contains. It would also make `debug: true` print nothing, in the dev server as well unless limited to builds. Recorded in the backlog as available, with its numbers.
3. **The plugin's option.** Not this: it reaches the live build only (above).

### Tailwind's scan (a separate backlog item, allowed if one line and shown safe)

`@import 'tailwindcss' source('.')` in `src/styles.css` limits the scan to the stylesheet's own folder, `src`. Shown safe: the built stylesheet differs by one rule, `.transition`, and three theme variables that only it or nothing used (`--default-transition-duration`, `--default-transition-timing-function`, `--color-oxford-50`); no element on any page, or with the picker or the menu open, has that class; and screenshots of all five pages at two widths are byte for byte the same before and after. The stylesheet goes from 27.61 kB to 27.00 kB (5.92 kB to 5.74 kB gzip).

## Design

- **`vercel.json`:** a third header rule, `/assets/(.*)`, with the one header. No condition. The two existing rules are untouched.
- **`src/site.test.ts`:** a test that exactly one rule sets `Cache-Control`, that it is that pattern and that value, and that no page's address fits the pattern. The two existing tests found "the rule that applies everywhere" as the first rule with no `missing` condition, which the new rule also is. They now find it by its pattern as well.
- **`src/styles.css`:** `source('.')` on the import, and the comment says why.
- **`package.json`:** version 0.7.1.
- **Nothing in `src/sentry.ts` or in the build's plugins changes.**

## Checking it

Vitest cannot see a browser's cache, and neither the dev server nor Vite's preview sends `vercel.json`'s headers. So:

- The static server used for the Content Security Policy check now applies each rule only to the addresses its `source` fits (it used to add every unconditional rule's headers to every response, which with the new rule would have marked the pages immutable). With one more argument it answers as Vercel does for a static file: the default `Cache-Control`, an `ETag`, a 304 to a conditional request, gzip.
- A browser script opens the home page twice in one browser context and reports, from Chrome's own network events, which files were asked for, with what status, and how many bytes crossed the network. It also prints the `Cache-Control` of every page and of a missing file under `/assets/`. It runs against that server before merging and against the live site after.
- The usual click-through and the Content Security Policy check.

## Left to the builder, and not verified before merging

- What Vercel itself sends once the rule is deployed. The preview cannot be fetched without signing in, so the first real proof is the browser script against the live site after the merge.
- Whether a 404 under `/assets/` gets the header. The same script prints it.
- One test report to Sentry from the live site after merging, as after any deploy: it should arrive with a release and with stack frames that name files under `src/`. Nothing in this change touches that path.

## Changes during the build

None: the design was written after the measurements.
