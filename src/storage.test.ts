import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import { Message, SavePreferences, flags } from './main'
import { DEFAULT_PREFERENCES, STORAGE_KEY } from './preferences'

const workingStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)

const blockStorage = (): void => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  })
}

afterEach(() => {
  if (workingStorage !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', workingStorage)
  }
  localStorage.clear()
})

describe('flags', () => {
  test('reads the saved tuning and A4', async () => {
    localStorage.setItem(STORAGE_KEY, '{"tuningId":"bass","a4":442}')

    expect(await Effect.runPromise(flags)).toEqual({
      preferences: { tuningId: 'bass', a4: 442 },
    })
  })

  test('with site storage blocked, the tuner starts on the defaults', async () => {
    blockStorage()

    expect(await Effect.runPromise(flags)).toEqual({
      preferences: DEFAULT_PREFERENCES,
    })
  })
})

describe('SavePreferences', () => {
  test('writes the tuning and A4', async () => {
    const result = await Effect.runPromise(
      SavePreferences({ tuningId: 'drop-d', a4: 442 }).effect,
    )

    expect(result).toEqual(Message.SucceededSavePreferences())
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      '{"tuningId":"drop-d","a4":442}',
    )
  })

  test('with site storage blocked, saving reports a failure and does not crash', async () => {
    blockStorage()

    const result = await Effect.runPromise(
      SavePreferences({ tuningId: 'drop-d', a4: 442 }).effect,
    )

    expect(result).toEqual(Message.FailedSavePreferences())
  })
})
