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

  test('an unknown id falls back to standard', () => {
    expect(tuningById('nonsense').id).toBe('standard')
    expect(isTuningId('nonsense')).toBe(false)
    expect(isTuningId('bass-5')).toBe(true)
  })
})

describe('nearestString', () => {
  test('picks the closest string, the earlier one on a tie', () => {
    const standard = tuningById('standard')

    expect(nearestString(standard, 45)).toEqual(Option.some(45))
    expect(nearestString(standard, 30)).toEqual(Option.some(40))
    expect(nearestString(standard, 57)).toEqual(Option.some(55))
  })

  test('chromatic has no strings', () => {
    expect(nearestString(tuningById('chromatic'), 45)).toEqual(Option.none())
  })
})
