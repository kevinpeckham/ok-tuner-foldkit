// PITCH TESTS: the arithmetic of tuning
//
// Exercises `src/pitch.ts`: finding the pitch in a buffer of samples, naming
// the note, and measuring how loud the input is. These are plain functions
// tested with plain Vitest. Nothing in this file is Foldkit, and the only
// Effect in it is `Option`. The tests came with the tuner this app is a port
// of and were moved to Vitest (the tuner design, "Tests").
//
// The inputs are tones made in code, so the tests show that the arithmetic
// is right for a clean signal. They cannot show how a real instrument sounds
// through a real microphone. A person checks that, at the dev URL.

// `Option` is Effect's type for a value that may be missing. `detectPitch`
// returns `Option.some(pitch)` when it finds a note and `Option.none()` when
// it does not. This file imports no `Array` from Effect, so `Array` below is
// JavaScript's own.
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { WINDOW } from './microphone'
import {
  detectPitch,
  frequencyOfMidi,
  levelOf,
  measure,
  noteFromFrequency,
  noteLabel,
  noteName,
  spokenNoteLabel,
} from './pitch'
import { TUNINGS } from './tuning'

// Samples per second: the rate the app asks the microphone for.
const RATE = 48000

// A note made in code: a sine wave at `hz` with two quieter overtones, at
// twice and three times the frequency. The default length, 0.05 seconds, is
// 2400 samples.
const tone = (
  hz: number,
  seconds = 0.05,
  harmonics: ReadonlyArray<number> = [1, 0.5, 0.25],
): Float32Array =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, index) =>
    harmonics.reduce(
      (sum, amplitude, harmonic) =>
        sum +
        amplitude *
          Math.sin((2 * Math.PI * hz * (harmonic + 1) * index) / RATE),
      0,
    ),
  )

// How far the detected pitch is from `hz`, in cents. A cent is a hundredth
// of a semitone, so there are 1200 to the octave. `Option.match` runs one of
// two functions, depending on whether the Option holds a value. Finding no
// pitch counts as infinitely far off, so a "less than" assertion fails.
const centsOff = (samples: Float32Array, hz: number): number =>
  Option.match(detectPitch(samples, RATE), {
    onNone: () => Number.POSITIVE_INFINITY,
    onSome: ({ frequency }) => Math.abs(1200 * Math.log2(frequency / hz)),
  })

// The detector itself. It must find a note where there is one and, just as
// much, report nothing where there is none.
describe('detectPitch', () => {
  // The six open strings of a guitar in standard tuning. Each must read
  // within one cent, and with a clarity above 0.9. Clarity is the detector's
  // own measure of how periodic the signal is, at most 1.
  test.each([
    ['E2', 82.41],
    ['A2', 110],
    ['D3', 146.83],
    ['G3', 196],
    ['B3', 246.94],
    ['E4', 329.63],
  ])('guitar string %s reads within a cent', (_name, hz) => {
    const maybePitch = detectPitch(tone(hz), RATE)

    expect(centsOff(tone(hz), hz)).toBeLessThan(1)
    expect(
      Option.match(maybePitch, {
        onNone: () => 0,
        onSome: ({ clarity }) => clarity,
      }),
    ).toBeGreaterThan(0.9)
  })

  // Towards the two ends of the range: the lowest string of a bass (41.2 Hz)
  // and a note three octaves above the guitar's open A string (880 Hz).
  test('a bass low E and a high fret still read', () => {
    expect(centsOff(tone(41.2), 41.2)).toBeLessThan(2)
    expect(centsOff(tone(880), 880)).toBeLessThan(1)
  })

  // A buffer of zeros. `Option.isNone` is true when the Option is empty.
  // The lowest string the app lists is the low B of a five-string bass,
  // 30.87 Hz. One period of it is longer than the default 0.05 s tone holds
  // twice over, so these tones are as long as the app's real window:
  // `WINDOW` samples (src/microphone.ts). The second is the same string a
  // good half-semitone flat, which is where someone tuning up starts.
  test('the low B of a five-string bass reads, in tune and flat', () => {
    const windowSeconds = WINDOW / RATE

    expect(centsOff(tone(30.87, windowSeconds), 30.87)).toBeLessThan(3)
    expect(centsOff(tone(30.0, windowSeconds), 30.0)).toBeLessThan(3)
  })

  // Every string of every tuning in the list, at the app's window length.
  // The guard against a tuning being added whose strings the detector
  // cannot hear.
  test.each(
    TUNINGS.flatMap(tuning =>
      tuning.notes.map(midi => [tuning.label, midi] as const),
    ),
  )('%s, MIDI note %i, reads within three cents', (_label, midi) => {
    const hz = frequencyOfMidi(midi)

    expect(centsOff(tone(hz, WINDOW / RATE), hz)).toBeLessThan(3)
  })

  test('silence reads as nothing', () => {
    expect(Option.isNone(detectPitch(new Float32Array(2048), RATE))).toBe(true)
  })

  // Noise has no pitch, and the tuner must not invent one. The noise is a
  // fixed sequence, not `Math.random()`: each value is the one before it
  // times 16807, modulo 2147483647. The test is the same on every run.
  test('noise reads as nothing', () => {
    const seeds = Array.from({ length: 2048 }).reduce<ReadonlyArray<number>>(
      previous => [
        ...previous,
        ((previous[previous.length - 1] ?? 1) * 16807) % 2147483647,
      ],
      [],
    )
    const noise = Float32Array.from(seeds, seed => seed / 2147483647 - 0.5)

    expect(Option.isNone(detectPitch(noise, RATE))).toBe(true)
  })
})

// From a frequency to what the screen shows: the nearest note's name and
// octave, and how many cents the frequency is from it. `midi` is the note's
// MIDI number (A4 is 69), which is how the tunings list their strings.
describe('noteFromFrequency', () => {
  test('names, octaves and cents', () => {
    expect(noteFromFrequency(440)).toEqual({
      name: 'A',
      octave: 4,
      midi: 69,
      cents: 0,
    })
    expect(noteFromFrequency(82.41).name).toBe('E')
    expect(noteFromFrequency(82.41).octave).toBe(2)
    expect(noteFromFrequency(445).cents).toBeCloseTo(19.6, 0)
    expect(noteFromFrequency(435).cents).toBeCloseTo(-19.8, 0)
    expect(noteFromFrequency(370).name).toBe('F♯')
  })

  // The second argument is A4 in Hz, the reference every other note is
  // worked out from. It is the A4 setting in the tuner's menu.
  test('a different reference pitch moves the grid', () => {
    expect(noteFromFrequency(432, 432).cents).toBe(0)
    expect(frequencyOfMidi(69, 442)).toBe(442)
    expect(noteLabel(40)).toBe('E2')
  })
})

// The name on a string chip: the note without its octave.
describe('noteName', () => {
  test('drops the octave', () => {
    expect(noteName(40)).toBe('E')
    expect(noteName(54)).toBe('F♯')
  })
})

// The name a screen reader is given: the note with its octave, and a sharp
// written as the word. The sign "♯" may be passed over in silence, and
// "F3" for an F sharp would be the wrong note.
describe('spokenNoteLabel', () => {
  test('a natural note keeps its short form', () => {
    expect(spokenNoteLabel(40)).toBe('E2')
    expect(spokenNoteLabel(64)).toBe('E4')
  })

  test('a sharp is spelt out', () => {
    expect(spokenNoteLabel(54)).toBe('F sharp 3')
    expect(spokenNoteLabel(39)).toBe('D sharp 2')
  })
})

// The number behind the input level bar, from 0 to 1. RMS (root mean square)
// is the usual measure of how loud a buffer of samples is.
describe('levelOf', () => {
  test('is four times the RMS, capped at 1', () => {
    expect(levelOf(new Float32Array(4096))).toBe(0)
    expect(levelOf(new Float32Array(4096).fill(0.1))).toBeCloseTo(0.4, 5)
    expect(levelOf(new Float32Array(4096).fill(0.5))).toBe(1)
  })
})

// `measure` is what the app calls for each reading. It always gives the
// level, and looks for a pitch only when the level is above a small
// threshold (the gate), so near-silence is never searched for a note. The
// buffers here are 4096 samples, the size the app reads from the microphone.
describe('measure', () => {
  test('reads a pitch only above the level gate', () => {
    const quiet = tone(110, 4096 / RATE).map(sample => sample * 0.001)
    expect(Option.isNone(measure(quiet, RATE).maybePitch)).toBe(true)

    const loud = measure(tone(110, 4096 / RATE), RATE)
    expect(Option.isSome(loud.maybePitch)).toBe(true)
    expect(loud.level).toBeGreaterThan(0.01)
  })
})
