import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  detectPitch,
  frequencyOfMidi,
  levelOf,
  measure,
  noteFromFrequency,
  noteLabel,
  noteName,
} from './pitch'

const RATE = 48000

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

const centsOff = (samples: Float32Array, hz: number): number =>
  Option.match(detectPitch(samples, RATE), {
    onNone: () => Number.POSITIVE_INFINITY,
    onSome: ({ frequency }) => Math.abs(1200 * Math.log2(frequency / hz)),
  })

describe('detectPitch', () => {
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

  test('a bass low E and a high fret still read', () => {
    expect(centsOff(tone(41.2), 41.2)).toBeLessThan(2)
    expect(centsOff(tone(880), 880)).toBeLessThan(1)
  })

  test('silence reads as nothing', () => {
    expect(Option.isNone(detectPitch(new Float32Array(2048), RATE))).toBe(true)
  })

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

  test('a different reference pitch moves the grid', () => {
    expect(noteFromFrequency(432, 432).cents).toBe(0)
    expect(frequencyOfMidi(69, 442)).toBe(442)
    expect(noteLabel(40)).toBe('E2')
  })
})

describe('noteName', () => {
  test('drops the octave', () => {
    expect(noteName(40)).toBe('E')
    expect(noteName(54)).toBe('F♯')
  })
})

describe('levelOf', () => {
  test('is four times the RMS, capped at 1', () => {
    expect(levelOf(new Float32Array(4096))).toBe(0)
    expect(levelOf(new Float32Array(4096).fill(0.1))).toBeCloseTo(0.4, 5)
    expect(levelOf(new Float32Array(4096).fill(0.5))).toBe(1)
  })
})

describe('measure', () => {
  test('reads a pitch only above the level gate', () => {
    const quiet = tone(110, 4096 / RATE).map(sample => sample * 0.001)
    expect(Option.isNone(measure(quiet, RATE).maybePitch)).toBe(true)

    const loud = measure(tone(110, 4096 / RATE), RATE)
    expect(Option.isSome(loud.maybePitch)).toBe(true)
    expect(loud.level).toBeGreaterThan(0.01)
  })
})
