# Findings

Gotchas and insights from building OK Tuner: what a tool, a pattern or our own process did that was not obvious, why a choice was made, and what to do about it. Add an entry whenever one surfaces, in the same change that met it. Newest at the top of each section; say where the lesson lives so the code can be found.

Rules to follow belong in [`AGENTS.md`](./AGENTS.md). Planned work belongs in [`docs/backlog.md`](./docs/backlog.md). The designs in `docs/superpowers/specs/` record what was decided before each build; this file records what was learned during and after.

Sections: [Why it is built this way](#why-it-is-built-this-way) · [Foldkit and Effect](#foldkit-and-effect) · [Testing](#testing) · [Sentry](#sentry) · [Varlock and the build](#varlock-and-the-build) · [The page and its assets](#the-page-and-its-assets) · [Vercel and domains](#vercel-and-domains) · [The dev server and the VM](#the-dev-server-and-the-vm) · [Tooling and process](#tooling-and-process)

## Why it is built this way

### Reports are sent only from a list of our own hosts (2026-11-24, Sentry)

- **Why.** The repository is public and the Sentry address (the DSN) is in the source, as it must be for a browser app. Without a check, a fork on someone else's Vercel account, or `bun run dev` on any machine, would report into our project.
- **What it costs.** `localhost` reports nothing, so a development proof must use `https://ok-tuner.bench.lj.dev/`. And a new domain reports nothing until it is added: see [A new domain reports nothing until it is listed](#a-new-domain-reports-nothing-until-it-is-listed-2026-11-24-sentry).
- **Where.** `reportsFrom` and `PRODUCTION_HOSTNAMES` in `src/sentry.ts`.

### A caught failure is reported by a Command, not where it is caught (2026-11-24, Sentry)

- **Why.** Three ways were weighed (the Sentry design, "Approaches"). Reporting from inside the microphone module is the least code, but it hides a side effect in a mapping function that `update` never sees. A Command returned by `update` shows in the devtools history and is tested like every other Command.
- **What it needed.** `update` has to tell a refusal from a fault, so a microphone failure is a tagged union (`Refused`, `Unsupported`, `Unexpected`) and not a sentence. The view turns the kind into the sentence.
- **Where.** `MicrophoneFailure` in `src/microphone.ts`; `ReportProblem` and `failWith` in `src/main.ts`.

### The environment tag comes from the hostname (2026-11-24, Sentry)

- **Why.** Nothing under `src` reads an environment variable, so tests, lint, typecheck and a `SKIP_VARLOCK` build need no 1Password access. The hostname is the only thing the browser has to say which deployment it is.
- **What it costs.** The production build reached at a deployment's own address (`ok-tuner-git-main-…` or the hashed one) is tagged `preview`. Fixing that means a build-time value in `src`, which reopens what tests and `SKIP_VARLOCK` builds need. In the backlog.
- **Where.** `environmentOf` in `src/sentry.ts`.

### One 1Password environment for every stage (2026-11-24, Varlock)

- **Why.** The only secret is the token that uploads source maps, and it is the same for development, preview and production. Vercel holds `OP_TOKEN` and `OP_ENV_ID` and nothing else.
- **Watch for.** A variable set on the Vercel project overrides 1Password without a word. If a second secret ever differs by stage, this choice is the one to revisit.
- **Where.** `.env.schema`.

### The microphone is a managed resource and the readings a subscription (2026-11-24, tuner)

- **Why.** Kevin picked it over one subscription that owns everything (which hides "starting" and "refused" inside a stream) and over wrapping the original engine in a custom element (which leaves the interesting logic outside Foldkit). It is the shape of Foldkit's `websocket-chat` example.
- **What it costs.** Twenty Messages a second through `update` and the devtools history. The history limit is raised from 100 to 500 so it holds more than five seconds of readings.
- **Where.** `managedResources.microphone` and `subscriptions.readings` in `src/main.ts`; `DEVTOOLS_MAX_ENTRIES` in `src/entry.ts`. The tuner design, "Approaches".

### Pitch detection runs in plain loops (2026-11-24, tuner)

- **Why.** Each reading compares millions of samples. Foldkit's "no loops" rule yields here, as it does in Foldkit's own `examples/pixel-art/src/grid.ts`. The exemption is for `src/pitch.ts` alone.

### The note name stays blue-white when in tune (2026-11-24, tuner)

- **Why.** The design said both "the note turns green in tune" and "colours match the original". In the live original the green class is overridden and never shows. Kevin looked at the result and kept it as it is.

## Foldkit and Effect

### Foldkit catches crashes itself, so Sentry's own handlers never see them (2026-11-24, Sentry)

- **What happens.** The runtime catches an error thrown in `update`, in the view, in a Command, in a Subscription or in a managed resource's lifecycle, and shows its crash screen. Nothing reaches `window.onerror`.
- **What to do.** The `crash: { report }` option of `Runtime.makeApplication` is the only route for those. Sentry's global handlers still cover what is thrown outside the runtime.
- **Where.** `src/entry.ts`, `reportCrash` in `src/sentry.ts`.

### Sentry must start before any other module is evaluated (2026-11-24, Sentry)

- **What happens.** Imports are evaluated before any statement in the file that imports them. A `Sentry.init()` call written as the first statement of `src/entry.ts` would still run after the whole app had loaded.
- **What to do.** Start it from a side-effect import that is the first import: `import './instrument'`. Tests never import `entry.ts`, so they never start Sentry by accident.

### Blocked site storage throws while the storage layer is built, outside the typed error channel (2026-11-24, tuner)

- **Symptom.** With site data blocked, the page crashed at start-up and again on saving a preference. The final review found it; no test had.
- **Cause.** Reading `localStorage` throws while `BrowserKeyValueStore.layerLocalStorage` is being built. That is a defect, not a typed failure, so a handler placed before the layer is provided never sees it.
- **Fix.** `Effect.provide(layer)` first, then `Effect.catchCause`. Blocked storage now means default preferences and an unsaved choice.
- **Where.** `flags` and `SavePreferences` in `src/main.ts`; `src/storage.test.ts`.

### In development the page can boot already "listening" (2026-11-24, tuner)

- **What happens.** After a full reload, Vite restores the Model without running `init`. The page can start in `Listening` before the microphone has been acquired again. Production never restores a Model.
- **What it shaped.** The readings stream looks the microphone up on every tick and treats "not available" as an empty tick, where a single lookup would leave the tuner on with no readings. `update` accepts "acquired" while already `Listening`.
- **Still open.** The restored audio context may stay suspended until a click. In the backlog.
- **Where.** `measureInput` in `src/main.ts`.

### The Effect lint refuses `unknown` in an error channel (2026-11-24, tuner)

- **What happens.** `bun run lint` runs the Effect rules with `--deny-warnings`. An Effect that can fail with `unknown` fails the lint.
- **What to do.** Fail with a typed `Data.TaggedError` and classify the raw value at the edge. Foldkit's `onAcquireError` still hands over `unknown`, so the classifier takes `unknown` and reads the error by property (`name`, `message`), not by `instanceof`.
- **Where.** `MicrophoneError` and `microphoneFailure` in `src/microphone.ts`.

### An open list or menu hides behind the tuner body without a z-index (2026-11-24, tuner)

- **Symptom.** The open tuning list was drawn behind the tuner. A screenshot showed it; the tests could not.
- **Fix.** `z-20` on the Listbox's items panel and on the Popover's panel, `z-10` on the backdrops.
- **Where.** `tuningPickerView` and `settingsMenuView` in `src/view.ts`.

### Only `// NOTE:` comments (2026-11-24, Sentry)

- **What happens.** `FOLDKIT.md` reserves comments for behaviour that would mislead a careful reader, written as `// NOTE:`. Plain explanatory comments were written during the Sentry build and had to be converted in review. Nothing in the lint catches it.

## Testing

### A test can pass because the thing it guards never runs in a test (2026-11-24, Sentry)

- **Symptom.** "Initialising sends nothing" passed with the per-visit session integration still installed.
- **Cause.** The SDK sends a session only when a `release` is set. The build sets one on Vercel; a test does not.
- **Fix.** The test sets a release. It was then checked the hard way: put the integration back and watch the test fail.
- **The habit.** For any test written after the code, break the code once and see the test fail. This was done for the A4 field tests and the microphone clean-up tests too.
- **Where.** `src/sentry.test.ts`, "initialising sends nothing, even with a release set".

### Testing Sentry without the network (2026-11-24, Sentry)

- **How.** `initSentry` takes overrides. A test passes `enabled: true` (tests run on `localhost`, where reporting is off), a `transport` that records envelopes, and a `beforeSend` that records events. `Sentry.close()` runs after each test.
- **Why two recorders.** The lint allows no type assertions, and an envelope's payload is untyped. `beforeSend` receives a typed event, so assertions read from there; the transport answers "was anything sent at all".
- **Where.** `startRecording` in `src/sentry.test.ts`, the only test file allowed to import `@sentry/browser`.

### There are no Node types, so a test cannot listen for unhandled rejections (2026-11-24, Sentry)

- **What happens.** `process.on('unhandledRejection', …)` fails typecheck: the project has no Node types.
- **What we rely on.** Vitest fails the run on any unhandled rejection. A throwaway test confirmed it. "Completes when Sentry cannot be reached" depends on this and has no assertion of its own for it.

### Story has no managed-resource steps; Scene does (2026-11-24, tuner)

- **What to do.** In a Story test, "the microphone is required exactly while starting or listening" is tested by calling `managedResources.microphone.modelToMaybeRequirements` directly. A Scene test can use `ManagedResource.acquire`, `failAcquire` and `release`.
- **Where.** `src/story.test.ts`, `src/scene.test.ts`.

### Scene's `Mount.resolve` takes the child component's own Message (2026-11-24, tuner)

- **Symptom.** A type and schema error when resolving a Popover's mount with `Message.GotA4PopoverMessage({ … })`.
- **Fix.** Pass the component's Message, unwrapped: `Popover.Message.CompletedAnchorPopover()`.

### Scope a locator to the part of the page it is about (2026-11-24, tuner)

- **Symptom.** A test counted ten strings where there are six, and an "absent" check matched text that was present.
- **Cause.** The how-to text is also a list, and it contains "442 Hz".
- **Fix.** `all.selector('[aria-label="Strings"] li')`, and `/Hz ·/` in place of `/Hz/`.

### Checking the real page in headless Chrome, with and without a microphone (2026-11-24, tuner and Sentry)

- **A working microphone.** Chrome plays a WAV file as the microphone: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file.wav>`. A synthesised 110 Hz tone reads as A2, 110.00 Hz.
- **No microphone.** Leave out the last two flags. The VM has no audio device, so the page gets `NotFoundError`, which is the one failure that can be produced on demand to send a real report to Sentry.
- **What it is run with.** `/usr/bin/google-chrome` and the `playwright-core` already installed in `~/projects/stem-shovel`. The scripts were session scratch and are not in the repository.
- **What it covers that the suite does not.** Click-through of the picker and the menu, stacking order, and everything about what Sentry receives from a built site.

## Sentry

### A new domain reports nothing until it is listed (2026-11-24, Sentry)

- **Symptom.** `www.oktuner.com` was connected to production. The same failure that sent a report from `ok-tuner.vercel.app` sent nothing from the new domain, and nothing said so.
- **Cause.** The host list in `src/sentry.ts`: an unknown host means the SDK is disabled. It would also have been tagged `development`.
- **Fix.** `www.oktuner.com` and `oktuner.com` added to `PRODUCTION_HOSTNAMES`.
- **For the next domain.** Add it there. If the Sentry project's Allowed Domains is set, add it there too: that is a second list with the same silent failure. Then send a test report from the new address.
- **Where.** `src/sentry.ts`; `reportsFrom` in `src/sentry.test.ts`.

### Sentry's Allowed Domains: what it checks and what it cannot match (2026-11-24, Sentry)

- **Where it is.** Project Settings, General Settings, "Client Security". One entry per line; the default is `*`.
- **What it checks.** The `Origin` header of each incoming report, or `Referer` when there is no `Origin`. A request with neither is always accepted, so it stops a copy of the app running in a browser on another host, and does not stop a script. A rejected report shows in Sentry's Stats as "Disallowed Domain".
- **What an entry can be.** A hostname (`www.oktuner.com`, any scheme and port), a full origin (`https://www.oktuner.com`), `*.oktuner.com` (the domain and every subdomain), or `*:port`. A `*` is honoured only as the whole host or as a leading `*.`; there is no pattern for the middle of a name.
- **What follows.** Our preview addresses (`ok-tuner-<something>-lightning-jar.vercel.app`) cannot be listed narrowly. The only entry that matches them is `*.vercel.app`, which matches every project on Vercel. So with Allowed Domains set to our own hosts, previews stop reporting.
- **Source.** Sentry's documentation ("Inbound Filters", "Allowed Domains") and the matcher itself, `relay-filter/src/origin.rs` in `getsentry/relay`, read on this date. Not tested against our project.

### Sentry attaches a location even when it stores no IP address (2026-11-24, Sentry)

- **What was seen.** Every report has `ipAddress: null` and still carries a country, and sometimes a city: "US, New York" on the first reports, "US" with no city on a later one, "US, New York" again on one sent after "Prevent Storing of IP Addresses" was switched on for the project.
- **What it means.** Sentry looks the location up from the address the report arrives from, then keeps the location and not the address. Neither the SDK's switches nor the project setting stops it.
- **Why it matters.** It bears on what the page may claim. "Ad-free, ad-tracker-free" holds; a plain "tracker-free" or "we know nothing about you" would claim too much. See the note in the backlog.

### The SDK's privacy switches changed name, and they default to on (2026-11-24, Sentry)

- **What happens.** In `@sentry/browser` 11 the `dataCollection` option replaces `sendDefaultPii`. Its categories default to on, and one of them infers the IP address.
- **What to do.** Switch every category off, as `sentryOptions` does. With `userInfo: false` the SDK tells Sentry not to infer the address.
- **Where.** `sentryOptions` in `src/sentry.ts`. Stem Shovel does the same in its `src/hooks.client.ts`.

### A default integration tells Sentry about every visit (2026-11-24, Sentry)

- **What happens.** `BrowserSession` is on by default and sends an envelope on each page load, crash or not. It only sends once a `release` is set, so it is invisible in development and appears on the first Vercel build.
- **What to do.** It is filtered out of the default integrations. The cost: Sentry shows no crash-free-session figures.
- **Check.** A visit to the live site with a working microphone sends no request to Sentry at all.

### Source maps resolved one line off (2026-11-24, Sentry)

- **Symptom.** The first production report had readable stack frames that named the wrong lines and, through them, the wrong files.
- **How it was found.** A local build pushed through the same upload path was byte for byte what production served, and its map on disk resolved all nine frames correctly. Sentry's answers matched a lookup one line up. So the uploaded copy differed from the served one.
- **Cause.** [sentry-javascript #26658](https://github.com/getsentry/sentry-javascript/issues/26658). On Vite 8 the minifier rewrites the snippet that carries the bundle's debug ID. The upload tool bundled with the plugin (`sentry` 0.49.0) no longer recognises it and adds its own line to the uploaded copy.
- **Fix.** `@sentry/vite-plugin` 11.16.0, which bundles `sentry` 0.50.0. `sentry sourcemap inject --dry-run` on a built file shows the difference: the old tool modifies the file, the new one skips it.
- **Guard.** There is no automated test. After changing the plugin's version, send a test report from production and check that its frames name files under `src/` with the right lines.

### A reported message is titled by the function that sent it (2026-11-24, Sentry)

- **Symptom.** With `attachStacktrace` on, a `captureMessage` report appeared in Sentry titled "reportMicrophoneProblem".
- **Fix.** Send an `Error` whose `name` is `Microphone failed: <browser error name>` and whose text is the browser's message, with a fingerprint and a tag on the error name. The issue is titled "Microphone failed: NotFoundError: Requested device not found".
- **What it costs.** In Sentry it looks like a thrown error, though it was caught and handled.
- **Where.** `reportMicrophoneProblem` in `src/sentry.ts`.

### Crash reports flattened the Model (2026-11-24, Sentry)

- **Symptom.** The Model attached to a crash report showed "[Object]" where the current reading should be.
- **Cause.** The SDK keeps three levels of nested data by default. A `Listening` Model is deeper.
- **Fix.** `normalizeDepth: 10`, with a test that sends a real `Listening` Model.

### What the Sentry connector can and cannot do (2026-11-24, Sentry)

- **Can.** Create the project, read issues and events (including the resolved stack frames and the location), comment on and resolve issues, read the documentation.
- **Cannot.** Change a project's security settings ("Prevent Storing of IP Addresses", Allowed Domains) or delete uploaded source-map bundles. Those are done by hand in Sentry.
- **Why the build has its own token.** The build uses an Organization Token, which is scoped to uploading source maps and creating releases. Managing the project goes through the connector, so no personal token is stored anywhere.

### A simulated Vercel build really uploads (2026-11-24, Sentry)

- **What happens.** A local build with `VERCEL=1` and the token present uploads its source maps as a release. Three such bundles are in Sentry from proving and debugging the upload. They do no harm and can be deleted by hand.
- **Test issues.** A test report reopens the issue it belongs to as a regression. Resolve it afterwards, with a comment saying it was a test. `OK-TUNER-1` is the test issue for a missing microphone.

### What Sentry added to the bundle (2026-11-24, Sentry)

- **Measured.** 398 kB before, 491 kB after (159 kB compressed). The plugin's `bundleSizeOptimizations` may trim it; not tried. In the backlog.

## Varlock and the build

### Varlock resolves the environment the moment its plugin is imported (2026-11-24, Varlock)

- **What happens.** Importing `@varlock/vite-integration` reads `.env.schema`, fetches the values from 1Password and puts them in `process.env`. An ordinary import at the top of `vite.config.ts` would do that for everyone, including someone with no 1Password access.
- **What to do.** The plugin is imported with a top-level `await import(…)` only when `SKIP_VARLOCK` is not set. The Sentry plugin then reads the token from `process.env`, so the Varlock plugin must come first.
- **Never** set `SKIP_VARLOCK` on Vercel: the build would pass and upload nothing.
- **Where.** `vite.config.ts`.

### A Vercel build without the token fails, on purpose (2026-11-24, Varlock)

- **Why.** The alternative is a green build that ships stack traces nobody can read. `SENTRY_AUTH_TOKEN` is `@required=forEnv(preview, production)`, and `APP_ENV` falls back from Vercel's `VERCEL_ENV`.
- **Proved by.** Renaming the item in the schema and watching a production-mode build stop.
- **Upload rule.** Source maps are made and uploaded only when `VERCEL` is set and the token is present. They are "hidden" (no pointer in the bundle) and deleted from `dist/` after upload. A local build makes no maps.

### An undeclared variable is treated as a secret (2026-11-24, Varlock)

- **What happens.** Varlock scans what is served for secrets. Vercel's own build variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`) would count as sensitive unless declared.
- **What to do.** They are declared in `.env.schema` as optional and not sensitive. `VERCEL_OIDC_TOKEN` is declared and left sensitive.
- **Also.** In development the Varlock plugin lists the names of the environment's keys in the served page. Names only, development only.

### `vercel link` rewrites `.gitignore` and writes a token to disk (2026-11-24, Vercel)

- **What happens.** `vercel link` created `.env.local` holding a `VERCEL_OIDC_TOKEN` and added `.env*` to `.gitignore`. That pattern would have hidden `.env.schema`, which must be committed.
- **Fix.** The file was removed and the change reverted; only `.vercel/` was added. `.gitignore` ignores `.env.*` and then un-ignores `!.env.schema`.

### A fork's pull request builds with our 1Password token in reach (2026-11-24, Varlock)

- **What happens.** A preview build runs the pull request's own `vite.config.ts` with `OP_TOKEN` in its environment. On a public repository that is a stranger's code.
- **What stops it.** Vercel's Git Fork Protection, which holds a fork's pull request until a team member authorises the build. It was on when checked. Do not switch it off, and read a fork's `vite.config.ts` before authorising it.

### `vite.config.ts` is not type-checked or linted (2026-11-24, tooling)

- **What happens.** `tsc` and the lint cover `src` only. A mistake in the build configuration shows as a failed or wrong build. In the backlog.

## The page and its assets

### An SVG that a browser draws inline can still fail as an image (2026-11-24, favicon)

- **Symptom.** The icon file as supplied did not load as an image at all (width 0 in Chrome), so it could not have worked as a favicon.
- **Cause.** Two attributes with no space between them: `xmlns="…"viewBox="…"`. Inline in a page, the HTML parser forgives that. As a file, an SVG is read as XML, which does not.
- **Fix.** One space added in `public/favicon.svg`; nothing else was changed. Check any supplied SVG by loading it in an `<img>` before using it as a file.
- **The set.** `public/favicon.svg` for browsers that take SVG, `favicon-48.png` for those that do not, and `apple-touch-icon.png` (180 px, on a solid square, since a phone's home screen fills transparent corners with black). The two PNGs were rendered from the SVG in headless Chrome; render them again if the SVG changes. Vite serves `public/` at the site root and copies it into `dist/`.
- **Also.** With no icon declared, every page load asked for `/favicon.ico` and logged a 404. The declared icons end that.

## Vercel and domains

### `oktuner.com` redirects to `www.oktuner.com` (2026-11-24, Vercel)

- **What happens.** The bare domain answers with a 308 to `www`. The app never runs on the bare domain, but both are in the production host list in case the redirect is ever turned round.
- **Still `noindex`.** Both `vercel.json` (a header on every response) and `index.html` (a meta tag) say so. Making the site crawlable means changing both. In the backlog.

### A new project's first deployment becomes production (2026-11-24, Vercel)

- **What happens.** Vercel promoted the first deployment of the new project to production. After that, `main` is production and pull requests get previews. Expect it when creating a project before its first merge.

### Previews are behind Vercel's sign-in (2026-11-24, Vercel)

- **What happens.** A preview address asks for a Vercel login. A headless check or a `curl` of a preview sees the login page unless it carries a bypass. Production and the dev server are the easy places to check a real page.

### `vercel git connect` cannot read the exe.dev remote (2026-11-24, Vercel)

- **Symptom.** Connecting the project to GitHub failed: the remote is the exe.dev proxy address, which Vercel does not recognise as GitHub.
- **Fix.** Name the repository: `vercel git connect https://github.com/kevinpeckham/ok-tuner-foldkit`.

## The dev server and the VM

### Restart the dev server after changing the build configuration (2026-11-24, dev server)

- **What happens.** The dev server is a long-running service and serves the working tree. It needs `.env.local`. A change to `vite.config.ts` or `.env.schema` can leave it serving an error page until it is restarted.
- **What to do.** `systemctl --user restart ok-tuner-dev`, then load the page.

### A new bench hostname may not resolve on the VM at first (2026-11-24, VM)

- **Symptom.** Just after its DNS record was created, `ok-tuner.bench.lj.dev` did not resolve on the VM, though it did everywhere else.
- **Cause.** The VM had looked the name up before the record existed and remembered the "no such name" answer.
- **What to do.** Use `http://localhost:5273/` or `curl --resolve` until it clears.

### Caddy leaves its certificate challenge records behind (2026-11-24, VM)

- **What happens.** Caddy's DigitalOcean plugin does not always remove the `_acme-challenge` TXT records it creates in the `bench.lj.dev` zone. Twenty-two were there when this project's name was added. Not caused by this project and not cleaned up.

## Tooling and process

### `bun run format` reformats the documents too (2026-11-24, tooling)

- **What happens.** oxfmt formats Markdown as well as code, including everything under `docs/`. A formatting run after writing a document changes it.
- **What to do.** Run it before committing a document, so the reformat is not a separate commit later. A script that edits a file by matching text can miss after a format run: match again.

### The newest fixed version may be younger than the seven-day wait (2026-11-24, dependencies)

- **What happened.** The workspace takes releases at least seven days old. `@sentry/vite-plugin` 11.16.0 was four days old and was the oldest version with the source-map fix. It was taken, and said so.
- **Dependencies are pinned exactly** where this project added them, so an upgrade is always a deliberate change.

### The final review found what the tests could not (2026-11-24, process)

- **What happened.** Each build ended with one fresh review of the whole branch. It found the blocked-storage crash in the tuner, and in the Sentry work both the flattened crash data and the fact that a public repository would report from anywhere. The production proof then found the source-map fault that no review had.
- **The habit.** Keep both: a fresh review before merging, and a real report from the real site after.
