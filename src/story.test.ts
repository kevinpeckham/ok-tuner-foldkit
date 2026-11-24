import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message, type Model, TunerState, init, update } from './main'

const offModel: Model = init().model

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
const failedModel = withTuner(TunerState.Failed({ reason: 'earlier' }))

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
  test('starts off, on standard tuning, with A4 at 440', () => {
    expect(offModel).toEqual({
      tuner: TunerState.Off(),
      tuningId: 'standard',
      a4: 440,
    })
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
      message(Message.FailedAcquireMicrophone({ reason: 'No microphone' })),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Failed({ reason: 'No microphone' }),
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
      message(Message.FailedAcquireMicrophone({ reason: 'No microphone' })),
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
      message(Message.FailedAcquireMicrophone({ reason: 'Refused' })),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Failed({ reason: 'Refused' }))
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
