import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Listbox, Popover } from '@foldkit/ui'

import {
  Message,
  type Model,
  SavePreferences,
  TunerState,
  init,
  managedResources,
  update,
} from './main'
import { MicrophoneFailure } from './microphone'
import { DEFAULT_PREFERENCES } from './preferences'

const offModel: Model = init({ preferences: DEFAULT_PREFERENCES }).model

const withTuner = (tuner: TunerState): Model =>
  modifyFields(offModel, { tuner: () => tuner })

type ListeningFields = Partial<Omit<typeof TunerState.Listening.Type, '_tag'>>

const listening = (fields: ListeningFields = {}): Model =>
  withTuner(
    TunerState.Listening({
      level: 0,
      maybeReading: Option.none(),
      needleCents: 0,
      quietTicks: 0,
      ...fields,
    }),
  )

const startingModel = withTuner(TunerState.Starting())
const unexpected = (detail: string): MicrophoneFailure =>
  MicrophoneFailure.Unexpected({ name: 'NotReadableError', detail })

const failedModel = withTuner(
  TunerState.Failed({ failure: unexpected('earlier') }),
)

const heard = (frequency: number, level = 0.5) =>
  Message.MeasuredInput({
    level,
    maybePitch: Option.some({ frequency, clarity: 0.95 }),
  })

const silence = Message.MeasuredInput({ level: 0, maybePitch: Option.none() })

const needleOf = (next: Model): number =>
  TunerState.match(next.tuner, {
    Off: () => Number.NaN,
    Starting: () => Number.NaN,
    Listening: ({ needleCents }) => needleCents,
    Failed: () => Number.NaN,
  })

const readingOf = (next: Model): Option.Option<number> =>
  TunerState.match(next.tuner, {
    Off: () => Option.none(),
    Starting: () => Option.none(),
    Listening: ({ maybeReading }) =>
      Option.map(maybeReading, ({ frequency }) => frequency),
    Failed: () => Option.none(),
  })

describe('init', () => {
  test('with default preferences it starts off, on standard tuning, with A4 at 440', () => {
    expect(offModel.tuner).toEqual(TunerState.Off())
    expect(offModel.tuningId).toBe('standard')
    expect(offModel.a4).toBe(440)
    expect(offModel.a4Input).toBe('440')
  })

  test('it takes the tuning and A4 from the flags', () => {
    const fromFlags = init({ preferences: { tuningId: 'bass', a4: 442 } }).model

    expect(fromFlags.tuningId).toBe('bass')
    expect(fromFlags.a4).toBe(442)
    expect(fromFlags.a4Input).toBe('442')
    expect(fromFlags.tuner).toEqual(TunerState.Off())
  })
})

describe('power', () => {
  test('pressing power when off starts the tuner', () => {
    story(
      update,
      given(offModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
    )
  })

  test('pressing power after a failure starts again', () => {
    story(
      update,
      given(failedModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
    )
  })

  test('pressing power while listening turns the tuner off', () => {
    story(
      update,
      given(listening({ needleCents: 12 })),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Off())
      }),
    )
  })

  test('pressing power while starting changes nothing', () => {
    story(
      update,
      given(startingModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next).toEqual(startingModel)
      }),
    )
  })
})

describe('microphone', () => {
  test('acquiring while starting begins listening from a clean state', () => {
    story(
      update,
      given(startingModel),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.none(),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })

  test.each([
    ['listening', listening({ needleCents: 12, level: 0.3 })],
    ['off', offModel],
    ['failed', failedModel],
  ])('acquiring while %s changes nothing', (_name, start) => {
    story(
      update,
      given(start),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  test.each([
    ['starting', startingModel],
    ['listening', listening({ needleCents: 12 })],
  ])('a failure while %s shows its reason', (_name, start) => {
    story(
      update,
      given(start),
      message(
        Message.FailedAcquireMicrophone({
          failure: unexpected('No microphone'),
        }),
      ),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Failed({ failure: unexpected('No microphone') }),
        )
      }),
    )
  })

  test.each([
    ['off', offModel],
    ['failed', failedModel],
  ])('a failure while %s changes nothing', (_name, start) => {
    story(
      update,
      given(start),
      message(
        Message.FailedAcquireMicrophone({
          failure: unexpected('No microphone'),
        }),
      ),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  test.each([
    ['off', offModel],
    ['starting', startingModel],
    ['listening', listening({ needleCents: 12 })],
    ['failed', failedModel],
  ])('releasing while %s changes nothing', (_name, start) => {
    story(
      update,
      given(start),
      message(Message.ReleasedMicrophone()),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  test('a refusal shows its reason, and pressing power again retries cleanly', () => {
    story(
      update,
      given(offModel),
      message(Message.ClickedPower()),
      message(
        Message.FailedAcquireMicrophone({
          failure: MicrophoneFailure.Refused(),
        }),
      ),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Failed({ failure: MicrophoneFailure.Refused() }),
        )
      }),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.none(),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })
})

describe('readings', () => {
  test.each([
    ['off', offModel],
    ['starting', startingModel],
    ['failed', failedModel],
  ])('a reading that arrives while %s is ignored', (_name, start) => {
    story(
      update,
      given(start),
      message(heard(440)),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  test('a reading with a pitch sets the level, keeps the reading and resets the quiet count', () => {
    story(
      update,
      given(listening({ quietTicks: 7 })),
      message(heard(440, 0.42)),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0.42,
            maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })

  test('the first reading of a nearby pitch settles 35% of the way', () => {
    story(
      update,
      given(listening({ needleCents: 0 })),
      message(heard(446.4)),
      model(next => {
        expect(needleOf(next)).toBeCloseTo(8.75, 1)
      }),
    )
  })

  test('a jump of more than 30 cents snaps', () => {
    story(
      update,
      given(listening({ needleCents: -40 })),
      message(heard(446.4)),
      model(next => {
        expect(needleOf(next)).toBeCloseTo(25, 1)
      }),
    )
  })

  test('a reading without a pitch sets the level and counts a quiet tick', () => {
    story(
      update,
      given(
        listening({
          level: 0.5,
          maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
          needleCents: 8,
        }),
      ),
      message(silence),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
            needleCents: 8,
            quietTicks: 1,
          }),
        )
      }),
    )
  })

  test('twelve quiet ticks hold the note; the thirteenth clears it', () => {
    const holding = listening({
      maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
      needleCents: 8,
    })

    story(
      update,
      given(holding),
      ...Array.makeBy(12, () => message(silence)),
      model(next => {
        expect(readingOf(next)).toEqual(Option.some(440))
        expect(needleOf(next)).toBe(8)
      }),
      message(silence),
      model(next => {
        expect(readingOf(next)).toEqual(Option.none())
        expect(needleOf(next)).toBe(0)
      }),
    )
  })

  test('A4 moves the grid: 442 Hz reads 0 cents when A4 is 442', () => {
    story(
      update,
      given(modifyFields(listening(), { a4: () => 442 })),
      message(heard(442)),
      model(next => {
        expect(needleOf(next)).toBe(0)
      }),
    )
  })
})

describe('microphone requirement', () => {
  test.each([
    ['starting', startingModel],
    ['listening', listening()],
  ])('the microphone is required while %s', (_name, start) => {
    expect(managedResources.microphone.modelToMaybeRequirements(start)).toEqual(
      Option.some(null),
    )
  })

  test.each([
    ['off', offModel],
    ['failed', failedModel],
  ])('the microphone is not required while %s', (_name, start) => {
    expect(managedResources.microphone.modelToMaybeRequirements(start)).toEqual(
      Option.none(),
    )
  })

  test('acquiring, failing and releasing each report their Message', () => {
    expect(managedResources.microphone.onAcquired()).toEqual(
      Message.SucceededAcquireMicrophone(),
    )
    expect(managedResources.microphone.onReleased()).toEqual(
      Message.ReleasedMicrophone(),
    )
    expect(
      managedResources.microphone.onAcquireError(
        new Error('The device is busy'),
      ),
    ).toEqual(
      Message.FailedAcquireMicrophone({
        failure: MicrophoneFailure.Unexpected({
          name: 'Error',
          detail: 'The device is busy',
        }),
      }),
    )
  })
})

describe('A4', () => {
  test('a valid A4 applies and saves', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '442' })),
      model(next => {
        expect(next.a4).toBe(442)
        expect(next.a4Input).toBe('442')
      }),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
    )
  })

  test.each(['', 'abc', '399', '481'])(
    'junk in the A4 field ("%s") changes nothing and saves nothing',
    value => {
      story(
        update,
        given(listening()),
        message(Message.UpdatedA4Input({ value })),
        Command.expectNone(),
        model(next => {
          expect(next.a4).toBe(440)
          expect(next.a4Input).toBe(value)
        }),
      )
    },
  )

  test('a valid value after junk still applies, and saves once', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '4' })),
      Command.expectNone(),
      message(Message.UpdatedA4Input({ value: '44' })),
      Command.expectNone(),
      message(Message.UpdatedA4Input({ value: '442' })),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
      model(next => {
        expect(next.a4).toBe(442)
      }),
    )
  })

  test('retyping the applied value does not save again', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '440' })),
      Command.expectNone(),
      model(next => {
        expect(next.a4).toBe(440)
      }),
    )
  })

  test('a failed save leaves the choice in place for the page', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '442' })),
      Command.resolve(SavePreferences, Message.FailedSavePreferences()),
      model(next => {
        expect(next.a4).toBe(442)
        expect(next.a4Input).toBe('442')
      }),
    )
  })

  test('closing the A4 menu puts the applied value back in the field', () => {
    const opened = Popover.open(offModel.a4Popover)
    const withOpenMenu = modifyFields(listening(), {
      a4Popover: () => opened.model,
      a4Input: () => '39',
    })

    story(
      update,
      given(withOpenMenu),
      message(
        Message.GotA4PopoverMessage({
          message: Popover.Message.RequestedClose(),
        }),
      ),
      model(next => {
        expect(next.a4Input).toBe('440')
        expect(next.a4).toBe(440)
      }),
      Command.resolveAll(
        [Popover.FocusButton, Popover.Message.CompletedFocusButton()],
        [Popover.UnlockScroll, Popover.Message.CompletedUnlockScroll()],
        [Popover.RestoreInert, Popover.Message.CompletedRestoreInert()],
      ),
    )
  })
})

describe('tuning', () => {
  test('choosing a tuning from the picker applies it and saves', () => {
    story(
      update,
      given(listening()),
      message(
        Message.GotTuningListboxMessage({
          message: Listbox.Message.SelectedItem({ item: 'bass' }),
        }),
      ),
      model(next => {
        expect(next.tuningId).toBe('bass')
      }),
      Command.expectHas(SavePreferences({ tuningId: 'bass', a4: 440 })),
      Command.resolveAll(
        [SavePreferences, Message.SucceededSavePreferences()],
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [Listbox.UnlockScroll, Listbox.Message.CompletedUnlockScroll()],
        [Listbox.RestoreInert, Listbox.Message.CompletedRestoreInert()],
      ),
    )
  })

  test('the chosen tuning is saved with the current A4', () => {
    story(
      update,
      given(modifyFields(listening(), { a4: () => 442 })),
      message(
        Message.GotTuningListboxMessage({
          message: Listbox.Message.SelectedItem({ item: 'drop-d' }),
        }),
      ),
      Command.expectHas(SavePreferences({ tuningId: 'drop-d', a4: 442 })),
      Command.resolveAll(
        [SavePreferences, Message.SucceededSavePreferences()],
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [Listbox.UnlockScroll, Listbox.Message.CompletedUnlockScroll()],
        [Listbox.RestoreInert, Listbox.Message.CompletedRestoreInert()],
      ),
    )
  })
})
