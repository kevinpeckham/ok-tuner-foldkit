// STORAGE TESTS: reading and saving the preferences, for real
//
// A Story or a Scene test treats a Command as data and never runs it. This
// file is the other half. It runs the two Effects in `src/main.ts` that touch
// the browser's `localStorage` and checks what they do:
//
// - `LoadPreferences`, the Command that `init` returns, to read the saved
//   tuning and A4 once the app has started.
// - `SavePreferences`, the Command that `update` returns when either changes.
//
// A Command made by `Command.define` carries its Effect in `.effect`, so a
// test can run it with `Effect.runPromise` and look at the Message it ends
// in.
//
// These are plain Vitest tests: nothing here uses Story or Scene. Vitest
// runs them in happy-dom (`vitest.config.ts`), which supplies a working
// `localStorage`. What they cannot show is how a real browser's storage
// behaves beyond the one failure that is imitated below.
//
// The second test of each pair is why the file exists. With site data
// blocked, even reading the `localStorage` property throws, and it throws
// while Effect is building the storage layer, outside the typed error
// channel. The page used to crash at start-up and again on saving, and it
// was a review that found it, not a test (FINDINGS.md, "Blocked site storage
// throws while the storage layer is built, outside the typed error channel").

import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import { LoadPreferences, Message, SavePreferences } from './main'
import { DEFAULT_PREFERENCES, STORAGE_KEY } from './preferences'

// The test environment's real `localStorage` property, kept so that
// `afterEach` can put it back.
const workingStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)

// Makes `localStorage` behave as it does in a browser with site data
// blocked: touching the property at all throws a `SecurityError`.
const blockStorage = (): void => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  })
}

// Put working storage back and empty it, so no test sees another's data.
afterEach(() => {
  if (workingStorage !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', workingStorage)
  }
  localStorage.clear()
})

// The Command never fails: whatever happens it ends in
// `CompletedLoadPreferences`, carrying the saved values or the defaults.
describe('LoadPreferences', () => {
  // `Effect.runPromise(effect)` runs an Effect and returns a Promise of its
  // result. An Effect is only a description of work until something runs it.
  // In the app the Foldkit runtime does that. In a test, this call does.
  test('reads the saved tuning and A4', async () => {
    localStorage.setItem(STORAGE_KEY, '{"tuningId":"bass","a4":442}')

    expect(await Effect.runPromise(LoadPreferences().effect)).toEqual(
      Message.CompletedLoadPreferences({
        preferences: { tuningId: 'bass', a4: 442 },
      }),
    )
  })

  test('with nothing saved, it answers with the defaults', async () => {
    expect(await Effect.runPromise(LoadPreferences().effect)).toEqual(
      Message.CompletedLoadPreferences({ preferences: DEFAULT_PREFERENCES }),
    )
  })

  // The case this file exists for. Reading the `localStorage` property
  // throws, and the page must still start, on the defaults.
  test('with site storage blocked, it answers with the defaults', async () => {
    blockStorage()

    expect(await Effect.runPromise(LoadPreferences().effect)).toEqual(
      Message.CompletedLoadPreferences({ preferences: DEFAULT_PREFERENCES }),
    )
  })
})

describe('SavePreferences', () => {
  // `SavePreferences({ ... })` builds a Command, and `.effect` is the Effect
  // inside it: the work the runtime would run. Running it here is how a
  // Command's side effect is tested. The Effect ends with one of the
  // Command's two result Messages, and that Message is what `runPromise`
  // resolves with. The preferences are stored as one JSON string under one
  // key.
  test('writes the tuning and A4', async () => {
    const result = await Effect.runPromise(
      SavePreferences({ tuningId: 'drop-d', a4: 442 }).effect,
    )

    expect(result).toEqual(Message.SucceededSavePreferences())
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      '{"tuningId":"drop-d","a4":442}',
    )
  })

  // With storage blocked the Command does not throw. It ends with
  // `FailedSavePreferences`, and `story.test.ts` shows what `update` does
  // with that: the choice stays in place for the visit.
  test('with site storage blocked, saving reports a failure and does not crash', async () => {
    blockStorage()

    const result = await Effect.runPromise(
      SavePreferences({ tuningId: 'drop-d', a4: 442 }).effect,
    )

    expect(result).toEqual(Message.FailedSavePreferences())
  })
})
