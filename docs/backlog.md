# Backlog

Work that is planned but not started. Nothing here is scheduled. Do not pick an item up as a side effect of other work: each one starts when Kevin says so.

Items are grouped by kind, not ranked.

## Microphone and listening

- **Microphone lost mid-session.** If the microphone is unplugged or permission is revoked while the tuner is on, the tuner stays on and silent. Detect it (the track's `ended` event, the permission's `change` event) and show a clear notice with what to do next.
- **Waiting for permission.** While the browser's permission prompt is open the button says "Starting…" and nothing else. Say that the browser is waiting for microphone permission when that is the case, and consider a way to cancel.
- **Start listening when the pointer enters the page.** Agreed during design, to follow the basics.
- **Pitch detection off the main thread.** `detectPitch` runs on the main thread every 50 ms. Weigh an `AudioWorklet` or a Web Worker: the gain is a steadier needle on slow phones, the cost is a second build entry and message passing. Measure on a slow phone before deciding.
- **Power button while starting.** It keeps the pointer cursor and hover colour although it is disabled.
- **Development only:** a hot reload that restores "on" may leave the audio context suspended until a click.

## Screen readers and keyboard

- **Sharp, flat and in tune are not announced.** Only the note name is in the live region, because the detail line changes twenty times a second. Find a way to announce the tuning state without flooding (announce on change of state, not of value).
- **The two E strings read the same.** Give each string an accessible name that tells low E from high E (for example the octave, "E2" and "E4").
- **Opening the A4 menu focuses the panel, not the field.** `focusSelector: '#a4-input'` on the Popover is the likely fix; unverified.
- **The chosen tuning is nearly invisible while the tuner is off** (5% opacity, as in the original). Reconsider.
- **Failure text contrast** is about 4.1:1 on the lower body, under the 4.5:1 target.

## Model and code

- **Tuning id as a plain string.** `tuningId` is `Schema.String`, with unknown ids falling back to standard. Reconsider a literal union of the nine ids, so an invalid id cannot be represented.
- **A4 field accepts decimals** such as 442.5 and forms such as "4e2". The design says steps of 1. Decide, then change `parseA4` and the test that pins 442.5.
- **"-0 cents".** A needle between −0.5 and 0 prints "-0 cents", as the original does.

## Tests

- Two scene tests assert only that something is absent ("no reading", "chromatic shows no strings"). Add a positive assertion to each.
- Untested: the readings stream itself, analyser wiring failing after the audio context exists, and a rejected `resume()` or `close()`.
- Picker and menu click-through is covered by a headless-browser check, not by the suite.

## Page content

- **Footer:** copyright, attribution, and links to Stem Shovel and Lightning Jar.
- **Ad-free and tracker-free, in the title.** Update the page title to say so.
- **Ad-free and tracker-free, in the copy.** Add a line to the page saying so.
- **Favicon.** There is none, so every load logs one 404.
- **Font.** The system font is fine for now; may be revisited.

> Before the page claims "tracker-free": Sentry is also planned. Error reporting sends data about a visit to a third party. Decide whether Sentry fits the claim (errors only, no session replay, no performance tracing, no user identifiers), and word the claim to match what the page really does.

## Going public

- **Make the page crawlable.** Remove `noindex` from `vercel.json` and `index.html`, and prerender the page so crawlers get content without running JavaScript.
- **Open Graph:** title, description and a share image.
- **Content Security Policy** and the other security headers, in `vercel.json`. The app needs no third-party origins today, so the policy can be strict; Sentry would add one.

## Tooling and services

- **Sentry.** After a working prototype.
- **Varlock and 1Password,** when the first secret is needed (most likely with Sentry).
