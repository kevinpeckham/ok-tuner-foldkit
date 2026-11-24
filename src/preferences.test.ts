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
  test('a saved pair round-trips', () => {
    const saved = { tuningId: 'drop-d', a4: 442 }

    expect(preferencesFromJson(Option.some(preferencesToJson(saved)))).toEqual(
      saved,
    )
  })

  test('the saved form is plain JSON under its own key', () => {
    expect(STORAGE_KEY).toBe('oktuner.tuner')
    expect(preferencesToJson({ tuningId: 'drop-d', a4: 442 })).toBe(
      '{"tuningId":"drop-d","a4":442}',
    )
  })

  test('nothing saved gives the defaults', () => {
    expect(preferencesFromJson(Option.none())).toEqual({
      tuningId: 'standard',
      a4: 440,
    })
    expect(DEFAULT_PREFERENCES).toEqual({ tuningId: 'standard', a4: 440 })
  })

  test.each([
    ['not json', '{oops', { tuningId: 'standard', a4: 440 }],
    ['a JSON string', '"hi"', { tuningId: 'standard', a4: 440 }],
    ['null', 'null', { tuningId: 'standard', a4: 440 }],
    [
      'an unknown tuning keeps a good A4',
      '{"tuningId":"banjo","a4":442}',
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

describe('parseA4', () => {
  test.each([
    ['442', 442],
    ['400', 400],
    ['480', 480],
    ['442.5', 442.5],
  ])('accepts %s', (text, expected) => {
    expect(parseA4(text)).toEqual(Option.some(expected))
  })

  test.each(['', ' ', 'abc', '399', '481', 'NaN', 'Infinity'])(
    'rejects "%s"',
    junk => {
      expect(parseA4(junk)).toEqual(Option.none())
    },
  )
})
