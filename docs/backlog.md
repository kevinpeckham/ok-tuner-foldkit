# Backlog

Work that is planned but not started. Nothing here is scheduled. Do not pick an item up as a side effect of other work: each one starts when Kevin says so.

Items are grouped by kind, not ranked.

## Microphone and listening

- **Start listening when the pointer enters the page.** Agreed during design, to follow the basics.
- **Pitch detection off the main thread.** `detectPitch` runs on the main thread every 50 ms. Weigh an `AudioWorklet` or a Web Worker: the gain is a steadier needle on slow phones, the cost is a second build entry and message passing. Measure on a slow phone before deciding.
- **Development only:** a hot reload that restores "on" may leave the audio context suspended until a click.
- **A microphone that opens after a crash stays open.** Since 0.7.2 a crash stops every stream the app has open (`closeOpenMicrophones` in `src/microphone.ts`). One case is left: the app crashes while the browser is still asking for permission, and the person then allows it. That stream is opened after the crash hook has run, and nothing closes it until the page is reloaded. Not seen, read from the code. Closing it means remembering that the app has crashed, a second piece of state outside the Model (`FINDINGS.md`, "A crash releases nothing, so the app closes the microphone itself").

## Screen readers and keyboard

- **Sharp, flat and in tune are not announced.** Only the note name is in the live region, because the detail line changes twenty times a second. Find a way to announce the tuning state without flooding (announce on change of state, not of value).
- **The tuning picker's name is only "Tuning".** Its `aria-label` replaces the button's visible text as its accessible name, so the chosen tuning is probably not announced with the control. Not checked with a screen reader.
- **The two E strings read the same.** Give each string an accessible name that tells low E from high E (for example the octave, "E2" and "E4"). The banjo's row has the same trouble twice over: two chips that read G and two that read D.
- **Opening the A4 menu focuses the panel, not the field.** `focusSelector: '#a4-input'` on the Popover is the likely fix; unverified.
- **The chosen tuning is nearly invisible while the tuner is off** (5% opacity, as in the original). Reconsider.
- **Failure text contrast** is about 4.1:1 on the lower body, under the 4.5:1 target.

## Model and code

- **Tuning id as a plain string.** `tuningId` is `Schema.String`, with unknown ids falling back to standard. Reconsider a literal union of the eleven ids, so an invalid id cannot be represented.
- **A4 field accepts decimals** such as 442.5 and forms such as "4e2". The design says steps of 1. Decide, then change `parseA4` and the test that pins 442.5.

## Tests

Worked through on 2026-11-26 (`docs/superpowers/specs/2026-11-26-test-debt-design.md`). What is left:

- **A reading tick that finds no microphone is untested.** `measureInput` in `src/main.ts` emits nothing when `Microphone.get` fails with `ResourceNotAvailable`. That happens only in development, when a reload restores a Model that is already `Listening` before the microphone is open. A test cannot get there: a runtime started from `init` is never `Listening` without a microphone, and supplying the missing service by hand needs a field of the resource's tag that Foldkit marks internal (`FINDINGS.md`, "The real app runs in happy-dom"). The rest of the readings stream is covered by `src/app.runtime.test.ts`.
- **Nothing automated checks that stack frames resolve, and nothing in the suite can.** A frame is resolved by Sentry, from source maps that only a Vercel build uploads, so a check has to send a report to the real service from a real deployment. It stays a check by hand: after changing the version of `@sentry/vite-plugin`, or how the build makes or uploads source maps, send one test report from production (make `getUserMedia` reject with an error name the app does not know: `AGENTS.md`, "Error reporting"), check in Sentry that its frames name files under `src/` at the right lines, and resolve the issue (`FINDINGS.md`, "Source maps resolved one line off").

## Error reporting

- **Errors thrown by browser extensions are reported.** Sentry has an inbound filter for the common ones (a project setting), and the SDK has `allowUrls` to accept only errors from our own files. Wait until Sentry shows the noise is real.
- **Bundle size.** The script is 512 kB (166 kB compressed), and Sentry is 91 kB of it, 18%. Measured on 2026-11-26: the SDK's switches trim 5.45 kB, 1%, and were left alone (`FINDINGS.md`, "What the SDK's size switches save, and where they work"). The one that does nearly all of it is `define: { __SENTRY_DEBUG__: false }` in `vite.config.ts`, not the plugin's `bundleSizeOptimizations`, which reaches only the build that uploads. Anything bigger means loading Sentry after the tuner or doing without part of it, which is a decision and not a setting. Three fifths of the script is Effect and Foldkit (`FINDINGS.md`, "Where the script's bytes are").
- **`vite.config.ts` is not type-checked or linted.** Typecheck and lint cover `src` only.
- **Switch off the rest of the SDK's data categories.** Five are off, the ones that carry a visitor's data. The others gate integrations this app does not install and are left on by default. Setting them off too makes "nothing is collected" hold whatever is installed later; the test named "switches off every data-collection category" would then be true to its name.
- **The Sentry plan is out of date.** `docs/superpowers/plans/2026-11-24-sentry.md` still describes sending a message and plugin 11.14.0. The design's "Changes during the build" is right. Mark the plan as superseded or correct it.

## Build

- **Tailwind still reads the comments in `src`.** The scan is limited to `src` since 2026-11-26, so documents no longer add rules. Comments and tests under `src` still do: ten unused rules (`.hidden`, `.static`, `.table` and others) are in the built stylesheet (see `FINDINGS.md`). Since 0.7.2 there are two more, `.max-h-64` and `.overflow-y-auto`: the tuning list no longer uses them, and a test that says so, and a comment, still name them. Ending it means naming the files that hold classes (`source(none)` and `@source` lines), and then a class written in a file that is not named would silently get no rule.
- **A missing file under `/assets/` is probably cacheable for a year.** The rule in `vercel.json` that lets a browser keep a hashed file fits any address under `/assets/`, and Vercel applies a rule to a 404 as well (the live 404 carries the Content Security Policy). To check on the live site: the browser check prints the `Cache-Control` of a missing file (`FINDINGS.md`, "Hashed files are kept for a year"). If it says `immutable`, a browser that asked for a script that was gone would keep that answer, which matters only if a rollback brings the same file name back. `vercel.json` has no condition for "the file exists".

## Pages and routing

Found by the review of the routing change on 2026-11-25, and left as they were.

- **With the tuning list open, the first click on the how-to link only closes the list.** It is the Listbox's outside-click behaviour.
- **Leaving while the browser is still asking for the microphone.** If permission is then granted, the microphone opens and closes at once, and the browser's indicator may blink on a page with no tuner. Coming back and pressing On / Off during that time shows "starting" without asking again until the first request settles.
- **The script is downloaded again after every deploy,** although a browser now keeps it for a year, because every deploy gives it a new name. Two causes are left (`FINDINGS.md`, "Three things rename the script on a deploy that did not change it"). Foldkit's build id is random per build: the plugin takes one from the app (`foldkit({ buildId })`), and it would have to be made from the contents of the files the script is built from, not from the commit. And the Sentry plugin writes the commit into the script as the release: that needs `release.inject: false`, the commit written into each page by `src/entry.server.ts`, and `initSentry` reading it from the page, then a test report from the live site to prove reports still carry a release. Both are needed, or neither helps. The gain is small while nearly every deploy changes the script anyway: 1 of the 19 commits on `main` up to 2026-11-26 would have kept it.
- **`src/entry.ts` and the takeover of a prerendered page are outside the suite.** Since 2026-11-26 a test clicks through the real app in a running runtime, back and forward included, and runs both navigation Commands (`src/app.runtime.test.ts`). Two things it cannot do. It cannot import `entry.ts`, which starts Sentry and the analytics and hydrates: the test wires the app itself, with its own copy of the two lines of the `routing` option, so a mistake in `entry.ts` that still compiles would pass. And it starts the app with `start()`, which draws into an empty container, where the live site uses `Runtime.hydrate` over the HTML the build wrote. A click through a hydrated page of a real build is still checked by hand in headless Chrome, as are scrolling to the top of a new page and anything to do with layout (`FINDINGS.md`, "Checking the real page in headless Chrome, with and without a microphone").

## Look

- **Custom device skins for the tuner.** Other faces for the pedal, chosen by the person and remembered with the tuning and A4.
- **A color-splash background** behind the tuner, in place of the flat dark ground.
- **The room kept for a line by the On / Off button: too much on a phone, and not always enough.** Since 0.7.2 the waiting line and the failure line have their room kept, so the page no longer moves. Beside the button, from 640 px up, that costs nothing. Under it on a phone it makes the pedal 68 px taller all the time (466.5 px against 398.5), for a line that is rarely there. And two things still outgrow the room and move the page as before: the longest sentence on a 320 px phone (four lines where three are kept, 20 px), and a long message from the browser itself. Measured in headless Chrome on 2026-11-26. The way to get the height back is to show both lines on the tuner's screen, which is empty whenever either shows: weighed and left out of `docs/superpowers/specs/2026-11-26-rough-edges-design.md` because it changes where the tuner speaks.

## Page content

- **Font.** The system font is fine for now; may be revisited.
