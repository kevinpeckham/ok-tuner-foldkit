# Backlog

Work that is planned but not started. Nothing here is scheduled. Do not pick an item up as a side effect of other work: each one starts when Kevin says so.

Items are grouped by kind, not ranked.

## Microphone and listening

- **Microphone lost mid-session.** If the microphone is unplugged or permission is revoked while the tuner is on, the tuner stays on and silent. Detect it (the track's `ended` event, the permission's `change` event) and show a clear notice with what to do next.
- **Waiting for permission.** While the browser's permission prompt is open the button says "Starting…" and nothing else. Say that the browser is waiting for microphone permission when that is the case, and consider a way to cancel.
- **A missing or busy microphone.** The alert shows the browser's own words ("Requested device not found") and the failure is reported to Sentry as a fault. Once Sentry shows how often each happens, give `NotFoundError` and `NotReadableError` their own kinds and plain sentences, and decide whether to keep reporting them.
- **Start listening when the pointer enters the page.** Agreed during design, to follow the basics.
- **Pitch detection off the main thread.** `detectPitch` runs on the main thread every 50 ms. Weigh an `AudioWorklet` or a Web Worker: the gain is a steadier needle on slow phones, the cost is a second build entry and message passing. Measure on a slow phone before deciding.
- **Power button while starting.** It keeps the pointer cursor and hover colour although it is disabled.
- **Development only:** a hot reload that restores "on" may leave the audio context suspended until a click.

## Screen readers and keyboard

- **Sharp, flat and in tune are not announced.** Only the note name is in the live region, because the detail line changes twenty times a second. Find a way to announce the tuning state without flooding (announce on change of state, not of value).
- **The tuning picker's name is only "Tuning".** Its `aria-label` replaces the button's visible text as its accessible name, so the chosen tuning is probably not announced with the control. Not checked with a screen reader.
- **The two E strings read the same.** Give each string an accessible name that tells low E from high E (for example the octave, "E2" and "E4").
- **Opening the A4 menu focuses the panel, not the field.** `focusSelector: '#a4-input'` on the Popover is the likely fix; unverified.
- **The chosen tuning is nearly invisible while the tuner is off** (5% opacity, as in the original). Reconsider.
- **Failure text contrast** is about 4.1:1 on the lower body, under the 4.5:1 target.

## Model and code

- **Mandolin and banjo tunings,** added to the nine there are.
- **The five-string bass's low B is below what the detector hears.** `bass-5` starts at 30.9 Hz and `detectPitch` searches from 40 Hz. What the tuner shows for that string is untested. The original has the same range.
- **"+5 cents · sharp".** The word comes from the unrounded needle and the number is rounded, so a needle at 5.4 reads "+5 cents · sharp" while 5 reads "+5 cents · in tune". Read from the code, not seen.
- **String chips are keyed by MIDI note.** Unique in the nine tunings there are; a tuning with two strings on one note (a mandolin's paired strings, if listed singly) would give duplicate keys.
- **`max-h-64` and `overflow-y-auto` on the tuning list do nothing.** The Listbox sets both inline. Remove the classes, or size the list the way the Listbox allows.
- **Tuning id as a plain string.** `tuningId` is `Schema.String`, with unknown ids falling back to standard. Reconsider a literal union of the nine ids, so an invalid id cannot be represented.
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
- **Bundle size.** Sentry took the script from 398 kB to 491 kB (159 kB compressed). The Vite plugin's `bundleSizeOptimizations` may trim it. Measure before and after.
- **`vite.config.ts` is not type-checked or linted.** Typecheck and lint cover `src` only.
- **Switch off the rest of the SDK's data categories.** Five are off, the ones that carry a visitor's data. The others gate integrations this app does not install and are left on by default. Setting them off too makes "nothing is collected" hold whatever is installed later; the test named "switches off every data-collection category" would then be true to its name.
- **The Sentry plan is out of date.** `docs/superpowers/plans/2026-11-24-sentry.md` still describes sending a message and plugin 11.14.0. The design's "Changes during the build" is right. Mark the plan as superseded or correct it.

## Build

- **Limit Tailwind's scan to `src`.** It reads comments and documents too, and turns ordinary words into unused rules (see `FINDINGS.md`).

## Pages and routing

Found by the review of the routing change on 2026-11-25, and left as they were.

- **The settings menu survives leaving the page.** Open it, press the browser's back button to another page and come forward again: the tuner is off but the menu is open, and the first press of On / Off only closes it. Close the menu and reset the A4 text in `enterRoute`.
- **With the tuning list open, the first click on the how-to link only closes the list.** It is the Listbox's outside-click behaviour.
- **Leaving while the browser is still asking for the microphone.** If permission is then granted, the microphone opens and closes at once, and the browser's indicator may blink on a page with no tuner. Coming back and pressing On / Off during that time shows "starting" without asking again until the first request settles.
- **`/index.html` and `/how-to/index.html` show their page, then "Page not found".** Vercel serves the file at that address, and the app then finds it has no route for the path and replaces the page. Add the paths to the routers, or redirect them.
- **The script is downloaded again after every deploy,** because its name carries a build id that is random per build. A fixed build id per commit, if Foldkit's plugin takes one, would let an unchanged script stay cached.
- **The not-found page prints the path as the address has it.** `/café` reads `/caf%C3%A9`, and a very long path widens the page on a phone. Decode it and let it wrap.
- **The title is tested as `pageTitle`, not as what `view` returns.** A `view` that ignored `pageTitle` would pass every test.
- **No automated test clicks through.** Nothing covers the `routing` option in `entry.ts` or what the two navigation Commands do when run. The check is by hand in headless Chrome.
- **Every page's first heading is "OK Tuner".** The page's own name is the second. Whether the page name should be the first is a design choice.

## Page content

- **Footer:** copyright, attribution, and links to Stem Shovel and Lightning Jar.
- **"Built with Foldkit"** in the footer, linking to the Foldkit project.
- **Ad-free and tracker-free, in the title.** Update the page title to say so.
- **Ad-free and tracker-free, in the copy.** Add a line to the page saying so.
- **A custom crash screen** in place of Foldkit's default, which is written for developers.
- **A microphone error whose message is only spaces** shows an empty alert. Fall back to the plain sentence.
- **Font.** The system font is fine for now; may be revisited.

> Wording is to be settled when this work starts. Sentry reports errors to a third party, and although no IP address is stored, Sentry attaches an approximate location (country, region, city) to each report, so plain "tracker-free" may claim too much. Kevin's suggestion (2026-11-24): "ad-free, ad-tracker-free" may be the more precise claim.

## Going public

- **Vercel Analytics.** Integrate it. It counts visits without cookies, but it does send every visit to Vercel, so decide it together with the "ad-free, ad-tracker-free" wording and allow its origin in the Content Security Policy.
- **Make the page crawlable.** Remove `noindex` from `vercel.json`, from `DOCUMENT_HEAD` in `src/entry.server.ts` and from `public/404.html`. The pages are already prerendered, so crawlers get content without running JavaScript. Give each page a canonical address while there.
- **Open Graph:** title, description and a share image.
- **Content Security Policy** and the other security headers, in `vercel.json`. The one third-party origin to allow is Sentry's ingest host, `https://o4505247956860928.ingest.us.sentry.io`, so the policy can be strict.
