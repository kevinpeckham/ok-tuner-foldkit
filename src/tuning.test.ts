// TUNING TESTS: the list of tunings and the nearest string
//
// Exercises `src/tuning.ts`: a list of plain data and a few pure functions,
// tested with plain Vitest. Nothing here is Foldkit. A tuning's strings are
// MIDI note numbers (E2 is 40, A4 is 69), in the order the strings sit on the
// instrument. What the page draws from this list is tested in
// `scene.test.ts`.

// `Option` is Effect's type for a value that may be missing. `nearestString`
// returns `Option.some(note)`, or `Option.none()` for a tuning with no
// strings.
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_TUNING_ID,
  TUNINGS,
  isTuningId,
  nearestString,
  tuningById,
} from './tuning'

describe('tunings', () => {
  // Pins the ids and their order. The order is the order of the picker. The
  // ids are what is saved in a person's preferences, so renaming one would
  // send everyone who had chosen it back to standard. The ukulele's strings
  // are not in order of pitch: they follow the instrument.
  test('nine tunings, standard by default', () => {
    expect(TUNINGS.map(tuning => tuning.id)).toEqual([
      'chromatic',
      'standard',
      'drop-d',
      'half-down',
      'dadgad',
      'open-g',
      'bass',
      'bass-5',
      'ukulele',
    ])
    expect(DEFAULT_TUNING_ID).toBe('standard')
    expect(tuningById('standard').notes).toEqual([40, 45, 50, 55, 59, 64])
    expect(tuningById('ukulele').notes).toEqual([67, 60, 64, 69])
  })

  // A saved id that is no longer on the list must not break the page.
  test('an unknown id falls back to standard', () => {
    expect(tuningById('nonsense').id).toBe('standard')
    expect(isTuningId('nonsense')).toBe(false)
    expect(isTuningId('bass-5')).toBe(true)
  })
})

// Which string chip lights up for the note being played.
describe('nearestString', () => {
  // 45 is the A string itself. 30 is below every string, so the lowest (40)
  // is nearest. 57 is exactly halfway between the G string (55) and the B
  // string (59), and the earlier string wins the tie.
  test('picks the closest string, the earlier one on a tie', () => {
    const standard = tuningById('standard')

    expect(nearestString(standard, 45)).toEqual(Option.some(45))
    expect(nearestString(standard, 30)).toEqual(Option.some(40))
    expect(nearestString(standard, 57)).toEqual(Option.some(55))
  })

  // With no strings there is nothing to light, so the answer is `None`.
  test('chromatic has no strings', () => {
    expect(nearestString(tuningById('chromatic'), 45)).toEqual(Option.none())
  })
})
