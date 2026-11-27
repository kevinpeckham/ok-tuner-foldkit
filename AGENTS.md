# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

Domain vocabulary, deployment steps, local conventions that differ from Foldkit's defaults: write them here.

### Dev server on the lj-bench VM

A persistent dev server runs as the systemd user service `ok-tuner-dev` (launcher `~/bin/ok-tuner-dev`) on `localhost:5273`. Caddy serves it at <https://ok-tuner.bench.lj.dev/>, reachable only from the tailnet. Do not start a second `bun run dev`: edit the source and the running server hot-reloads.

- Restart: `systemctl --user restart ok-tuner-dev`
- Logs: `journalctl --user -u ok-tuner-dev -f`

The port and the allowed host are passed by the launcher, so `vite.config.ts` carries nothing specific to the VM.

### What this app is

OK Tuner is a port of the Stem Shovel guitar tuner (`~/projects/stem-shovel`, `src/lib/components/Tuner.svelte`), written to learn Foldkit. The design is `docs/superpowers/specs/2026-11-24-tuner-design.md`. It is live at <https://www.oktuner.com/>.

### Pages

The app has routing: the routes are in `src/route.ts`, and the route is a field of the Model. To add a page, add its route and router there, a view under `src/page/`, and its case in `pageTitle` and `view` in `src/view.ts` (the compiler asks for both, and for the case in `enterRoute` in `src/main.ts`). Nothing asks for the router to be listed in `Route.oneOf` in `urlToAppRoute`: leave it out and the page shows "Page not found", so add a row to `src/route.test.ts`. Nothing asks for its path in `prerenderPaths` in `src/entry.server.ts` either: leave it out and opening the address directly is a 404. Give the page one `<h1>` with `pageHeadingAttributes`, which is where focus moves when the page appears. Links are plain `<a>` elements built with `textLink` and a router, never a typed-out path. A link to another site is the same element with a full address: the runtime tells the two apart. Addresses used in more than one place are constants in `src/site.ts`. The header (`src/header.ts`) and the footer (`src/footer.ts`) are drawn over and under every page by `view`, outside the `<main>`. The classes of that frame (the page ground, the `<main>` and the column) are the constants of `src/layout.ts`. Every page has exactly one `<h1>`, which names the page and carries `pageHeadingAttributes`. "OK Tuner" is the brand link in the header, never a heading. Only `ChangedUrl` sets the route. A Scene test cannot follow a link: `src/app.runtime.test.ts` clicks through in a running app, and `FINDINGS.md` says how the rest of navigation is tested.

### The crash screen

`src/crash.ts` is what a visitor sees when the app has crashed. It is drawn once, by a runtime that has stopped, so the rules for a page do not apply and these do:

- **Every link on it carries `target="_top"`** (`browserHandled`). A plain link does nothing after a crash: the runtime still cancels the click and then drops the Message (`FINDINGS.md`, "A plain link does nothing after a crash"). A test counts the links and the targets.
- **Nothing on it may need a Message or a script.** Its builder is an `HtmlBuilder<never>`, and the Content Security Policy refuses an inline handler such as `onclick`.
- **It is for a visitor.** No error text, no stack, no Model. It does not say the problem was reported, because it cannot know.
- **It does not import `src/view.ts` or `src/main.ts`,** the code that may have just thrown. The frame's classes come from `src/layout.ts`, so a change to the site's look there reaches it.
- **A crash closes the microphone, because Foldkit will not.** A crashed runtime releases no managed resource. The `crash.report` hook in `src/entry.ts` is `Crash.reportThenClose(reportCrash, closeOpenMicrophones)`: it reports, then stops every stream `src/microphone.ts` has open. Anything else the app ever holds open that must not outlive a crash is closed there too (`FINDINGS.md`, "A crash releases nothing, so the app closes the microphone itself").
- **Look at it after changing it.** No page leads to it. Force a crash in headless Chrome against a build served with the site's headers (`FINDINGS.md`, "A crash is forced in the real page from outside the app").

### The tuner's face

- **One rule says "in tune", in one place.** The needle rounded to a whole cent, within `IN_TUNE_CENTS`: `intonationOf` in `src/intonation.ts` works it out, for the view and for `update` alike. The word, the needle's colour, the lit chip's colour, the green zone and what a screen reader is told all come from there. Do not compare cents with `IN_TUNE_CENTS` anywhere else: the number and the word once disagreed because two places did.
- **Words that come and go have their room kept.** The waiting line and the failure line are drawn inside `messagesView`, a block that is as tall without them as with them, so the page does not move. A new line of that kind goes in the same block. After changing it, or the sentences in `src/microphone.ts`, measure the pedal with no line, with the waiting line and with the longest sentence, at 1280 and 375 px (`FINDINGS.md`, "A line that comes and goes must have its room kept").

### Screen readers and keyboard

Built in 0.8.0 with no screen reader to hand. `FINDINGS.md`, "What is still unheard", lists what a person with one should check first. What is in place rests on these rules:

- **A control is named by what is on it.** `aria-label` and `aria-labelledby` replace the name a control's content gives. So a control with visible text takes neither: words that have to be added go inside it, off screen (`sr-only`), and the name then contains the visible text, whole and in order. The tuning picker is the example ("Tuning: Guitar - Standard"). `aria-label` is for a control that shows no text at all, like the settings button.
- **One live region speaks for the reading, and only `update` changes what it says.** It is `announcementView` in `src/view.ts`, off screen, drawn in every state and empty until there is something to say. Its words come from the `announcer` inside the `Listening` state, which `update` steps once a reading (`stepAnnouncer` in `src/intonation.ts`): a note and state are spoken once they have been shown for seven readings in a row. Never put `aria-live`, `role="status"` or `role="alert"` on anything that changes with the readings: the detail line changes twenty times a second.
- **A live region is in the page before it has anything to say,** the prerendered file included. Only an `alert` may arrive with its text.
- **Words for speech are spelt out.** A sharp is "F sharp 3", not "F♯3" (`spokenNoteLabel` in `src/pitch.ts`): a screen reader may pass over the sign in silence.
- **A string chip shows a letter and is read with its octave.** The letter is hidden from assistive technology and the name is off-screen text inside the chip. The lit chip carries `aria-current="true"`.
- **Tab in the settings menu is handled by the app** (`leaveOnTab` in `src/view.ts`), because an open Popover's panel sits at the start of the document and the browser's own Tab would go to the far end of the page. The A4 field is the menu's only stop. A second control in the menu means rethinking that handler.
- **Contrast is measured, not judged.** Text on the pedal sits on a gradient, darkest at the foot, where black itself reaches only 5.1 to 1. After changing a colour on the pedal, or the pedal's ground, measure in headless Chrome against the darkest ground the text can sit on (`FINDINGS.md`, "How dark the failure line has to be"). The classes whose contrast was measured are pinned in `src/scene.test.ts`.
- **After changing markup on the tuner's page,** read the names from Chrome's accessibility tree, walk the page with the keyboard and run axe-core on it, all in headless Chrome (`FINDINGS.md`, "What a screen reader is given is read from Chrome, and what it says is not"). No such check is in the suite yet.

### Tunings

The tunings are the list `TUNINGS` in `src/tuning.ts`. To add one:

- Add it at the end of the list: the order of the list is the order of the picker.
- Its `id` is what people's browsers save, so it never changes afterwards. An instrument's usual tuning is named for the instrument (`bass`, `mandolin`), a variant takes a suffix (`bass-5`), and guitar tunings are named for the tuning (`drop-d`).
- List the strings in the order they sit on the instrument, as a player reads them, not sorted by pitch. Strings tuned together to one note are listed once.
- Add the id to the list pinned in `src/tuning.test.ts`. The other guards need nothing: the detector's test runs every string of every tuning, and the key test checks that no two chips of a row share a key.
- Update the how-to page's first tip (`src/page/howTo.ts`), which names the tunings in words. A test fails if the instrument is new and the page does not name it.
- Look at the open list in a browser, at 1366 by 768 as well as on a tall window. It must show every tuning there without scrolling: it opens upwards when there is too little room below. A longer list will stop fitting at some point, and a window too short for it on both sides gets a scrolling list with a soft edge where there is more (`scroll-cue` in `src/styles.css`).
- Never give the list a `max-h-...` class. The Listbox sizes the list itself, and a height class makes it open on the wrong side (`FINDINGS.md`, "A height class on the open list stopped it opening upwards").

### The site is public

Since 2026-11-25 the live site can be indexed. What that rests on:

- **A page has a canonical address and a description.** `canonicalOf` and `pageDescription` in `src/view.ts` take a case for every route (the compiler asks), and `public/sitemap.xml` lists every page (`src/site.test.ts` holds it to `pagePaths`).
- **Only `www.oktuner.com` is indexed.** `vercel.json` adds `X-Robots-Tag: noindex` on every other host, and the 404 page carries its own `noindex`.
- **The Content Security Policy is in `vercel.json`.** Scripts and stylesheets come from the site only, and requests go to the site and to Sentry. Anything new that loads from or sends to another origin has to be allowed there, and the policy only applies on Vercel, so try it against a build served with those headers before merging (`FINDINGS.md`).
- **The link-preview picture** is `public/og-image.png`, a screenshot of the live home page. Retake it with `bun run og:image` when the home page's look changes, after the new look is deployed.

### Privacy

The footer says the site is ad-free and privacy-respecting, and `/privacy` (`src/page/privacy.ts`) says exactly what leaves the browser: error reports to Sentry, and page-view counts to Vercel Web Analytics. Keep both true.

- A change that alters what leaves the browser changes the Privacy page in the same commit. Ask Kevin before adding anything new that does.
- Visits are counted on the production hostnames only (`countsVisitsFrom` in `src/analytics.ts`). Only that file and its test import `@vercel/analytics`.
- No adverts, no advertising or cross-site trackers, no cookies, no accounts.

### Version

The footer shows the version in `package.json` (`VERSION` in `src/site.ts`). Raise it in the same pull request as each change that alters what a visitor gets: the minor number for a feature, the patch number for a fix. A docs-only change leaves it alone.

### Prerendering

The build writes each page as an HTML file (`src/entry.server.ts`), and the browser takes the HTML over with `Runtime.hydrate`. There is no `index.html` and no server at run time.

- `init` and `view` run in Node during the build. Keep them free of `window`, `document` and `localStorage`, and keep the first Model the same for every visitor: anything read from the browser arrives by a Command, as the saved preferences do.
- Foldkit marks server rendering experimental. After a Foldkit upgrade, run `SKIP_VARLOCK=1 bun run build`, check that both pages are generated and that `dist/client/how-to/index.html` holds the how-to text, then `bun run preview` and click through before anything else. Open `/how-to/` with the trailing slash: Vite's preview answers `/how-to` with the tuner's file, and the browser quietly rebuilds a page that does not match.
- Head tags go in `DOCUMENT_HEAD` in `src/entry.server.ts`.
- **A browser keeps anything under `/assets/` for a year without asking again** (`Cache-Control: public, max-age=31536000, immutable`, a rule in `vercel.json`). That is right only for a file whose name holds a hash of its contents, which is what Vite writes there. Never put a file with a fixed name under `/assets/` (a `public/assets/` folder would): a browser would go on using its first copy. A page must never get that header: it is the page that names the current script. After changing the rules, run the browser check that visits twice (`FINDINGS.md`, "A browser's cache is watched from Chrome's own network events").
- The 404 page is the app's not-found page, drawn at `NOT_FOUND_PATH` and moved to `dist/client/404.html` by the `build` script in `package.json`. Keep that page the same for every address: it is one file served for all of them.
- `renderPage` needs a build id that only a real build has. Tests call `renderApplication` with an id of their own (`src/entry.server.test.ts`).

### Findings

[`FINDINGS.md`](./FINDINGS.md) is the log of gotchas and of why things are the way they are. Read the section for the area you are about to change. Add an entry whenever a tool, a pattern or our own process does something that was not obvious, in the same change that met it. A rule to follow goes in this file, not there.

### Environment and secrets

- `.env.schema` (committed) declares the environment; Varlock loads it, with values from one 1Password environment. Read the `varlock-docs-mcp` server before changing the schema.
- `BROWSERLESS_API_KEY` is the second secret, used only by `bun run og:image`. No build needs it.
- `.env.local` holds only `OP_TOKEN` and `OP_ENV_ID`. Never open or print it, and never run `varlock load --format …`, `varlock printenv` or `varlock reveal` in a session. `bunx varlock load --agent` is the safe look.
- A new secret goes in `.env.schema`, marked sensitive, and its value into 1Password, which Kevin does. Never into `.env.local` or the Vercel project, which holds only `OP_TOKEN` and `OP_ENV_ID`.
- Nothing under `src` imports `varlock/env`. Doing so changes what tests and `SKIP_VARLOCK` builds need: decide that first.
- The dev server needs `.env.local`. After changing `vite.config.ts` or `.env.schema`, restart it and check it still serves the page.

### Error reporting

- Sentry project `ok-tuner` in the `lightning-jar` organisation. Only `src/sentry.ts` and its test import `@sentry/browser`.
- Errors only: a visit where nothing goes wrong sends Sentry nothing. Do not add tracing, replay, the session integration, or anything that identifies a visitor.
- `@sentry/vite-plugin` must stay at 11.16.0 or later. Earlier versions bundle an upload tool (`sentry` 0.49.0) that, on Vite 8, adds a line to the uploaded copy of the bundle, so every stack frame in Sentry resolves one line off ([sentry-javascript #26658](https://github.com/getsentry/sentry-javascript/issues/26658)). After changing its version, send a test report from production and check that its frames name files under `src/`.
- A caught failure worth reporting is reported by a Command returned from `update` (`ReportProblem`), not from inside the code that caught it. A person's own choice or situation is not reported: refusing the microphone, blocking storage, having no microphone, having it in use elsewhere, unplugging it. To send a test report, make `getUserMedia` reject with an error name the app does not know (`FINDINGS.md`).
- Reports are sent only from our own hosts (`reportsFrom` in `src/sentry.ts`): production (`www.oktuner.com`, the bare domain and the two Vercel addresses) and the dev server at `ok-tuner.bench.lj.dev`, tagged `development`. `localhost` and Vercel previews report nothing. Resolve test issues you create.
- The Sentry project's Allowed Domains setting (Kevin set it on 2026-11-25) holds the same hosts, and Sentry drops a report from any other origin while still answering 200. A new domain reports nothing until it is in both: `PRODUCTION_HOSTNAMES` in `src/sentry.ts`, and Allowed Domains, which Kevin changes. Then send a test report from the new address and check that it appears in Sentry.

### Conventions that differ from Foldkit's defaults

- `src/pitch.ts` uses `for` and `while` loops and mutable locals on purpose. Each reading compares millions of samples, so this one module is exempt from the "no loops" rule. Keep the exemption to that file.
- Commit messages carry no `Co-Authored-By` or other attribution lines.
- **One piece of state lives outside the Model, on purpose:** the set of open microphone streams in `src/microphone.ts`, kept only so that a crash can close them. Nothing may read it to decide anything, and it is not a precedent: state belongs in the Model.
- **The code is commented for teaching.** `FOLDKIT.md` says not to add comments that explain code. This project is an example for learning Foldkit, so it does the opposite on purpose (Kevin, 2026-11-24): each file opens with what it is and where it sits, and each declaration says what it does, with the most words spent on what is particular to Foldkit. When you change code, change the comments beside it in the same commit: a comment that no longer matches the code teaches the wrong thing. Check any statement about Foldkit against `FOLDKIT.md` or the source in `repos/foldkit/` before writing it. `// NOTE:` keeps its meaning: behaviour that would mislead a careful reader.

### Deliberately later

The full list is [`docs/backlog.md`](./docs/backlog.md). Everything there is planned, not forgotten. Do not add an item as a side effect of other work. The ones most likely to be added by accident:

- Starting to listen when the pointer enters the page.
