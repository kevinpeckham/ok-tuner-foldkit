# Backlog

Work that is planned but not started. Nothing here is scheduled. Do not pick an item up as a side effect of other work: each one starts when Kevin says so.

Items are grouped by kind, not ranked.

## Microphone and listening

- **Start listening when the pointer enters the page.** Agreed during design, to follow the basics.
- **Pitch detection off the main thread.** `detectPitch` runs on the main thread every 50 ms. Weigh an `AudioWorklet` or a Web Worker: the gain is a steadier needle on slow phones, the cost is a second build entry and message passing. Measure on a slow phone before deciding.
- **Development only:** a hot reload that restores "on" may leave the audio context suspended until a click.
- **The microphone stays open after a crash.** Foldkit closes no managed resource when the runtime crashes, so after a crash while listening the stream's track is still live and the browser goes on showing its microphone indicator, under a screen that says the tuner has stopped. Reloading the page ends it. Seen in headless Chrome on 2026-11-26 (`FINDINGS.md`, "What a crash view is given, and what the runtime does with it"). The crash hooks are handed the Model, not the microphone, so closing it means keeping a way to reach the stream from outside the runtime.

## Screen readers and keyboard

- **Sharp, flat and in tune are not announced.** Only the note name is in the live region, because the detail line changes twenty times a second. Find a way to announce the tuning state without flooding (announce on change of state, not of value).
- **The tuning picker's name is only "Tuning".** Its `aria-label` replaces the button's visible text as its accessible name, so the chosen tuning is probably not announced with the control. Not checked with a screen reader.
- **The two E strings read the same.** Give each string an accessible name that tells low E from high E (for example the octave, "E2" and "E4"). The banjo's row has the same trouble twice over: two chips that read G and two that read D.
- **Opening the A4 menu focuses the panel, not the field.** `focusSelector: '#a4-input'` on the Popover is the likely fix; unverified.
- **The chosen tuning is nearly invisible while the tuner is off** (5% opacity, as in the original). Reconsider.
- **Failure text contrast** is about 4.1:1 on the lower body, under the 4.5:1 target.

## Model and code

- **"+5 cents · sharp".** The word comes from the unrounded needle and the number is rounded, so a needle at 5.4 reads "+5 cents · sharp" while 5 reads "+5 cents · in tune". Read from the code, not seen.
- **`max-h-64` and `overflow-y-auto` on the tuning list do nothing.** The Listbox sets both inline. Remove the classes, or size the list the way the Listbox allows.
- **Tuning id as a plain string.** `tuningId` is `Schema.String`, with unknown ids falling back to standard. Reconsider a literal union of the eleven ids, so an invalid id cannot be represented.
- **A4 field accepts decimals** such as 442.5 and forms such as "4e2". The design says steps of 1. Decide, then change `parseA4` and the test that pins 442.5.
- **"-0 cents".** A needle between −0.5 and 0 prints "-0 cents", as the original does.

## Tests

- Two scene tests assert only that something is absent ("no reading", "chromatic shows no strings"). Add a positive assertion to each.
- Untested: the readings stream itself, analyser wiring failing after the audio context exists, and a rejected `resume()` or `close()`.
- Picker and menu click-through is covered by a headless-browser check, not by the suite.
- **The "no IP address" promise is pinned only through the options.** Assert on what is sent: the SDK marks each report so Sentry does not infer the address (`infer_ip: never`).
- **`ReportProblem`'s own catch-all is not pinned.** No test makes `reportMicrophoneProblem` throw and checks the Command still completes.
- **The blocked-storage start-up test for Sentry guards nothing today.** This SDK version does not touch storage when it starts with our options, so the test passes with or without the `try`. It is there for a later version.
- **Three Story tests list Commands that are never returned.** `resolveAll` ignores them, so those lines assert nothing (see `FINDINGS.md`). Use `resolveAllExact`, and add a test for choosing a tuning with the list open, which returns `FocusButton` as well as `SavePreferences`.
- **No Scene test opens the picker or the menu by clicking, or chooses a tuning.** A probe showed `click` followed by the two `Mount.resolve` steps works.
- **Nothing automated checks that stack frames resolve.** The proof is a test report from production, by hand (see `FINDINGS.md`, "Source maps resolved one line off").

## Error reporting

- **Errors thrown by browser extensions are reported.** Sentry has an inbound filter for the common ones (a project setting), and the SDK has `allowUrls` to accept only errors from our own files. Wait until Sentry shows the noise is real.
- **Bundle size.** The script is 512 kB (166 kB compressed), and Sentry is 91 kB of it, 18%. Measured on 2026-11-26: the SDK's switches trim 5.45 kB, 1%, and were left alone (`FINDINGS.md`, "What the SDK's size switches save, and where they work"). The one that does nearly all of it is `define: { __SENTRY_DEBUG__: false }` in `vite.config.ts`, not the plugin's `bundleSizeOptimizations`, which reaches only the build that uploads. Anything bigger means loading Sentry after the tuner or doing without part of it, which is a decision and not a setting. Three fifths of the script is Effect and Foldkit (`FINDINGS.md`, "Where the script's bytes are").
- **`vite.config.ts` is not type-checked or linted.** Typecheck and lint cover `src` only.
- **Switch off the rest of the SDK's data categories.** Five are off, the ones that carry a visitor's data. The others gate integrations this app does not install and are left on by default. Setting them off too makes "nothing is collected" hold whatever is installed later; the test named "switches off every data-collection category" would then be true to its name.
- **The Sentry plan is out of date.** `docs/superpowers/plans/2026-11-24-sentry.md` still describes sending a message and plugin 11.14.0. The design's "Changes during the build" is right. Mark the plan as superseded or correct it.

## Build

- **Tailwind still reads the comments in `src`.** The scan is limited to `src` since 2026-11-26, so documents no longer add rules. Comments and tests under `src` still do: ten unused rules (`.hidden`, `.static`, `.table` and others) are in the built stylesheet (see `FINDINGS.md`). Ending it means naming the files that hold classes (`source(none)` and `@source` lines), and then a class written in a file that is not named would silently get no rule.
- **A missing file under `/assets/` is probably cacheable for a year.** The rule in `vercel.json` that lets a browser keep a hashed file fits any address under `/assets/`, and Vercel applies a rule to a 404 as well (the live 404 carries the Content Security Policy). To check on the live site: the browser check prints the `Cache-Control` of a missing file (`FINDINGS.md`, "Hashed files are kept for a year"). If it says `immutable`, a browser that asked for a script that was gone would keep that answer, which matters only if a rollback brings the same file name back. `vercel.json` has no condition for "the file exists".

## Pages and routing

Found by the review of the routing change on 2026-11-25, and left as they were.

- **With the tuning list open, the first click on the how-to link only closes the list.** It is the Listbox's outside-click behaviour.
- **Leaving while the browser is still asking for the microphone.** If permission is then granted, the microphone opens and closes at once, and the browser's indicator may blink on a page with no tuner. Coming back and pressing On / Off during that time shows "starting" without asking again until the first request settles.
- **The script is downloaded again after every deploy,** although a browser now keeps it for a year, because every deploy gives it a new name. Two causes are left (`FINDINGS.md`, "Three things rename the script on a deploy that did not change it"). Foldkit's build id is random per build: the plugin takes one from the app (`foldkit({ buildId })`), and it would have to be made from the contents of the files the script is built from, not from the commit. And the Sentry plugin writes the commit into the script as the release: that needs `release.inject: false`, the commit written into each page by `src/entry.server.ts`, and `initSentry` reading it from the page, then a test report from the live site to prove reports still carry a release. Both are needed, or neither helps. The gain is small while nearly every deploy changes the script anyway: 1 of the 19 commits on `main` up to 2026-11-26 would have kept it.
- **The title is tested as `pageTitle`, not as what `view` returns.** A `view` that ignored `pageTitle` would pass every test.
- **No automated test clicks through.** Nothing covers the `routing` option in `entry.ts` or what the two navigation Commands do when run. The check is by hand in headless Chrome.

## Look

- **Custom device skins for the tuner.** Other faces for the pedal, chosen by the person and remembered with the tuning and A4.
- **A color-splash background** behind the tuner, in place of the flat dark ground.
- **The open tuning list scrolls in a short window, with nothing to say so.** The list of eleven is 396 px tall. In a window 1366 by 768 it gets 270 px: seven tunings show, and the last four (bass five-string, ukulele, mandolin, banjo) are reached by scrolling the list, by the wheel or the End key. Where the system hides scrollbars nothing shows there is more but a half-cut row. It scrolled with nine as well. Measured in headless Chrome on 2026-11-26. Ways out: a shorter row, a list that opens upwards when there is more room above, or a visible scrollbar. The Listbox sets the list's `max-height` itself (see the `max-h-64` item under "Model and code").
- **The pedal grows when a line appears under the On / Off button.** The "waiting for the microphone" line makes it 52 px taller at desktop width and 72 px on a phone, and the failure line does the same, so the link under the tuner moves down and back. Measured in headless Chrome on 2026-11-26. Reserving the room would make the pedal taller all the time.

## Page content

- **Ad-free and tracker-free, in the title.** Update the page title to say so.
- **A microphone error whose message is only spaces** shows an empty alert. Fall back to the plain sentence.
- **Font.** The system font is fine for now; may be revisited.

> Wording is to be settled when this work starts. Sentry reports errors to a third party, and although no IP address is stored, Sentry attaches an approximate location (country, region, city) to each report, so plain "tracker-free" may claim too much. Kevin's suggestion (2026-11-24): "ad-free, ad-tracker-free" may be the more precise claim.
