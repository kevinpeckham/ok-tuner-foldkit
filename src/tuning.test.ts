// TUNING TESTS: the list of tunings, the nearest string, and a string's key
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
  type Tuning,
  isTuningId,
  nearestString,
  stringKey,
  tuningById,
} from './tuning'

describe('tunings', () => {
  // Pins the ids and their order. The order is the order of the picker. The
  // ids are what is saved in a person's preferences, so renaming one would
  // send everyone who had chosen it back to standard. New tunings go on the
  // end, so the list a person knows does not move under them.
  test('eleven tunings, standard by default', () => {
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
      'mandolin',
      'banjo',
    ])
    expect(DEFAULT_TUNING_ID).toBe('standard')
    expect(tuningById('standard').notes).toEqual([40, 45, 50, 55, 59, 64])
  })

  // The strings follow the instrument, not the order of their pitches. A
  // ukulele's G string (G4, 67) is tuned above the C beside it. A five-string
  // banjo's short fifth string (G4, 67) is its highest, and sits where a
  // guitar's lowest would: it comes first, as a player reads the instrument.
  test('the ukulele and the banjo list a high string first', () => {
    expect(tuningById('ukulele').notes).toEqual([67, 60, 64, 69])
    expect(tuningById('banjo').notes).toEqual([67, 50, 55, 59, 62])
  })

  // A mandolin has eight strings in four pairs, and both strings of a pair
  // are tuned to the same note. The tuning lists each pair once: G3 D4 A4 E5.
  // A tuner hears a note, not which of two strings made it.
  test('the mandolin lists one note for each pair of strings', () => {
    expect(tuningById('mandolin').notes).toEqual([55, 62, 69, 76])
  })

  // The labels are what the picker shows.
  test('the two newest tunings are labelled like the others', () => {
    expect(tuningById('mandolin').label).toBe('Mandolin - Standard')
    expect(tuningById('banjo').label).toBe('Banjo - Open G')
  })

  // A saved id that is no longer on the list must not break the page.
  test('an unknown id falls back to standard', () => {
    expect(tuningById('nonsense').id).toBe('standard')
    expect(isTuningId('nonsense')).toBe(false)
    expect(isTuningId('bass-5')).toBe(true)
    expect(isTuningId('mandolin')).toBe(true)
    expect(isTuningId('banjo')).toBe(true)
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

  // The banjo's high G (67) is its first string. It is found like any other:
  // the nearest note wins, wherever it sits in the list. 392 Hz is that G,
  // and the D below it (62) is the last string.
  test("finds the banjo's high first string", () => {
    const banjo = tuningById('banjo')

    expect(nearestString(banjo, 67)).toEqual(Option.some(67))
    expect(nearestString(banjo, 62)).toEqual(Option.some(62))
    expect(nearestString(banjo, 50)).toEqual(Option.some(50))
  })

  // With no strings there is nothing to light, so the answer is `None`.
  test('chromatic has no strings', () => {
    expect(nearestString(tuningById('chromatic'), 45)).toEqual(Option.none())
  })
})

// The key the view gives each string chip (`stringView` in `src/view.ts`).
// Foldkit matches the chips of one render to the chips of the next by key, so
// two chips in one row must never share one.
describe('stringKey', () => {
  // A tuning that is not on the list, made up for these tests: four strings
  // on two notes, as a mandolin would be if each of its eight strings were
  // listed. No listed tuning repeats a note today. A key made from the note
  // (which is what the chips had at first) gives this one two pairs of
  // identical keys, and this is the test that fails.
  const paired: Tuning = {
    id: 'paired',
    label: 'Made up - Paired',
    notes: [55, 55, 62, 62],
  }

  // The keys of every string of a tuning, in order.
  const keysOf = (tuning: Tuning): ReadonlyArray<string> =>
    tuning.notes.map((_note, position) => stringKey(tuning, position))

  // A `Set` drops repeats, so it is as large as the list only when every key
  // is different.
  test('two strings on one note get different keys', () => {
    const keys = keysOf(paired)

    expect(new Set(keys).size).toBe(paired.notes.length)
  })

  // The same check for the real list, so a tuning added later is held to it.
  test.each(TUNINGS.map(tuning => [tuning.label, tuning] as const))(
    '%s: every string has a key of its own',
    (_label, tuning) => {
      expect(new Set(keysOf(tuning)).size).toBe(tuning.notes.length)
    },
  )

  // The key names the tuning as well as the place. The first string of a
  // guitar and the first string of a bass are different strings, and the
  // runtime should not take one chip for the other when the tuning changes.
  test('a string of one tuning is not a string of another', () => {
    expect(stringKey(tuningById('standard'), 0)).not.toBe(
      stringKey(tuningById('bass'), 0),
    )
  })

  // What a key looks like: the tuning's id, then the string's place in the
  // tuning, counted from 0. Nothing in it depends on the note being played
  // or on A4, so a string has the same key on every render.
  test('a key is the tuning id and the place of the string', () => {
    expect(stringKey(tuningById('banjo'), 0)).toBe('banjo-0')
    expect(stringKey(tuningById('banjo'), 4)).toBe('banjo-4')
  })
})
