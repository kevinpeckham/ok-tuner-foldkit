# Findings

Gotchas and insights from building OK Tuner: what a tool, a pattern or our own process did that was not obvious, why a choice was made, and what to do about it. Add an entry whenever one surfaces, in the same change that met it. Newest at the top of each section; say where the lesson lives so the code can be found.

Rules to follow belong in [`AGENTS.md`](./AGENTS.md). Planned work belongs in [`docs/backlog.md`](./docs/backlog.md). The designs in `docs/superpowers/specs/` record what was decided before each build; this file records what was learned during and after.

Sections: [Why it is built this way](#why-it-is-built-this-way) · [Foldkit and Effect](#foldkit-and-effect) · [Testing](#testing) · [Sentry](#sentry) · [Varlock and the build](#varlock-and-the-build) · [The page and its assets](#the-page-and-its-assets) · [Vercel and domains](#vercel-and-domains) · [The dev server and the VM](#the-dev-server-and-the-vm) · [Tooling and process](#tooling-and-process)

## Why it is built this way

### The tuner says what it is waiting for, by the clock (2026-11-26, microphone)

- **Symptom.** While the browser's permission prompt was open, the On / Off button said "Starting…" and nothing else. Someone who had not noticed the prompt saw a tuner that seemed stuck.
- **Fix.** A press that starts the tuner returns a Command, `WaitBeforeSlowStartHint`, which sleeps 1.2 seconds and reports with a Message. If the tuner is still `Starting` then, `update` sets `isSlow` inside that state, and the view shows one line under the button: "Waiting for the microphone. If your browser is asking for permission, allow it." Leaving `Starting`, in any direction, removes it.
- **Why the clock and not the Permissions API.** Kevin's decision. `navigator.permissions.query({ name: 'microphone' })` can say that the person has yet to be asked. The reason given was that Firefox does not support that name. That is out of date: MDN's compatibility data lists it in Firefox from version 132 (October 2024), Chrome from 64 and Safari from 16. The clock still has two things the query has not: it works in a browser older than those, and it also speaks up when a start is slow with no prompt open. Using the query to show the line at once, with the clock as the fallback, is a possible later change.
- **Why the attempts are numbered.** A Command runs to its end once returned, so a timer can report after its start is over. In any state but `Starting` the report changes nothing. But switch the tuner on, off and on again inside 1.2 seconds, and the first timer reports during the second start. Unnumbered, that showed the line for 0.2 seconds on a start that then opened (seen in headless Chrome with the comparison taken out). So the Model counts starts (`startCount`), `Starting` carries its `attempt`, the Command and its Message carry the same number, and `update` acts on a report only for the attempt in progress. `@foldkit/ui`'s hover intent numbers its delays the same way.
- **Why the status region is always in the page.** The line is announced through `role="status"`. A screen reader announces a change inside a live region it already knows about, and may say nothing when a region arrives with its text already in it (MDN, "ARIA live regions": include the region in the initial markup). So the region is drawn empty from the first render, prerendered file included, and only the paragraph inside it comes and goes. A `role="alert"`, like the failure line, is the exception browsers make. Not checked with a screen reader.
- **What a visitor sees.** A start that needs no prompt took about 0.11 seconds in headless Chrome, so it never shows the line. The line's contrast against the pedal is 4.9:1 at its lowest. The pedal grows by the height of the line while it shows (in the backlog, under "Look").
- **No cancel button.** The browser's prompt has one.
- **Where.** `WaitBeforeSlowStartHint`, `startTuner` and `CompletedWaitBeforeSlowStartHint` in `src/main.ts`; `startHintView` in `src/view.ts`; "waiting for the microphone" in both test files; the design is `docs/superpowers/specs/2026-11-26-microphone-polish-design.md`.

### A missing, busy or lost microphone is not a fault (2026-11-25, microphone)

- **Why.** The alert used to show the browser's own words ("Requested device not found"), and the failure went to Sentry as a fault. No microphone, a microphone another program is using, and a microphone unplugged mid-session are the person's situation: there is nothing in a report for us to fix. Each is now a kind of its own (`NotFound`, `Busy`, `Lost`) with a sentence that says what to do, and none is reported. Kevin left the reporting question open in the backlog; this was my call.
- **What it changes for testing.** The usual way to send a Sentry test report was a browser with no microphone, which is now `NotFound` and sends nothing. To send one, make `getUserMedia` reject with an error the app does not know, for example a `DOMException` named `AbortError`, from an init script in the browser.
- **Where.** `MicrophoneFailure`, `microphoneFailure` and `failureSentence` in `src/microphone.ts`; `failWith` in `src/main.ts`.

### A lost microphone is noticed by the readings, not by an event (2026-11-25, microphone)

- **Symptom.** With the microphone unplugged, or its permission taken back, the tuner stayed switched on and silent: the analyser goes on answering, with silence.
- **Fix.** The readings Subscription already runs twenty times a second. Before each reading it asks whether every track of the stream has ended (`hasEnded`), and if so sends `LostMicrophone` in place of a reading. `update` moves the tuner to `Failed` with the kind `Lost`, and `Failed` does not require the microphone, so the runtime closes what is left.
- **Why not the track's `ended` event.** It would need a listener added when the microphone opens and removed when it closes, and a way to turn it into a Message. The poll costs nothing new and cannot leak.
- **Checked.** In headless Chrome, stopping the stream's tracks from outside the app switched the tuner off with the sentence within half a second, and switching it on again worked.
- **Where.** `hasEnded` in `src/microphone.ts`; `measureInput` and `LostMicrophone` in `src/main.ts`.

### The site is public, and only at one address (2026-11-25, going public)

- **What changed.** The `noindex` tag left the pages, each page gained a canonical address, a description and Open Graph tags, and `robots.txt` and `sitemap.xml` were added.
- **Only `www.oktuner.com` is indexed.** The same build answers at Vercel's own addresses. `vercel.json` adds `X-Robots-Tag: noindex` when the host is not the live one (a `missing` condition on the host), and every page's canonical address names the live site whatever host served it.
- **The 404 page keeps `noindex`** and has no canonical address. That is also how the build tells it apart: `renderDocument` is given the rendered page, not the request, so it reads the route back from the page's canonical address, and a page without one is the not-found page.
- **The description is not in the view.** Foldkit's `Document` carries the title and the canonical address, and the runtime keeps both in step as the page changes. It has no field for a description, so `pageDescription` sits beside `pageTitle` and the build writes the tag. It does not change when the page changes inside the app, which only matters to a crawler, and a crawler loads each address fresh.
- **Where.** `canonicalOf` and `pageDescription` in `src/view.ts`; `pageHead` in `src/entry.server.ts`; `vercel.json`; `public/robots.txt`, `public/sitemap.xml`; `src/site.test.ts`.

### The link-preview picture is taken by a script, not by the build (2026-11-25, going public)

- **Why.** Kevin asked for a screenshot of the home page, taken with Browserless. A build cannot photograph the site it is about to become, and a build that depended on another service's answer could fail for reasons that have nothing to do with the code. So `bun run og:image` takes the picture of the live home page and the file is committed.
- **What it costs.** The picture goes stale when the look changes: retake it after the new look is deployed.
- **Details.** 1200 by 630 pixels. The page is taller than that, so the browser drew a scrollbar down the right edge, which the request hides with a style added for the photograph only. The key is `BROWSERLESS_API_KEY`, optional in `.env.schema` because no build needs it, and the script never prints the request's address, which holds the key.
- **Where.** `scripts/og-image.ts`; `OG_IMAGE_URL` in `src/site.ts`.

### Visits are counted, on the live site only (2026-11-25, analytics)

- **Why.** Kevin asked for Vercel Web Analytics, with a Privacy page that says so. Until now the site sent nothing on a visit where nothing went wrong, and the README said so. It now sends one page view per page.
- **What is sent,** by Vercel's documentation: the page, the referring site, the time, an approximate location, and the kind of device, operating system and browser. No cookie. Visitors are told apart by a hash of the request that is discarded after 24 hours.
- **Where it runs.** On the production hostnames only. The script lives at `/_vercel/insights/script.js`, an address Vercel serves, so the dev server has nothing to load; and a preview is not the site. The package's own guess of "development" would load a debugging script from another site, so the mode is set by hand.
- **Why it is not a Command.** Counting is not part of what the app does and nothing in the Model depends on it. The script reports page changes by itself, by watching the address. So it is one call in `src/entry.ts`, like starting Sentry.
- **Where.** `src/analytics.ts`; `src/page/privacy.ts`; `AGENTS.md`, "Privacy".

### Every page has its own first heading, and the site's name is a brand (2026-11-25, pages)

- **Why.** Each page's `<h1>` was "OK Tuner", with the page's name second. Kevin asked for the page's name to be the `<h1>` and the site's name to be a brand in the header, linked to the home page. A screen reader's list of headings then starts with where you are.
- **The home page's heading is not shown.** It is "Tuner", with Tailwind's `sr-only` class: the tuner needs no title above it. It is still where focus moves when you arrive from another page, so there is no visible sign of focus on arriving there. A screen reader reads it out.
- **Landmarks.** The `<header>` and `<footer>` sit beside the `<main>`, not inside it, so they are the page's banner and contentinfo. Foldkit's Scene follows the same rule: `role('banner')` does not find a header inside `<main>`.
- **"Learn More".** The footer's link reads "Learn More" on screen, and carries " about privacy" off screen, so that it means something in a list of links. The visible words come first, so voice control still finds it by them.
- **Where.** `src/header.ts`, `src/footer.ts`, `view` in `src/view.ts`; 'pages' in `src/scene.test.ts`.

### The footer shows a version, not a commit (2026-11-25, footer)

- **Why.** Stem Shovel's footer shows the version and the commit. A commit hash is a value from the build's environment, and a prerendered page needs every value to be the same in the build and in the browser, so it would have to be compiled into both. The version is already in `package.json`, which both read.
- **How.** `src/site.ts` re-exports `version` from `package.json`. Vite takes one field of a JSON file when it is imported by name, so the built script holds the string and not the file: checked by searching the built script for other fields of `package.json`.
- **What it costs.** The number is raised by hand (`AGENTS.md`, "Version"), and says less than a commit would.
- **Where.** `src/site.ts`; `resolveJsonModule` in `tsconfig.json`.

### The pages are prerendered (2026-11-25, prerender)

- **Why.** The server used to send an empty page and a 497 kB script that drew everything. Now the build writes `/` and `/how-to` as HTML (8 kB and 2.4 kB), so the page shows before the script runs, an unknown address is a real 404, and the site is ready to be crawled when `noindex` comes off.
- **Why not render per request.** The app has no per-visitor data on a server, so a function on every visit would add cost and nothing else. The host stays static.
- **How.** Foldkit's Vite plugin bundles the app twice, for the browser and for Node, then calls `renderPage` in `src/entry.server.ts` once for each path in `prerenderPaths` and writes the result. The browser's script calls `Runtime.hydrate`, which takes the HTML over where `Runtime.run` would draw the page from nothing.
- **What it costs.** Foldkit marks this experimental and says to expect breaking changes: after a Foldkit upgrade, run a build and the browser check before anything else. The app no longer shows Foldkit's Flags. A page added to `src/route.ts` must also be added to `prerenderPaths`, and nothing checks that.
- **A page that looks ready before it is.** See the next entry.
- **The script's name changes on every build,** because the build id is random and compiled into it. Every deploy, a docs-only one included, makes a returning visitor download the script again (161 kB compressed). The stylesheet's name is stable.
- **An old page whose script is gone** shows the tuner with a dead On / Off and no message, where it used to be blank. How often Vercel produces that was not checked.
- **Tried first.** A throwaway spike on a branch answered the open questions before the design was written: the views needed no change, and the saved preferences did (next entry).
- **Where.** `src/entry.server.ts`, `src/entry.ts`, the `ssr` option in `vite.config.ts`, `outputDirectory` in `vercel.json`. The design is `docs/superpowers/specs/2026-11-25-prerender-design.md`.

### A prerendered page looks ready before it is (2026-11-25, prerender)

- **Symptom.** The tuner was drawn before the script had run, and a press on On / Off in that time was lost: nothing replays it. With the script held back three seconds, a click at 0.14 s left the tuner off. Found by the review of the prerender branch.
- **Fix.** The tuner has a fifth state, `Booting`, which is where every visit starts and what the build draws. In it the On / Off button is disabled and dimmed. The first Message the running app sends itself, `CompletedLoadPreferences`, moves the tuner to `Off`, so the button comes alive the moment a press can be heard.
- **Why a state and not a flag.** The first version was a boolean, `isReady`, beside the tuner's state. FOLDKIT.md ("Code Style") asks for a union variant where a flag would allow combinations that mean nothing, such as "not ready" and "listening".
- **What a visitor sees.** On a fast connection the button is alive before the page is first painted. On a slow one it is dimmed until the script has loaded.
- **Where.** `TunerState` and `CompletedLoadPreferences` in `src/main.ts`; `powerButtonView` in `src/view.ts`; "before the app is running" in `src/scene.test.ts`.

### A prerendered page cannot start from what the browser has saved (2026-11-25, prerender)

- **Symptom.** In the spike, with "Bass" saved, the prerendered page came back as "Guitar - Standard". The client-rendered site showed "Bass".
- **Cause.** The saved tuning and A4 were Flags, read from `localStorage` before `init`. In a prerendered app the Flags are written into the HTML by the build, and the browser reads them back from there and computes none of its own. The build has no visitor.
- **Fix.** Flags left the app. `init` starts everyone on the defaults and returns a `LoadPreferences` Command, which the runtime runs in the browser after it has taken the page over. Its result sets the tuning and A4.
- **What it costs.** A returning visitor with a saved tuning can see the default tuner first. Measured in headless Chrome: on a fast connection the saved tuning was in place before first paint; on a simulated 4G connection first paint came at 0.36 s and the saved tuning at 0.64 s. The simulation is rough and probably flatters it.
- **The alternative** was to draw the tuning picker and the strings blank until the preferences were read. Then nobody sees a wrong tuning, and everybody sees an empty tuner.
- **Where.** `init`, `LoadPreferences` and `CompletedLoadPreferences` in `src/main.ts`; `src/storage.test.ts`.

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

### A disabled Button still looks pressable unless the classes say otherwise (2026-11-26, Foldkit)

- **Symptom.** While the tuner was starting, the On / Off button was disabled and still showed the pointing hand and changed colour under the pointer.
- **Cause.** `Button` from `@foldkit/ui` marks a disabled button with `aria-disabled="true"` and `data-disabled` and leaves the native `disabled` attribute off, so that the button can still be reached with the keyboard. The browser therefore treats it as an ordinary button: `cursor-pointer` and a `hover:` class go on applying.
- **Fix.** The cursor and the hover colour are chosen from the state (`powerButtonLook`): the ordinary cursor and no hover colour while booting or starting, the pointing hand and the hover colour otherwise. Starting is not dimmed, because the spinner already says it is busy.
- **Where.** `powerButtonLook` and `powerButtonView` in `src/view.ts`; "the power button under a pointer" in `src/scene.test.ts`.

### The tuner could not hear a five-string bass's low B (2026-11-25, pitch)

- **Symptom.** The list offers "Bass - 5-string", whose lowest string is 30.87 Hz. The detector searched from 40 Hz, so that string read as nothing at all. Listed in the backlog as untested; a test confirmed it.
- **Fix.** The floor is 28 Hz. The window is 4096 samples, which at 48 kHz holds 2.6 periods of that B, above the two the method needs.
- **What it costs.** The search covers about 1,700 lags where it covered 1,200, so each reading does about 40% more arithmetic.
- **The guard.** A test now runs every string of every tuning in the list through the detector at the app's real window length, so a tuning cannot be added whose strings it cannot hear.
- **Where.** `detectPitch` in `src/pitch.ts`; `src/pitch.test.ts`.

### Closing a child component from the parent (2026-11-25, Foldkit)

- **Symptom.** With the settings menu open, going back to another page and forward again showed the menu open on a tuner that was off, and the first press of On / Off only closed it.
- **Fix.** Leaving the tuner's page closes the menu, through the Popover's own `close`, folded with `Update.foldChildStep` and run after the route change with `Update.combine`. Its `Closed` OutMessage puts the A4 text back, as when the person closes it.
- **Not by replacing its Model.** Setting the menu's Model back to a fresh one would skip whatever the component does on closing.
- **What closing returns.** One Command, `FocusButton`. An older test lists `UnlockScroll` and `RestoreInert` beside it with `resolveAll`, which passes although they are never returned: `resolveAllExact` showed it.
- **Where.** `foldA4PopoverClose` and `ChangedUrl` in `src/main.ts`.

### The app's root element is a `<div>`, so the footer can be a landmark (2026-11-25, footer)

- **Why.** A `<footer>` is the page's "contentinfo" landmark only when it is not inside `<main>`. The view's root used to be the `<main>`, and a view has one root, so the root became a `<div>` holding the `<main>` and the `<footer>`.
- **How it is pinned.** Foldkit's Scene knows the rule: `role('contentinfo')` does not find a footer inside a `<main>`. The footer's tests are scoped with `within(footer, ...)`, because the Built With page has links of the same names in its own text.
- **Where.** `view` in `src/view.ts`; `src/footer.ts`; 'footer' in `src/scene.test.ts`.

### A link to another site needs nothing special (2026-11-25, footer)

- **What happens.** The footer and the Built With page hold the app's first links to other sites. Each is a plain `<a href>` with a full address. The runtime reports the click as `UrlRequest.External`, and `update` answers with `LoadExternal`, which had been written for the routing change and never run. In headless Chrome a click on "GitHub" loaded github.com.
- **What was left out on purpose.** No `target` and no `rel`: the links open in the same tab, as Stem Shovel's do, and `rel="noopener"` only matters with a new tab.
- **Copying from Stem Shovel.** Its Built With page labels each section with `aria-labelledby="built-{title}"`, and a title such as "The app" makes an id with a space in it, which that attribute reads as two ids. The copy here has no such attribute. The original is as it was.
- **Check the addresses.** Every address was fetched before it went in. The paper on McLeod's pitch method did not answer at the address I had for it, so that card links to this app's `src/pitch.ts`.
- **Where.** `src/footer.ts`, `src/page/builtWith.ts`, `src/site.ts`.

### What prerendering asks of the code (2026-11-25, prerender)

- **`init` and `view` must not depend on the browser.** The build runs them in Node. Ours needed no change, because they were pure already. The server bundle also imports `sentry.ts` through `main.ts`, which is safe because nothing there runs on import: Sentry starts from `src/instrument.ts`, which only the browser's entry imports.
- **There is no source `index.html`.** The build starts from the script, so a source `index.html` is simply not read. What the plugin refuses is an `index.html` already in the browser output, from `public/` or a stale build. The stylesheet is imported from `src/entry.ts`, which needs `src/vite-env.d.ts` for the compiler to accept it. Head tags move to `renderDocument`.
- **The output moves** to `dist/client`, with the Node bundle in `dist/server`. `vercel.json` has to say so.
- **Commands from `init` run in the browser only.** The build renders the first Model and stops.
- **`container` is null on a prerendered page.** There is no `#root`: the runtime finds the root the build marked. The option is still required.
- **The takeover is strict.** By Foldkit's documentation, a page with no server-drawn root, or with one from another deployment's build, is made inert and the app does not start. Not seen, and not tested.
- **A page that does not match is rebuilt, silently.** The browser keeps the elements that match what it would draw and replaces the rest, with nothing in the console. On the built site that happens at `/index.html` and `/how-to/index.html`: the file's page shows, then "Page not found" replaces it.
- **In development** the dev server renders every address through `renderPage`, so an unknown address is the app's own not-found page with status 200. The page it draws is unstyled until the script has run, because the dev server leaves the stylesheet to the script. One headless run logged a "Slow patch" warning from Foldkit (10.8 ms against a budget of 8 ms) for the first patch. It is a development diagnostic and was not seen on the built pages.
- **Where.** `src/entry.server.ts`, `src/entry.ts`, `vite.config.ts`.

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
- **Where.** `LoadPreferences` (which was the `flags` Effect until 2026-11-25) and `SavePreferences` in `src/main.ts`; `src/storage.test.ts`.

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
- **Since 2026-11-25** the pages are prerendered and there is no `#root` at all: the view's root, now a `<div>` holding the `<main>` and the footer, is in the HTML the build writes.

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

### A test cannot leave a timer pending, so it resolves it with a number no attempt has (2026-11-26, tuner)

- **Symptom.** Once a press returned the timer Command, every Story and Scene test that pressed On / Off and then let the microphone answer failed: "I found unresolved Commands". Neither kind of test sends a Message while a Command is pending, unless the Command is defined as interruptible.
- **Why that is awkward here.** In the app the microphone usually answers first and the timer reports afterwards. Resolving the timer first, with its real Message, marks the start slow, which is the other case.
- **Fix.** The timer's Message carries the number of its attempt, and `update` ignores a number that is not the current attempt's. A test resolves the Command with a number no attempt has (`timerSetAside`), which takes it off the pending list and changes nothing. A Story test then sends the real report by hand, with `message(...)`, at the point in the order it wants. Foldkit's own tests for its hover intent component do the same (`resolveStaleOpen` in `repos/foldkit/packages/ui/src/hoverIntent/story.test.ts`).
- **Where.** `timerSetAside` in `src/story.test.ts` and `src/scene.test.ts`.

### Files that are not code can still be held to the code (2026-11-25, going public)

- **What happens.** `sitemap.xml`, `robots.txt` and `vercel.json` are not TypeScript, so nothing checks them when a page is added or an address changes.
- **What to do.** Vite imports a file as text with `?raw` and a JSON file as data, and Vitest does the same. `src/site.test.ts` reads all three: the sitemap must list exactly `pagePaths`, `robots.txt` must name the sitemap, and the policy's `connect-src` must be the origin of the Sentry DSN.
- **Where.** `src/site.test.ts`.

### The server entry is tested by rendering with a build id of its own (2026-11-25, prerender)

- **What happens.** `Server.renderToString` refuses to render a page that a browser could take over unless it knows the build id, which the Vite plugin compiles in during a real build. A Vitest run has none, so `renderPage` itself fails there with `MissingBuildId`.
- **What to do.** Pass one: the render options take a `buildId`. `renderApplication` in `src/entry.server.ts` exists so that a test can. The tests render each prerendered path, wrap it with `renderDocument`, and check the title, the text, the head tags and that no path comes out as "Page not found".
- **What I got wrong first.** The first version of this entry said the function could not be tested, and pinned only the list of paths and a constant. The review found the option.
- **What is still by hand.** That the files are written and served. `bun run preview` serves `dist/client`, but Vite's preview answers `/how-to` with the tuner's file (open `/how-to/`), and the browser rebuilds a page that does not match without a word, so a click-through looks right even if `how-to/index.html` were missing. Look at the files, or fetch `/how-to` from a Vercel preview.
- **Where.** `src/entry.server.test.ts`.

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
- **Upload rule.** Source maps are made and uploaded only when `VERCEL` is set and the token is present. They are "hidden" (no pointer in the bundle) and deleted from the output after upload. Since 2026-11-25 only the browser bundle has them: the Node bundle that draws the pages gets none. A local build makes no maps.

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
- **What to do.** Limiting the scan to `src` would end it. In the backlog. Until then, expect the built CSS to move when prose changes.

### Comments in a hand-written HTML file are served (2026-11-24, build)

- **What happens.** Vite does not strip HTML comments. While the project had an `index.html`, its teaching comments took the built file from 0.7 kB to 3.4 kB and were readable in the page source. Since 2026-11-25 every page is written by the build and carries no comments. Comments in TypeScript and CSS are removed by the build.

### The lint and TypeScript configuration files carry comments (2026-11-24, tooling)

- **What happens.** `.oxlintrc.json`, `.oxlintrc.effect.json` and `tsconfig.json` have `//` comments. oxlint 1.85.0, `tsc` 7 and oxfmt all accept them, and the lint rules were probed afterwards and still fire. A tool that reads these files as strict JSON would not; an editor without the oxc extension may underline them.

## Vercel and domains

### An address ending in `index.html` is redirected (2026-11-25, Vercel)

- **Symptom.** Each page is a folder holding an `index.html`, and Vercel also answered at that file's own address. The app has no route for such a path, so `/index.html` showed the tuner and then replaced it with "Page not found".
- **Fix.** Two permanent redirects in `vercel.json`: `/index.html` to `/`, and any `…/index.html` to its folder. A redirect is applied before any file is served.
- **Where.** `redirects` in `vercel.json`; `src/site.test.ts`.

### The Content Security Policy: what the app needed, and how it was tried (2026-11-25, going public)

- **The policy.** Scripts and stylesheets from the site only, requests to the site and to Sentry's address for this project, no plugins, no framing. Vercel's analytics script and its requests are on the site's own address, so they need no allowance.
- **The one allowance.** `style-src 'self'` alone broke the page: the needle's position and Foldkit's components are set with `style` attributes, which count as inline style. `style-src-attr 'unsafe-inline'` allows those attributes and still refuses an inline `<style>` block. Nothing needed `unsafe-eval`.
- **How it was tried.** The headers live in `vercel.json`, so neither the dev server nor Vite's preview sends them. A small static server that reads the headers from `vercel.json` served the built pages, and a browser script ran the tuner, opened the tuning list and the settings menu, and visited every page, listening for `securitypolicyviolation`. The stricter rule gave violations; the final one gave none.
- **Not tried before merging:** a report to Sentry under the policy, because only the live hosts report. Checked after.
- **Previews.** Vercel's own toolbar on a preview loads from another origin and is refused by the policy. Accepted.
- **Where.** `headers` in `vercel.json`; `src/site.test.ts`.

### Vercel's analytics script ignores automated browsers (2026-11-25, analytics)

- **Symptom.** After Web Analytics went live, a headless browser loaded the script and no page view was sent.
- **Cause.** The script checks `navigator.webdriver` and looks for "Headless" in the user agent, and sends nothing if either is set. Read in the script the site serves.
- **What it means.** Smoke tests and most bots do not inflate the counts. To see a page view in a test, the browser has to present as an ordinary one: an ordinary user agent, and Chrome started with `--disable-blink-features=AutomationControlled`. That does count as a visit.
- **What a page view's request holds:** the page's address, the referrer, and the versions of the script and the package. The location and the device are worked out by Vercel from the request itself.

### Vercel Web Analytics is two switches (2026-11-25, Vercel)

- **What it needs.** The package in the code, which adds the script tag, and Web Analytics enabled for the project in Vercel (the dashboard, or `vercel project web-analytics enable`). With only the first, the script's address answers 404 and nothing is counted.
- **What the package offers a plain app.** `inject()`. Vercel's documentation says it has "no route support", which means it cannot group addresses with parameters under one route. It does report changes of page inside the app. This app's addresses have no parameters.
- **Where.** `src/analytics.ts`.

### Vercel answers 403 to any address ending in `.map` (2026-11-25, Vercel)

- **What was seen.** On production and on a preview, the address of the script's source map answered 403 with an empty body. So did a made-up `.map` name under `/assets/`, while a made-up `.js` name answered 404.
- **What it means.** A 403 there says nothing about whether the file exists. The proof that no map is deployed is the build: the Sentry plugin deletes the browser bundle's maps after uploading them, and the Node bundle gets none. What blocks the request was not looked into.

### The 404 page is prerendered, then moved (2026-11-25, Vercel)

- **Why.** With the pages prerendered, an address with no file is a real 404, and Vercel sends `404.html` with it if the output has one. That page should look like the rest of the site and share its stylesheet.
- **The obstacle.** Foldkit's prerender writes every path as a folder holding an `index.html`. Asked for `/404.html` it writes a folder of that name, which Vercel does not use.
- **What was done.** The build draws the app's own not-found page at the path `/404`, which no route matches, and the build command then moves `404/index.html` to `404.html`. A build that wrote no such file fails at the move.
- **The page prints no path.** The one file is served for every unknown address. A page that printed the path would show "/404" until the script had run, and would not match the browser's own drawing. In headless Chrome, at an unknown address, all seven elements of the page were kept when the script took over.
- **First version.** For a few hours the page was a hand-written `public/404.html` with its styles inline, because a hand-written file cannot know the hashed name of the stylesheet. Kevin asked for it to share the site's styles, which is what prerendering it gives.
- **Before prerendering.** The app was client-rendered with routing for a day, and `vercel.json` rewrote every path that was not a file to `index.html`. An unknown address was answered 200: a "soft 404".
- **Checking it locally.** Vite's preview does not serve `404.html` for a missing file. A static server that does is a dozen lines of Bun.
- **Where.** `NOT_FOUND_PATH` in `src/entry.server.ts`; the `build` script in `package.json`; `src/page/notFound.ts`.

### `oktuner.com` redirects to `www.oktuner.com` (2026-11-24, Vercel)

- **What happens.** The bare domain answers with a 308 to `www`. The app never runs on the bare domain, but both are in the production host list in case the redirect is ever turned round.
- **Still `noindex`.** Both `vercel.json` (a header on every response) and the head of every page (a meta tag: `DOCUMENT_HEAD` in `src/entry.server.ts`) say so. Making the site crawlable means changing both. In the backlog.

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
