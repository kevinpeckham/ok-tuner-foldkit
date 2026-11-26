// pitch.ts: from raw audio samples to "A2, 3 cents sharp".
//
// What this file is. The tuner's arithmetic. There is no Foldkit and no
// browser API in it: every function takes numbers and returns numbers, so
// all of it is tested on synthesised tones in `pitch.test.ts`, with no
// microphone. It is ported from the Stem Shovel tuner with its behaviour
// unchanged (the tuner design, "Modules").
//
// Where it sits in the app.
//   - `measure` is called by `readMeasurement` in `src/microphone.ts`, once
//     per reading (every 50 ms while the tuner listens). What it returns
//     becomes the payload of the `MeasuredInput` Message in `src/main.ts`.
//   - `Pitch` is a field type in the Model and in that Message.
//   - `noteFromFrequency` is used by `update` in `main.ts` (to move the
//     needle) and by `src/view.ts` (to name the note). `frequencyOfMidi` and
//     `noteName` are used by the view for the row of strings.
//
// The two ideas in the file.
//   1. Pitch detection (`detectPitch`): find how long the sound takes to
//      repeat. That length is the period, and frequency = sample rate /
//      period. The method is McLeod's, explained step by step above each
//      function that takes part.
//   2. Note naming (`noteFromFrequency`): turn a frequency into the nearest
//      note and how far off it is.
//
// Why this file alone uses `for`, `while` and `let`. FOLDKIT.md ("Code
// Style") says never to use `for` loops or `let` for iteration, and the rest
// of `src` follows it. Here the cost decides. One reading multiplies about
// four million pairs of samples (at 48 kHz: some 1,170 candidate lags, each
// compared across up to 4,064 samples), up to twenty times a second, on the
// main thread. A plain loop over a typed array does that with no function
// call and no intermediate array per sample. The exemption is for this file
// only: see AGENTS.md, "Conventions that differ from Foldkit's defaults",
// and FINDINGS.md, "Pitch detection runs in plain loops".
//
// Read this file first: it needs nothing else in `src`. Then
// `src/microphone.ts`.

// NOTE: detectPitch and levelOf use loops and mutable locals on purpose. Each
// reading compares millions of samples, and this is the one module where the
// project's "no for loops" convention gives way to a tight loop.

// `Option` (Effect) is a value that may be absent: `Option.some(x)` or
// `Option.none()`. It is used here for "no pitch found", where plain
// TypeScript might return null. `Schema` (Effect) describes a type in a form
// that also exists at runtime.
import { Option, Schema } from 'effect'

// One detected pitch. `Schema.Struct` describes an object shape as a runtime
// value, and that value does two jobs.
//   - It is a Schema, which Foldkit needs: every field of the Model and
//     every Message payload is declared with Schemas (FOLDKIT.md, "Project
//     Conventions": "the model is a schema"). `main.ts` uses `Pitch` in
//     both, as `Schema.Option(Pitch)`: the type of `maybeReading` in the
//     `Listening` state and of `maybePitch` in the `MeasuredInput` Message.
//   - The line after it reads the plain TypeScript type back off the Schema
//     with `.Type`, so the shape is written once and the validator and the
//     type cannot drift apart. The `const` and the `type` share one name on
//     purpose: TypeScript keeps values and types apart.
// `frequency` is in Hz. `clarity` is how closely the sound repeats: at most
// 1, and close to 1 for a clean sustained note.
export const Pitch = Schema.Struct({
  frequency: Schema.Number,
  clarity: Schema.Number,
})
export type Pitch = typeof Pitch.Type

// A frequency named as a note. A plain TypeScript type, not a Schema,
// because it is never stored in the Model: `update` and the view work it out
// from the reading each time they need it (FOLDKIT.md allows plain types
// outside the Model).
//   - `name`: the pitch class, "C" to "B", with ♯ for the notes in between.
//   - `octave`: scientific pitch notation, in which middle C is C4 and the A
//     above it is A4.
//   - `midi`: the MIDI note number, one whole number per semitone (A4 = 69).
//   - `cents`: how far the frequency is from that note, in hundredths of a
//     semitone. Negative is flat, positive is sharp.
export type Note = Readonly<{
  name: string
  octave: number
  midi: number
  cents: number
}>

// What one reading of the microphone gives: how loud the input is (0 to 1)
// and the pitch, if one was found. The field is called `maybePitch` because
// this project prefixes every Option-typed value with `maybe` (FOLDKIT.md,
// "Code Style"). The shape matches the payload of the `MeasuredInput`
// Message, so `main.ts` passes a Measurement straight to that constructor.
export type Measurement = Readonly<{
  level: number
  maybePitch: Option.Option<Pitch>
}>

// The twelve pitch classes of an octave, a semitone apart, starting from C.
// MIDI note 0 is a C, so a note's name is at index `midi % 12`. Sharps only:
// the tuner never prints a flat name.
const NOTE_NAMES: ReadonlyArray<string> = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
]

// The MIDI number of A4, the note every other pitch is measured from.
const A4_MIDI = 69

// Concert pitch: A4 = 440 Hz. A default only. The person can set A4 anywhere
// from 400 to 480 Hz (see `src/preferences.ts`), and the app's callers pass
// that value in.
const DEFAULT_A4_HZ = 440

// The level (see `levelOf` below) at or under which `measure` does not look
// for a pitch at all: the input is treated as silence. The value is the
// original tuner's.
const LEVEL_GATE = 0.01

// The share of the highest peak that an earlier peak must reach to be chosen
// in its place. Step 5 at `detectPitch` explains what it is for. The value is
// the original tuner's.
const PEAK_THRESHOLD = 0.93

// The optional third argument of `detectPitch`. Each field has a default in
// that function's signature, and the app itself always uses the defaults.
//   - `minHz`, `maxHz`: the range of frequencies to search.
//   - `minClarity`: how closely the sound must repeat to count as a note.
type DetectOptions = Readonly<{
  minHz?: number
  maxHz?: number
  minClarity?: number
}>

// PITCH DETECTION, STEP 1: the normalised square difference function (NSDF),
// one value for each candidate lag.
//
// The question it answers: if the buffer is slid along itself by `lag`
// samples, how well does the shifted copy line up with the original? For a
// steady note, sliding by exactly one period puts every wave on top of the
// next one. So the lags where the two line up are the candidate periods.
//
// For one lag, over every pair of samples `a = samples[index]` and
// `b = samples[index + lag]`:
//
//   correlation = sum of a × b       large when the pairs agree
//   energy      = sum of a² + b²     how loud those samples are
//   nsdf[lag]   = 2 × correlation / energy
//
// Dividing by the energy is the "normalised" part. Since a² + b² is never
// less than 2ab in size, the result is always between -1 and 1, however loud
// or quiet the input is:
//
//    1   the shifted copy matches exactly (a = b in every pair)
//    0   the two are unrelated
//   -1   the shifted copy is the exact opposite (a = -b in every pair)
//
// So a value near 1 at some lag means "the sound repeats every `lag`
// samples", and how near it is to 1 says how sure that is. That height is
// what becomes the `clarity` of a Pitch.
//
// Where the name comes from: the square difference is the sum of (a - b)²,
// which works out as energy - 2 × correlation. So nsdf = 1 - (square
// difference / energy). A small difference between the buffer and its
// shifted copy is the same thing as a value near 1.
//
// Only lags from `minLag` to `maxLag` are computed. The result is a
// Float32Array indexed by lag, and its entries below `minLag` stay 0.
//
// `samples[index] ?? 0`: tsconfig.json sets `noUncheckedIndexedAccess`, so
// reading an element by index has the type `number | undefined`. The loop
// bounds keep every index inside the buffer, and `?? 0` satisfies the type
// without a cast (which the lint does not allow).
//
// This double loop is the expensive part of the file, and the reason for the
// exemption described at the top.
const normalizedSquareDifference = (
  samples: Float32Array,
  minLag: number,
  maxLag: number,
): Float32Array => {
  const size = samples.length
  const nsdf = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0
    let energy = 0
    for (let index = 0; index + lag < size; index++) {
      const a = samples[index] ?? 0
      const b = samples[index + lag] ?? 0
      correlation += a * b
      energy += a * a + b * b
    }
    nsdf[lag] = energy > 0 ? (2 * correlation) / energy : 0
  }
  return nsdf
}

// PITCH DETECTION, STEP 2: find the candidate periods.
//
// Plotted against lag, the NSDF of a steady note is itself a wave. It is
// high at the smallest lags (a signal shifted by almost nothing still matches
// itself), dips below zero, and then rises into a positive hump once for
// every period. This function returns the lag at the top of each positive
// hump, smallest lag first.
//
//   - The first `while` walks off the end of the opening hump. Those values
//     are high only because the shift is small, and say nothing about the
//     period.
//   - The outer `while` then repeats two moves: skip a stretch at or below
//     zero, then walk a positive stretch and remember where it was highest.
//   - `best > 0` fails only when the walk found no positive value at all,
//     which happens when the lags run out during a stretch below zero.
//
// `at(lag)` is the same `?? 0` guard as in step 1, for reads of the NSDF.
const peakLags = (
  nsdf: Float32Array,
  minLag: number,
  maxLag: number,
): Array<number> => {
  const at = (lag: number): number => nsdf[lag] ?? 0
  const peaks: Array<number> = []
  let lag = minLag
  // Leave the opening hump.
  while (lag <= maxLag && at(lag) > 0) {
    lag++
  }
  while (lag <= maxLag) {
    // Skip the stretch at or below zero.
    while (lag <= maxLag && at(lag) <= 0) {
      lag++
    }
    // Walk one positive hump, keeping the lag of its highest value.
    let best = -1
    let bestValue = 0
    while (lag <= maxLag && at(lag) > 0) {
      if (at(lag) > bestValue) {
        bestValue = at(lag)
        best = lag
      }
      lag++
    }
    if (best > 0) {
      peaks.push(best)
    }
  }
  return peaks
}

// PITCH DETECTION, THE WHOLE METHOD. The numbered steps below are marked in
// the body of the function.
//
//   1. Turn the range of frequencies into a range of lags. A lag is a period
//      counted in samples, so lag = sampleRate / frequency: the highest
//      frequency wanted gives the smallest lag, and the lowest gives the
//      largest. At 48 kHz the defaults (28 Hz to 1500 Hz) give lags 32 to
//      1714. `maxLag` is also capped by the length of the buffer. The
//      default `minHz` of 28 sits under the lowest string in the app's
//      list, the low B of a five-string bass (30.87 Hz), with room for a
//      string that is flat. It was 40 until 2026-11-25, which sat just
//      under a four-string bass's low E and could not hear that B at all
//      (FINDINGS.md, "The tuner could not hear a five-string bass's low
//      B").
//
//   2. Work out the NSDF over those lags (`normalizedSquareDifference`).
//
//   3. List the top of each positive hump (`peakLags`). With no peak there
//      is no pitch.
//
//   4. The clarity check. If even the highest peak is below `minClarity`
//      (0.85), the sound does not repeat well enough to be called a note, as
//      with noise, and the answer is none.
//
//   5. Choose the FIRST peak that reaches PEAK_THRESHOLD (93%) of the
//      highest. Not the highest itself. A sound that repeats every N samples
//      also repeats every 2N and every 3N, so there are humps at all of
//      those lags, of nearly the same height, and the highest of them can
//      happen to be a later one. Choosing that one would report a half or a
//      third of the true frequency (a half is the same note, an octave too
//      low). The earliest strong peak is the shortest period that fits,
//      which is the note being played. The threshold is under 100% so that a
//      first peak a little lower than a later one still wins. It is not much
//      lower, so that a small early hump does not win in its place.
//
//   6. Parabolic refinement. The peak found so far is a whole number of
//      samples, and whole samples are too coarse for a tuner. At 48 kHz a
//      period of 109 samples is 440.4 Hz and 110 samples is 436.4 Hz: one
//      sample apart, and about 16 cents apart. The true top of the hump lies
//      somewhere between samples. So a parabola is fitted through the peak
//      and its two neighbours (`before`, `peakValue`, `after`), and `shift`
//      is where the top of that parabola lies, as a fraction of a sample to
//      the left or right of the peak. A flat top (`curvature === 0`) means
//      no shift, and the shift is limited to one sample either way.
//
//   7. frequency = sampleRate / period. The clarity is the height of the
//      chosen peak, capped at 1.
//
// The result is an `Option`: `Option.none()` for "no pitch", and
// `Option.some({ frequency, clarity })` otherwise. A caller cannot forget
// the empty case, because it has to unwrap the Option to get at the pitch:
// `update` in `main.ts` does so with `Option.match`.
/** The pitch of a buffer by McLeod's normalized square difference: the first
 *  strong peak, refined by a parabola. None when nothing periodic enough is
 *  there. The buffer must hold two periods of the lowest pitch wanted. */
export const detectPitch = (
  samples: Float32Array,
  sampleRate: number,
  { minHz = 28, maxHz = 1500, minClarity = 0.85 }: DetectOptions = {},
): Option.Option<Pitch> => {
  // Step 1: the range of lags to search.
  const maxLag = Math.min(samples.length - 2, Math.floor(sampleRate / minHz))
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  // Step 2: the NSDF, and a guarded way to read it.
  const nsdf = normalizedSquareDifference(samples, minLag, maxLag)
  const at = (lag: number): number => nsdf[lag] ?? 0

  // Step 3: the candidate periods. `peaks[0]` is typed `number | undefined`
  // (see `noUncheckedIndexedAccess` above), so this check also tells
  // TypeScript that `firstPeak` is a number from here on.
  const peaks = peakLags(nsdf, minLag, maxLag)
  const firstPeak = peaks[0]
  if (firstPeak === undefined) {
    return Option.none()
  }

  // Step 4: the clarity check on the highest peak.
  let highest = 0
  for (const peak of peaks) {
    highest = Math.max(highest, at(peak))
  }
  if (highest < minClarity) {
    return Option.none()
  }

  // Step 5: the first peak close enough to the highest. `find` always finds
  // one here (the highest peak itself passes); `?? firstPeak` is for the
  // type, which says `find` may return undefined.
  const chosen =
    peaks.find(peak => at(peak) >= highest * PEAK_THRESHOLD) ?? firstPeak
  // Step 6: fit a parabola through the peak and its neighbours. A neighbour
  // outside the array is read as the peak's own value.
  const before = nsdf[chosen - 1] ?? at(chosen)
  const peakValue = at(chosen)
  const after = nsdf[chosen + 1] ?? at(chosen)
  const curvature = before - 2 * peakValue + after
  const shift = curvature === 0 ? 0 : (0.5 * (before - after)) / curvature
  const period = chosen + Math.max(-1, Math.min(1, shift))

  // Step 7: the period in samples becomes a frequency in Hz.
  return Option.some({
    frequency: sampleRate / period,
    clarity: Math.min(1, peakValue),
  })
}

// FROM FREQUENCY TO NOTE. Everything from here to `noteLabel` works in MIDI
// note numbers: whole numbers, one per semitone, with A4 at 69.

// The name of a MIDI note without its octave. `((midi % 12) + 12) % 12` is a
// remainder that is never negative: in JavaScript `-1 % 12` is -1, and the
// extra step turns that into 11. `?? ''` is the indexed-read guard again.
const pitchClass = (midi: number): string =>
  NOTE_NAMES[((midi % 12) + 12) % 12] ?? ''

// The octave of a MIDI note, in scientific pitch notation. The octave number
// goes up at each C, and MIDI 0 is the C of octave -1, hence the `- 1`:
// MIDI 60 is C4 (middle C) and MIDI 69 is A4.
const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1

// How a frequency becomes a note and cents. In equal temperament every
// semitone multiplies the frequency by the same ratio, the twelfth root of
// 2, so that twelve semitones double it (one octave). Turned round, the
// number of semitones from one frequency up to another is
// 12 × log2(higher / lower). So
//
//   exactMidi = 69 + 12 × log2(frequency / a4)
//
// is the pitch as a MIDI number with a fraction: 69 for A4 itself, 70 for
// the semitone above it, 69.5 for exactly half way between. Rounding gives
// the nearest note, and what the rounding took away is the error. A cent is
// a hundredth of a semitone, so cents = (exactMidi - midi) × 100. Rounding
// never moves a number by more than a half, which is why the cents always
// lie between -50 and 50. The last line of the return rounds the cents to
// one decimal place.
//
// `a4` is the person's reference pitch, 440 Hz unless they change it in the
// A4 menu. `update` and the view both pass `model.a4`, so changing it moves
// every note together.
/** The nearest note to a frequency and how far off it is, in cents from −50
 *  to 50, with A4 at `a4` Hz. */
export const noteFromFrequency = (
  frequency: number,
  a4 = DEFAULT_A4_HZ,
): Note => {
  const exactMidi = A4_MIDI + 12 * Math.log2(frequency / a4)
  const midi = Math.round(exactMidi)
  return {
    name: pitchClass(midi),
    octave: octaveOf(midi),
    midi,
    cents: Math.round((exactMidi - midi) * 100 * 10) / 10,
  }
}

// The same relation solved the other way: a note's frequency from its
// number. Each semitone away from A4 multiplies `a4` by the twelfth root of
// 2. `src/view.ts` uses it for the tooltip on each string, which shows the
// frequency that string should be tuned to.
/** The frequency of a MIDI note with A4 at `a4` Hz. */
export const frequencyOfMidi = (midi: number, a4 = DEFAULT_A4_HZ): number =>
  a4 * 2 ** ((midi - A4_MIDI) / 12)

// The exported form of `pitchClass`. `src/view.ts` uses it to label each
// string of the chosen tuning.
/** "E", "F♯": a note's name without its octave. */
export const noteName = (midi: number): string => pitchClass(midi)

// Came across with the port. Nothing in the app calls it at present: only
// `pitch.test.ts` does.
/** "E2", "F♯3": a note's name with its octave. */
export const noteLabel = (midi: number): string =>
  `${pitchClass(midi)}${octaveOf(midi)}`

// LEVEL AND MEASURE

// RMS is the root of the mean of the squares: square every sample, average
// the squares, take the square root. Squaring makes the negative half of the
// wave count as much as the positive half, so the result is a single figure
// for how strong the signal is. The level is four times that, capped at 1,
// so an RMS of 0.25 or more reads as full. The factor is the original
// tuner's. The view draws the level as the bar at the top of the screen, and
// `measure` below uses it to decide whether to look for a pitch.
/** How loud a buffer is, from 0 to 1: four times its RMS, capped. */
export const levelOf = (samples: Float32Array): number => {
  // An empty buffer would divide by zero below.
  if (samples.length === 0) {
    return 0
  }
  let sumOfSquares = 0
  for (const sample of samples) {
    sumOfSquares += sample * sample
  }
  return Math.min(1, Math.sqrt(sumOfSquares / samples.length) * 4)
}

// The one function the rest of the app calls for a reading
// (`readMeasurement` in `src/microphone.ts`). The level is always worked out,
// because the level bar moves even when no note is sounding. Pitch detection
// is the costly part, and LEVEL_GATE skips it for input too quiet to hold a
// note. The result goes, unchanged, into the `MeasuredInput` Message, and
// `update` decides what a reading with or without a pitch does to the Model.
/** One reading of a buffer: its level, and its pitch when it is loud enough
 *  to be worth looking for one. */
export const measure = (
  samples: Float32Array,
  sampleRate: number,
): Measurement => {
  const level = levelOf(samples)
  return {
    level,
    maybePitch:
      level > LEVEL_GATE ? detectPitch(samples, sampleRate) : Option.none(),
  }
}
