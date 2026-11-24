// NOTE: detectPitch and levelOf use loops and mutable locals on purpose. Each
// reading compares millions of samples, and this is the one module where the
// project's "no for loops" convention gives way to a tight loop.
import { Option, Schema } from 'effect'

export const Pitch = Schema.Struct({
  frequency: Schema.Number,
  clarity: Schema.Number,
})
export type Pitch = typeof Pitch.Type

export type Note = Readonly<{
  name: string
  octave: number
  midi: number
  cents: number
}>

export type Measurement = Readonly<{
  level: number
  maybePitch: Option.Option<Pitch>
}>

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

const A4_MIDI = 69
const DEFAULT_A4_HZ = 440
const LEVEL_GATE = 0.01
const PEAK_THRESHOLD = 0.93

type DetectOptions = Readonly<{
  minHz?: number
  maxHz?: number
  minClarity?: number
}>

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

const peakLags = (
  nsdf: Float32Array,
  minLag: number,
  maxLag: number,
): Array<number> => {
  const at = (lag: number): number => nsdf[lag] ?? 0
  const peaks: Array<number> = []
  let lag = minLag
  while (lag <= maxLag && at(lag) > 0) {
    lag++
  }
  while (lag <= maxLag) {
    while (lag <= maxLag && at(lag) <= 0) {
      lag++
    }
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

/** The pitch of a buffer by McLeod's normalized square difference: the first
 *  strong peak, refined by a parabola. None when nothing periodic enough is
 *  there. The buffer must hold two periods of the lowest pitch wanted. */
export const detectPitch = (
  samples: Float32Array,
  sampleRate: number,
  { minHz = 40, maxHz = 1500, minClarity = 0.85 }: DetectOptions = {},
): Option.Option<Pitch> => {
  const maxLag = Math.min(samples.length - 2, Math.floor(sampleRate / minHz))
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const nsdf = normalizedSquareDifference(samples, minLag, maxLag)
  const at = (lag: number): number => nsdf[lag] ?? 0

  const peaks = peakLags(nsdf, minLag, maxLag)
  const firstPeak = peaks[0]
  if (firstPeak === undefined) {
    return Option.none()
  }

  let highest = 0
  for (const peak of peaks) {
    highest = Math.max(highest, at(peak))
  }
  if (highest < minClarity) {
    return Option.none()
  }

  const chosen =
    peaks.find(peak => at(peak) >= highest * PEAK_THRESHOLD) ?? firstPeak
  const before = nsdf[chosen - 1] ?? at(chosen)
  const peakValue = at(chosen)
  const after = nsdf[chosen + 1] ?? at(chosen)
  const curvature = before - 2 * peakValue + after
  const shift = curvature === 0 ? 0 : (0.5 * (before - after)) / curvature
  const period = chosen + Math.max(-1, Math.min(1, shift))

  return Option.some({
    frequency: sampleRate / period,
    clarity: Math.min(1, peakValue),
  })
}

const pitchClass = (midi: number): string =>
  NOTE_NAMES[((midi % 12) + 12) % 12] ?? ''

const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1

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

/** The frequency of a MIDI note with A4 at `a4` Hz. */
export const frequencyOfMidi = (midi: number, a4 = DEFAULT_A4_HZ): number =>
  a4 * 2 ** ((midi - A4_MIDI) / 12)

/** "E", "F♯": a note's name without its octave. */
export const noteName = (midi: number): string => pitchClass(midi)

/** "E2", "F♯3": a note's name with its octave. */
export const noteLabel = (midi: number): string =>
  `${pitchClass(midi)}${octaveOf(midi)}`

/** How loud a buffer is, from 0 to 1: four times its RMS, capped. */
export const levelOf = (samples: Float32Array): number => {
  if (samples.length === 0) {
    return 0
  }
  let sumOfSquares = 0
  for (const sample of samples) {
    sumOfSquares += sample * sample
  }
  return Math.min(1, Math.sqrt(sumOfSquares / samples.length) * 4)
}

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
