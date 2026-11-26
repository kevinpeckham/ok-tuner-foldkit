// PREFERENCES TESTS: what is remembered between visits
//
// Exercises `src/preferences.ts`: turning the saved JSON into preferences
// and back, and reading the A4 that a person types. These are pure functions
// tested with plain Vitest, and nothing here is Foldkit. Nothing here touches
// storage either: reading and writing `localStorage` is tested in
// `storage.test.ts`.
//
// The rule under test is that reading never fails. Whatever is in storage,
// the app gets usable preferences, with a default wherever the saved value
// is missing or damaged.

// `Option` is Effect's type for a value that may be missing. Here
// `Option.some(json)` is "this text was in storage" and `Option.none()` is
// "nothing was saved". `parseA4` answers with an Option too: `Some` of the
// number, or `None` when the text is not a usable A4.
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  STORAGE_KEY,
  parseA4,
  preferencesFromJson,
  preferencesToJson,
} from './preferences'

describe('preferences', () => {
  // What is written can be read back unchanged.
  test('a saved pair round-trips', () => {
    const saved = { tuningId: 'drop-d', a4: 442 }

    expect(preferencesFromJson(Option.some(preferencesToJson(saved)))).toEqual(
      saved,
    )
  })

  // The two newest tunings are saved and read back like the rest. Their ids
  // are 'mandolin' and 'banjo': a tuning that is its instrument's usual one
  // is named for the instrument, as 'bass' and 'ukulele' are.
  test.each(['mandolin', 'banjo'])('a saved %s is kept', tuningId => {
    expect(
      preferencesFromJson(
        Option.some(preferencesToJson({ tuningId, a4: 440 })),
      ),
    ).toEqual({ tuningId, a4: 440 })
  })

  // This key and this exact text are what is already in people's browsers,
  // so a change to either would lose what they had saved.
  test('the saved form is plain JSON under its own key', () => {
    expect(STORAGE_KEY).toBe('oktuner.tuner')
    expect(preferencesToJson({ tuningId: 'drop-d', a4: 442 })).toBe(
      '{"tuningId":"drop-d","a4":442}',
    )
  })

  // A first visit.
  test('nothing saved gives the defaults', () => {
    expect(preferencesFromJson(Option.none())).toEqual({
      tuningId: 'standard',
      a4: 440,
    })
    expect(DEFAULT_PREFERENCES).toEqual({ tuningId: 'standard', a4: 440 })
  })

  // Each field is checked on its own, so one damaged field does not throw
  // away the other. The first three rows are text that is not a saved pair
  // at all. The rest have one bad field (an unknown tuning, an A4 out of
  // range or of the wrong type, a field missing) and keep the good one.
  test.each([
    ['not json', '{oops', { tuningId: 'standard', a4: 440 }],
    ['a JSON string', '"hi"', { tuningId: 'standard', a4: 440 }],
    ['null', 'null', { tuningId: 'standard', a4: 440 }],
    [
      'an unknown tuning keeps a good A4',
      '{"tuningId":"sitar","a4":442}',
      { tuningId: 'standard', a4: 442 },
    ],
    [
      'A4 too low keeps a good tuning',
      '{"tuningId":"bass","a4":399}',
      { tuningId: 'bass', a4: 440 },
    ],
    [
      'A4 too high',
      '{"tuningId":"bass","a4":481}',
      { tuningId: 'bass', a4: 440 },
    ],
    [
      'A4 as text',
      '{"tuningId":"bass","a4":"442"}',
      { tuningId: 'bass', a4: 440 },
    ],
    ['a missing field', '{"a4":415}', { tuningId: 'standard', a4: 415 }],
  ])('damaged preferences: %s', (_name, json, expected) => {
    expect(preferencesFromJson(Option.some(json))).toEqual(expected)
  })
})

// Reading the text of the A4 field. `update` uses the answer to decide
// whether to apply and save what was typed, and the view uses it to mark the
// field invalid.
describe('parseA4', () => {
  // 400 and 480 are the ends of the range, and both are allowed. A value
  // with a decimal part is accepted as well.
  test.each([
    ['442', 442],
    ['400', 400],
    ['480', 480],
    ['442.5', 442.5],
  ])('accepts %s', (text, expected) => {
    expect(parseA4(text)).toEqual(Option.some(expected))
  })

  // Empty and blank text, words, and numbers just outside the range. "NaN"
  // and "Infinity" are on the list because JavaScript's `Number()` turns
  // both into numbers, and neither is a pitch.
  test.each(['', ' ', 'abc', '399', '481', 'NaN', 'Infinity'])(
    'rejects "%s"',
    junk => {
      expect(parseA4(junk)).toEqual(Option.none())
    },
  )
})
