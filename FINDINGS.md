# Findings

Gotchas and insights from building OK Tuner: what a tool, a pattern or our own process did that was not obvious, why a choice was made, and what to do about it. Add an entry whenever one surfaces, in the same change that met it. Newest at the top of each section; say where the lesson lives so the code can be found.

Rules to follow belong in [`AGENTS.md`](./AGENTS.md). Planned work belongs in [`docs/backlog.md`](./docs/backlog.md). The designs in `docs/superpowers/specs/` record what was decided before each build; this file records what was learned during and after.

Sections: [Why it is built this way](#why-it-is-built-this-way) · [Foldkit and Effect](#foldkit-and-effect) · [Testing](#testing) · [Sentry](#sentry) · [Varlock and the build](#varlock-and-the-build) · [The page and its assets](#the-page-and-its-assets) · [Vercel and domains](#vercel-and-domains) · [The dev server and the VM](#the-dev-server-and-the-vm) · [Tooling and process](#tooling-and-process)

## Why it is built this way

### Leaving the tuner's page switches the tuner off (2026-11-25, routing)

- **Why.** "Nothing is recorded" would ring hollow with a microphone open on a page that shows no tuner. Any address change to a route other than `Tuner` sets the tuner to `Off`, and `Off` is all the runtime needs to release the microphone. A failure message is cleared the same way.
- **What it costs.** Coming back from the how-to page, the tuner has to be switched on again.
- **Checked.** In headless Chrome the microphone track read `live` on the tuner's page and `ended` straight after the link was clicked.
- **Where.** `enterRoute` in `src/main.ts`; "routing" in `src/story.test.ts`.

### The route is set in one place, by the address (2026-11-25, routing)

- **Why.** A link click does not change the route. `update` answers `ClickedLink` with a Command that changes the address, the runtime then sends `ChangedUrl`, and only that sets the route. A click goes round the loop twice, and in return the back and forward buttons, which send `ChangedUrl` alone, need no code of their own.
- **What follows.** A link is a plain `<a href>` with no handler. The runtime catches the click on the document, and leaves alone a modified click, a link whose `target` is another tab or frame, and a download link. A link to anything on the same origin counts as internal, so a link to a file such as `/favicon.svg` would be drawn as "Page not found".
- **Where.** `ClickedLink`, `ChangedUrl` and `NavigateInternal` in `src/main.ts`; the `routing` option in `src/entry.ts`; `src/route.ts`.

### Reports are sent only from a list of our own hosts (2026-11-24, Sentry)

- **Why.** The repository is public and the Sentry address (the DSN) is in the source, as it must be for a browser app. Without a check, a fork on someone else's Vercel account, or `bun run dev` on any machine, would report into our project.
- **What it costs.** `localhost` reports nothing, so a development proof must use `https://ok-tuner.bench.lj.dev/`. Vercel previews report nothing either, since 2026-11-25: see [Previews report nothing](#previews-report-nothing-2026-11-25-sentry). And a new domain reports nothing until it is added: see [A new domain reports nothing until it is listed](#a-new-domain-reports-nothing-until-it-is-listed-2026-11-24-sentry).
- **Where.** `reportsFrom` and `PRODUCTION_HOSTNAMES` in `src/sentry.ts`.

### A caught failure is reported by a Command, not where it is caught (2026-11-24, Sentry)

- **Why.** Three ways were weighed (the Sentry design, "Approaches"). Reporting from inside the microphone module is the least code, but it hides a side effect in a mapping function that `update` never sees. A Command returned by `update` shows in the devtools history and is tested like every other Command.
- **What it needed.** `update` has to tell a refusal from a fault, so a microphone failure is a tagged union (`Refused`, `Unsupported`, `Unexpected`) and not a sentence. The view turns the kind into the sentence.
- **Where.** `MicrophoneFailure` in `src/microphone.ts`; `ReportProblem` and `failWith` in `src/main.ts`.

### The environment tag comes from the hostname (2026-11-24, Sentry)

- **Why.** Nothing under `src` reads an environment variable, so tests, lint, typecheck and a `SKIP_VARLOCK` build need no 1Password access. The hostname is the only thing the browser has to say which deployment it is.
- **What it costs.** A hostname cannot say which build it is serving. While previews reported, the production build reached at a deployment's own address (`ok-tuner-git-main-…` or the hashed one) was tagged `preview`. Since 2026-11-25 there are two tags, `production` and `development`, and those addresses report nothing, so the wrong tag can no longer reach Sentry. Telling builds apart properly means a build-time value in `src`, which reopens what tests and `SKIP_VARLOCK` builds need.
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

### A page change is silent unless the app moves focus (2026-11-25, routing)

- **Symptom.** After a link was activated the new page was drawn, focus sat on `<body>`, and the window stayed scrolled where it had been. A screen reader would have said nothing. Found by the review of the routing branch, in headless Chrome.
- **Cause.** A browser moves focus and scroll when it loads a page. A change of route is not a page load, and the Foldkit runtime does neither for you.
- **Fix.** `ChangedUrl` returns a `FocusPageHeading` Command when the page changes. It scrolls to the top and focuses the heading that names the page, which each page marks with `pageHeadingAttributes` (an id and `tabindex="-1"`). Foldkit's own website does the scrolling half the same way.
- **What was seen after.** Focus on the `h2` of the how-to page and the `h1` of the tuner's, with the window at the top. After the back button the browser restores its own scroll position for that history entry, which is the usual behaviour.
- **In a scene** `tabindex` is the property `tabIndex`: `toHaveAttr('tabIndex', '-1')`.
- **Where.** `FocusPageHeading` and `ChangedUrl` in `src/main.ts`; `src/page/link.ts`.

### Routing changes the signature of `init` (2026-11-25, routing)

- **What happens.** A `routing` option lets `init` take the address as a second argument (`Runtime.RoutingApplicationInit`). Nothing forces it: an `init` that still takes the flags alone compiles with `routing` set, and simply never learns the address. The reverse is an error, reported at `makeApplication` in `entry.ts`: an `init` with two arguments and no `routing` option.
- **What it costs.** Every caller of `init` changes, and tests are callers: the fixtures in `story.test.ts` and `scene.test.ts`, and one test in `sentry.test.ts` that builds a Model for a crash report.
- **Where.** `init` in `src/main.ts`; `urlOf` in the test files.

### What a path matches (2026-11-25, routing)

- **What was seen.** `/how-to/`, `/how-to?x=1` and `/how-to#y` are all the how-to page: a trailing slash, a query string and a fragment are ignored. `/How-To` and `/how-to/extra` are not found: matching is case-sensitive, and a router must use up every segment.
- **Where.** `src/route.test.ts` pins each of these.

### A saved Model that no longer fits the Schema is dropped (2026-11-25, Foldkit)

- **What it is.** In development the Vite plugin restores the Model after a reload. A Model saved before a field was added, such as `route`, fails the Schema's decode, and the runtime then runs `init` as on a first visit.
- **Source.** Read in `runtime.ts` in `repos/foldkit` (`decodePreservedModel`, `onFailure: () => runInit`). Not exercised by hand.

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
- **The backdrop needs it too.** Without `z-10` a click on the tuner body does not reach the backdrop, so it would not close the open list.
- **Where.** `tuningPickerView` and `settingsMenuView` in `src/view.ts`.

### The `#root` element does not survive the first render (2026-11-24, Foldkit)

- **What happens.** Foldkit's documentation says the view is patched "into the container". In the running page the view's root element (the `<main>`) takes the container's place: `document.getElementById('root')` is null once the app has drawn.
- **What to do.** Do not style, select or measure `#root`. Seen in headless Chrome while the comments were being written.

### `update`'s return type must name the microphone service, though no Command uses it (2026-11-24, Foldkit)

- **What happens.** `Runtime.makeApplication` takes the app's set of services from the return type of `update`. The subscription needs the microphone. Remove `MicrophoneService` from `UpdateReturn` and `src/entry.ts` stops compiling, with an error about the subscription.
- **Where.** `UpdateReturn` in `src/main.ts`.

### A Listbox's open list sizes itself (2026-11-24, Foldkit)

- **What happens.** The Listbox's anchoring code sets `max-height` and `overflow-y` as inline styles on the open list, which beat classes. `max-h-64` and `overflow-y-auto` on the tuning list therefore do nothing: in the browser the list was 326 px tall against the 256 px the class asks for. In the backlog.
- **Where.** `tuningPickerView` in `src/view.ts`.

### Comments: Foldkit's rule, and why this project breaks it (2026-11-24, process)

- **Foldkit's rule.** `FOLDKIT.md` says not to explain code in comments, and to reserve `// NOTE:` for behaviour that would mislead a careful reader. Plain comments written during the Sentry build were converted in review for that reason. Nothing in the lint checks it.
- **This project.** Later the same day Kevin asked for the opposite: verbose comments throughout, so the code can be read to learn Foldkit and shown to the team. `AGENTS.md` records it as a convention that differs from Foldkit's defaults.
- **What it costs.** Comments go stale. A change to code must change the comments beside it, and a statement about Foldkit must be checked against `FOLDKIT.md` or `repos/foldkit/` before it is written.
- **How it was checked.** The comments were added without touching code: each file, with comments stripped, was compared before and after.

## Testing

### A Scene test cannot follow a link (2026-11-25, routing)

- **What happens.** A click on a link becomes `ClickedLink` only because the runtime listens on the real document. A scene has no runtime and no address bar, so clicking a link in one proves nothing about navigation.
- **What to do.** Split the proof in three. A Scene test checks that each page shows what it should and that its link has the right `href`. A Story test checks `update`: `ClickedLink` returns the navigation Command, and `ChangedUrl` sets the route. The click through itself, with back and forward, is a check by hand in headless Chrome: no automated test covers it, or the `routing` option in `entry.ts`.
- **Also.** A scene has no assertion for the document's title, so the title is a pure function, `pageTitle`, with a test of its own.
- **Where.** "pages" in `src/scene.test.ts`, "routing" in `src/story.test.ts`, `src/view.test.ts`.

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

### `Command.resolveAll` passes when a listed Command was never returned (2026-11-24, tuner)

- **What happens.** `resolveAll` resolves the Commands that are pending and ignores the pairs that match nothing. Three Story tests list Listbox and Popover Commands (`FocusButton`, `UnlockScroll`, `RestoreInert`) that `update` does not return on that path, so those lines assert nothing. `resolveAllExact` fails on an unused pair.
- **What to do.** Prefer `resolveAllExact`, or `Command.expectExact` first. Tightening the three tests is in the backlog.
- **Where.** The two "tuning" tests and "closing the A4 menu" in `src/story.test.ts`.

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

### Sentry answers 200 to a report it then drops (2026-11-25, Sentry)

- **What was seen.** With Allowed Domains set, four reports sent by hand with an `Origin` that is not on the list each got `200` and an event id back. None of them ever appeared in Sentry. A fifth, identical but for an allowed `Origin`, appeared within two minutes.
- **What it means.** Neither the browser nor a script can tell that a report was dropped. A report that arrives from the real site does not prove a filter is on, and a `200` does not prove a report was kept. Only what turns up in Sentry does.
- **How to prove a filter.** Send the same report twice: once claiming an allowed origin, as the control, and once claiming one that should be refused. A minimal envelope posted with `curl` to the DSN's `/api/<project id>/envelope/` address with an `Origin` header is enough. Wait two minutes, then look for both by title. Resolve the issue the control creates.
- **What did not help.** The connector's dropped-events query returned nothing for the project, neither kept nor dropped, minutes after both kinds had been sent. Sentry's own Stats page was not checked.

### Previews report nothing (2026-11-25, Sentry)

- **Why.** Kevin set the Sentry project's Allowed Domains to our own hosts on 2026-11-25. No entry can match our preview addresses without matching every project on Vercel (see the Allowed Domains entry below), so Sentry drops what a preview sends. The app sending reports that go nowhere would be a lie in the code, so previews came off `reportsFrom`, and the `preview` environment tag went with them: nothing could carry it any more.
- **What it costs.** A fault that only shows in a preview build is not reported. Previews are behind Vercel's sign-in, so only we see them, and the dev server still reports.
- **To bring them back.** Both lists have to change: `*.vercel.app` in Allowed Domains, which lets any Vercel project that copies our DSN report, and the preview pattern in `reportsFrom`.
- **Where.** `reportsFrom` and `environmentOf` in `src/sentry.ts`, and their tables in `src/sentry.test.ts`.

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
- **Source.** Sentry's documentation ("Inbound Filters", "Allowed Domains") and the matcher itself, `relay-filter/src/origin.rs` in `getsentry/relay`, read on this date.
- **Tested on 2026-11-25,** after Kevin set it. Reports from `www.oktuner.com` and from the dev server arrived. Reports claiming `not-ours.example.org`, `www.oktuner.com.example.org`, `staging.oktuner.com` and a preview-shaped `…-lightning-jar.vercel.app` address were dropped, so neither a look-alike domain nor an unlisted subdomain gets through. The two `vercel.app` production addresses and the bare domain were not tested. The list itself is in Sentry, not in this repository: `reportsFrom` in `src/sentry.ts` is meant to match it.

### Sentry attaches a location even when it stores no IP address (2026-11-24, Sentry)

- **What was seen.** Every report has `ipAddress: null` and still carries a country, and sometimes a city: "US, New York" on the first reports, "US" with no city on a later one, "US, New York" again on one sent after "Prevent Storing of IP Addresses" was switched on for the project.
- **What it means.** Sentry looks the location up from the address the report arrives from, then keeps the location and not the address. Neither the SDK's switches nor the project setting stops it.
- **Why it matters.** It bears on what the page may claim. "Ad-free, ad-tracker-free" holds; a plain "tracker-free" or "we know nothing about you" would claim too much. See the note in the backlog.

### The SDK's privacy switches changed name, and they default to on (2026-11-24, Sentry)

- **What happens.** In `@sentry/browser` 11 the `dataCollection` option replaces `sendDefaultPii`. Its categories default to on, and one of them infers the IP address.
- **What to do.** Switch off the five that carry a visitor's data in a browser, as `sentryOptions` does: user information (which includes the address), cookies, headers, request bodies and query strings. With `userInfo: false` the SDK tells Sentry not to infer the address.
- **Not literally every category.** The option has more (`graphQL`, `genAI`, `mcp`, `databaseQueryData`, `queues`, `stackFrameVariables`, `frameContextLines`), left at their defaults, which are on. Each gates an integration this app does not install, by the SDK's own description; that was read, not tested one by one. The design and one test name say "every category", which overstates it. Switching the rest off as well is in the backlog.
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

### Tailwind reads comments and documents as if they were markup (2026-11-24, build)

- **What happens.** Tailwind 4 scans every file in the project as plain text for class names, comments and Markdown included. An ordinary word that is also a utility name becomes a rule in the built stylesheet.
- **Seen.** The teaching comments added `.contents{display:contents}` (27 bytes) from the word "contents" in a test file's comment. The stylesheet already carried unused rules from prose in `docs/`: `.hidden`, `.static`, `.container`, `.table`, `.filter`, `.visible`, `.invisible`, `.inline`, `.ring`, `.transition`.
- **What it costs.** A few unused rules. No class the page uses is affected.
- **What to do.** Limiting the scan to `src` and `index.html` would end it. In the backlog. Until then, expect the built CSS to move when prose changes.

### Comments in `index.html` are served (2026-11-24, build)

- **What happens.** Vite does not strip HTML comments. With the teaching comments the built `index.html` is 3.4 kB where it was 0.7 kB, and the comments are readable in the page source. Comments in TypeScript and CSS are removed by the build: the built script is byte for byte what it was before they were added.

### The lint and TypeScript configuration files carry comments (2026-11-24, tooling)

- **What happens.** `.oxlintrc.json`, `.oxlintrc.effect.json` and `tsconfig.json` have `//` comments. oxlint 1.85.0, `tsc` 7 and oxfmt all accept them, and the lint rules were probed afterwards and still fire. A tool that reads these files as strict JSON would not; an editor without the oxc extension may underline them.

## Vercel and domains

### An unknown address is answered 200 (2026-11-25, Vercel)

- **Why.** Only `index.html` exists, so `vercel.json` rewrites every path that is not a file to it. Without the rewrite, opening `/how-to` directly is a 404. With it, `/nope` is served the app with status 200, and the app then draws its own "Page not found".
- **What it costs.** A mistyped asset address returns the page, not a 404. And a crawler would see a "soft 404", which matters once `noindex` is removed. Prerendering the pages would fix both, since real files are served first.
- **The dev server** needs no setting: Vite serves `index.html` for unknown paths by itself.
- **Where.** `rewrites` in `vercel.json`; `src/page/notFound.ts`.

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
