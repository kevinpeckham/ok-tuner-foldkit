# OK Tuner: design

Date: 2026-11-24. Status: approved by Kevin on 2026-11-24.

## Intent

Kevin is getting his feet wet with Foldkit. The vehicle is a port of the Stem Shovel guitar tuner into a standalone Foldkit app, deployed to Vercel. It may or may not be made public later.

Because the point is learning Foldkit, the idiomatic Foldkit way wins over the shortest port wherever the two differ.

## Goals

- The tuner looks and behaves like the Stem Shovel one: same layout, same pitch logic, same tunings, same saved preferences.
- The code exercises Foldkit's distinctive parts: a managed resource, a subscription, startup flags, Commands, `@foldkit/ui` components, and Story and Scene tests.
- Every tuner behaviour is reachable as a pure function, testable with no microphone.
- It builds and runs on Vercel.

## Non-goals for this version

Each of these is deliberately later, not forgotten:

- Sentry. Kevin wants it, after a working prototype, as its own step.
- Varlock and 1Password. Kevin wants them when the first secret is needed; the tuner needs none, so they most likely arrive with Sentry.
- Starting to listen when the pointer enters the page. The original does this; it is added after the basics work.
- Prerendering and search-engine work. Reconsidered if the tuner goes public.
- Stem Shovel's surroundings: site navigation and footer, page copy loaded from its CMS, listening to the Practice Amp's input, and telling a recorder when the microphone is busy.

## Anti-goals

- Tuner logic that lives outside Foldkit (for example the original engine wrapped in a custom element).
- State held anywhere but the Model, or changed anywhere but `update`.
- A microphone that stays open while the tuner reads as off.
- Audio that is recorded, stored or sent anywhere.

## Constraints

- Foldkit 0.170.0 and Effect 4.1.0, as installed. `FOLDKIT.md` is binding; `repos/foldkit/` is read-only reference.
- The starter's tooling stays: oxfmt, oxlint with the Foldkit plugin, vitest, Tailwind 4. No Biome.
- Commits carry no co-attribution lines.
- The microphone needs a secure origin. The dev URL (`https://ok-tuner.bench.lj.dev/`) and Vercel both are.
- The persistent dev server is already running (see `AGENTS.md`); do not start another.

## Approaches

Three ways to wire the microphone and the pitch readings were considered.

- **A. Managed resource plus subscription.** The microphone and its analyser are a managed resource that exists only while the Model says the tuner is on. A subscription reads it every 50 ms and sends one Message per reading. `update` owns the smoothing and hold logic. This is the shape of Foldkit's `websocket-chat` example (a socket as a managed resource, its traffic as a subscription). It costs twenty Messages a second through `update` and the devtools history.
- **B. One subscription owns everything.** The stream opens the microphone when it starts and closes it when it ends. Fewer concepts, but "starting" and "permission refused" are awkward to represent and the microphone's lifecycle is hidden in a stream.
- **C. The original engine in a custom element.** The fastest port, but the interesting logic sits outside Foldkit.

**Kevin picked A.** It exercises the most of Foldkit and makes the tuner's behaviour pure and testable. B hides the lifecycle that is worth learning; C defeats the purpose.

## What Kevin decided

- Approach A.
- Pitch detection stays an imperative loop in its own module. It runs millions of sample comparisons per reading; Foldkit's "no `for` loops" convention yields here, as it does in Foldkit's own `examples/pixel-art/src/grid.ts`.
- A plain client-rendered build on Vercel.
- An On/Off button only, for now.
- The starter's tooling.
- The dev URL's short name, `ok-tuner`.

## Source being ported

In `~/projects/stem-shovel` (branch `dev`):

| File | What it holds |
|---|---|
| `src/lib/components/Tuner.svelte` | The component: microphone handling, the 50 ms tick, smoothing, and all markup and classes. The layout reference. |
| `src/lib/audio/pitch.ts` | `detectPitch` (McLeod's method), `noteFromFrequency`, `frequencyOfMidi`, `noteLabel`. Pure. |
| `src/lib/audio/pitch.test.ts` | Tests on synthesized tones. |
| `src/lib/constants/tunings.ts` | The nine tunings as MIDI notes; default `standard`. |
| `src/lib/utils/tunerPreferences.ts` | Saved tuning and A4 in `localStorage`, with validation. |
| `scripts/user-docs/tuner-page.md` | The how-to copy. |
| `src/lib/components/ComboBox.svelte`, `ContextMenu.svelte` | The look of the tuning picker and the A4 menu: classes, the caret and the three-dot icon. Reference for appearance only; their behaviour comes from `@foldkit/ui`. |
| `uno.config.ts` | Colour values (`oxford`, `accent`, `maximumYellow`). |

## Design

### Modules

- `src/pitch.ts`: the four pitch functions, ported with their behaviour unchanged. Loops allowed here.
- `src/tuning.ts`: the tuning list, the default, and "which string of this tuning is nearest this note".
- `src/main.ts`: Model, Messages, init, update, Commands, managed resource, subscription, view. Split further only where `FOLDKIT.md`'s file-organisation rule says a seam has formed (builder's call).
- `src/entry.ts`: boots the runtime with flags, the managed resource and the subscription.

### Model

The tuner's power state is one tagged union, so impossible states cannot be written:

- `Off`
- `Starting`: the button was pressed; the permission prompt or audio start is pending.
- `Listening`: carries the input level (0 to 1), the latest reading if any (frequency and clarity), the smoothed needle in cents, and a count of quiet ticks.
- `Failed`: carries the message to show.

Beside it: the chosen tuning id, A4 in Hz, the text currently typed in the A4 field, and the Models of the two `@foldkit/ui` components below.

The note name, octave, cents label, "in tune" and the nearest string are not stored. The view derives them from the reading, A4 and the tuning.

### Microphone: a managed resource

- Required while the power state is `Starting` or `Listening`; released otherwise.
- Acquire: check `navigator.mediaDevices.getUserMedia` exists; request audio with echo cancellation, noise suppression and automatic gain off, 48 kHz and one channel as ideals; create an `AudioContext`, resume it if it is not running (iOS can hand back a suspended one); create an analyser with `fftSize` 4096 and no smoothing; connect the stream to it.
- Release: stop every track and close the context.
- Acquired moves `Starting` to `Listening`. An acquire error moves to `Failed`.
- Error wording, from the original: "Microphone access was refused. Allow it in the browser to tune." for a refused permission, "This browser cannot open the microphone." where the API is missing, and the error's own message otherwise.
- Dropped from the original: setting WebKit's audio session type. It was there because Stem Shovel's player sets "playback"; this app has no player.

### Readings: a subscription

- Active while `Listening`.
- Every 50 ms it reads 4096 samples from the analyser, computes the level (`min(1, rms × 4)`), runs `detectPitch` when the level is above 0.01, and sends one Message carrying the level and the pitch if one was found.
- It looks the microphone up on each tick, not once when the stream starts. In development Vite restores the Model after a full reload without running `init`, so the page can boot already `Listening` before the microphone is acquired again; a single lookup would then leave the tuner showing on with no readings. For the same reason `update` accepts "acquired" while already `Listening`. Production never restores a Model.
- Foldkit's devtools keep 100 Messages by default, about five seconds of readings. Readings stay in the history, with the limit raised to 500 (agreed by Kevin).

### Update: the tuner's behaviour

On each reading, exactly as the original:

- With a pitch: reset the quiet count, keep the reading, and move the needle. If the new cents value is more than 30 from the needle, the needle jumps to it (a new note snaps); otherwise it moves 35% of the way (the same note settles).
- Without a pitch: increase the quiet count. Past 12 quiet ticks (about 0.6 s), clear the reading and zero the needle. Until then the display holds the last note.
- In tune means the needle is within 5 cents.

Pressing the button: from `Off` or `Failed` go to `Starting`; from `Listening` go to `Off`. The button is disabled while `Starting`.

### Preferences

- Read once at startup as flags, from `localStorage` key `oktuner.tuner`, shaped `{ tuningId, a4 }`.
- Validation as the original: A4 must be a number from 400 to 480, otherwise 440. An unknown or missing tuning falls back to `standard` (agreed by Kevin; the original falls back to Chromatic for an unknown id, which reads as a bug).
- A change to the tuning or to A4 updates the Model and issues a Command that writes the pair back. A failed write (private mode, full store) is reported as a Message and otherwise ignored: the choice lasts for the page.
- Reading and writing use Effect's `KeyValueStore` with the browser's `localStorage` layer, as Foldkit's flags documentation does.

### Controls

- Tuning picker: `@foldkit/ui` Listbox (single select), nine options, labelled "Tuning".
- A4: a `@foldkit/ui` Popover holding a number input, 400 to 480 in steps of 1. Each valid value is applied and saved as it is typed. A value outside the range, or an empty field, is not applied, and the field returns to the applied value when the popover closes (agreed by Kevin).
- Both are disabled unless the tuner is `Listening`, as in the original.
- On/Off: a button with a power icon, `aria-pressed` when listening; while starting it shows a spinner and "Starting…" and is `aria-busy`.

### What is on screen

One page: a dark page ground, a short heading, the tuner, and a short how-to beneath.

```
OK Tuner
┌──────────────────────────────────────────────┐  grey pedal body
│ ┌──────────────────────────────────────────┐ │
│ │ ▁▁▁▁▁▁ input level                    ●  │ │  dark screen; light is
│ │                  A 2                     │ │  green when listening
│ │          110.0 Hz · +3 cents · in tune   │ │
│ │   ├───────────────┃──────────────────┤   │ │  needle, green zone ±5
│ │   −50             0                +50   │ │
│ └──────────────────────────────────────────┘ │
│        [E] [A] [D] [G] [B] [E]               │  nearest string lit
│ [ Guitar - Standard            ▾ ]   [ ⋮ ]   │  tuning picker, A4 menu
│ [ ⏻ On / Off ]                OK TUNER 001   │
└──────────────────────────────────────────────┘
Turn the tuner on and play a single string…
```

- The markup follows `Tuner.svelte` element for element: level bar, power light, note and octave, the "Hz · cents · sharp/flat/in tune" line, the needle bar with its centre line and green zone, the −50 / 0 / +50 scale, the string chips, the two controls, the button, an error line, and the model badge.
- Colours match the original: needle and lit string are yellow off pitch and green in tune; the note turns green in tune; everything on the screen dims when off.
- Chromatic shows no string chips.
- Accessibility carried over: the level bar is a meter with its value, the note is a polite live region, the needle and scale are hidden from assistive technology, the strings are a labelled list, the error is an alert. Each string chip carries its target frequency as a tooltip.

Calls made in drafting, all agreed by Kevin on 2026-11-24 (the font "for now; we may revisit later"):

- The badge reads "OK Tuner 001" where the original reads "SS Tuner 001".
- The page title is "OK Tuner | Chromatic Instrument Tuner".
- The how-to is the original's first paragraph and its tips, as static text, minus the Idea Recorder tip and the hover sentence.
- Colours come across as Tailwind theme values in `src/styles.css`; the four icons (power, spinner, the picker's caret, the menu's three dots) are inline SVG from the Phosphor set the original uses.
- The system font stack, not the original's Noto Sans web font.

### Tests

- `src/pitch.test.ts`: the original's tests, ported to vitest.
- `src/story.test.ts`: `update` driven by Messages. Power on, acquired, failed and off; the needle snapping and settling; holding then clearing after quiet ticks; a tuning or A4 change issuing the save Command.
- `src/scene.test.ts`: the view through accessible locators. Off; listening with a note, cents and "in tune"; the nearest string lit; chromatic with no strings; the error alert; controls disabled when off.
- The starter's counter tests are replaced.
- Done means `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` all pass, and the tuner reads a real instrument at the dev URL (Kevin checks this; an agent cannot hear).

### Deployment

- A Vercel project named `ok-tuner`, built with `bun run build`, serving `dist`.
- Team: Lightning Jar, where the Stem Shovel project already lives (Kevin's decision).
- Deployed from a GitHub connection, the same way as Stem Shovel (Kevin's decision): both the `kevinpeckham` and `lightning-jar` GitHub accounts are connected to the Lightning Jar team in Vercel, so the project is linked to `kevinpeckham/ok-tuner-foldkit` and a push to `main` deploys production.
- Production is a public URL even if nobody is told it. Until Kevin decides to make the tuner public, responses carry `X-Robots-Tag: noindex` (Kevin agreed).
- Creating the project and the first deploy are outward-facing: the builder confirms with Kevin before doing them.

## Left to the builder

- The names of Messages, Commands and Model fields, within `FOLDKIT.md`'s conventions.
- Whether `main.ts` splits into `message.ts`, `view.ts` and so on.
- Exact Tailwind classes, so long as the result matches the original's look.
- How the reading subscription shares its sample buffer.

## Housekeeping

- Work happens on the `feat/tuner` branch in the main checkout, not a worktree, because the persistent dev server serves that directory. It merges to `main` by pull request.
- `AGENTS.md` still says `subtree_prompted: false` although the Foldkit source is already vendored at `repos/foldkit/`; set it to `true`.
- `README.md` and `index.html` still carry the starter's names.
