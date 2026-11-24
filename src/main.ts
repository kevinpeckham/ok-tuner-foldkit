import { Duration, Effect, Option, Schema, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  Command,
  ManagedResource,
  type Runtime,
  Subscription,
  Update,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { BrowserKeyValueStore } from '@effect/platform-browser'
import { Listbox, Popover } from '@foldkit/ui'

import {
  Microphone,
  MicrophoneFailure,
  type MicrophoneService,
  WINDOW,
  acquireMicrophone,
  microphoneFailure,
  readMeasurement,
  releaseMicrophone,
} from './microphone'
import { Pitch, noteFromFrequency } from './pitch'
import {
  DEFAULT_PREFERENCES,
  Preferences,
  STORAGE_KEY,
  parseA4,
  preferencesFromJson,
  preferencesToJson,
} from './preferences'
import { reportMicrophoneProblem } from './sentry'
import { type Tuning } from './tuning'

// CONSTANT

export const IN_TUNE_CENTS = 5
const NEEDLE_SNAP_CENTS = 30
const NEEDLE_SETTLE_RATIO = 0.35
const QUIET_TICKS_HELD = 12
const READING_INTERVAL = Duration.millis(50)

// MODEL

export const TunerState = defineTaggedUnion({
  Off: {},
  Starting: {},
  Listening: {
    level: Schema.Number,
    maybeReading: Schema.Option(Pitch),
    needleCents: Schema.Number,
    quietTicks: Schema.Number,
  },
  Failed: { failure: MicrophoneFailure },
})
export type TunerState = typeof TunerState.Type

type Listening = typeof TunerState.Listening.Type

export const TuningListbox = Listbox.create<Tuning>()

export const Model = Schema.Struct({
  tuner: TunerState,
  tuningId: Schema.String,
  a4: Schema.Number,
  a4Input: Schema.String,
  tuningListbox: Listbox.Model,
  a4Popover: Popover.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedPower: {},
  SucceededAcquireMicrophone: {},
  FailedAcquireMicrophone: { failure: MicrophoneFailure },
  ReleasedMicrophone: {},
  MeasuredInput: { level: Schema.Number, maybePitch: Schema.Option(Pitch) },
  GotTuningListboxMessage: { message: Listbox.Message },
  GotA4PopoverMessage: { message: Popover.Message },
  UpdatedA4Input: { value: Schema.String },
  SucceededSavePreferences: {},
  FailedSavePreferences: {},
  CompletedReportProblem: {},
})
export type Message = typeof Message.Type

// INIT

// NOTE: with site data blocked, reading `localStorage` throws while the
// storage layer is being built, outside the typed error channel. Both the
// flags and SavePreferences therefore provide the layer first and catch the
// whole cause after it, so blocked storage means default preferences and an
// unsaved choice, never a crash.
export const Flags = Schema.Struct({ preferences: Preferences })
export type Flags = typeof Flags.Type

export const flags: Effect.Effect<Flags> = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  const maybeJson = Option.fromNullishOr(yield* store.get(STORAGE_KEY))

  return { preferences: preferencesFromJson(maybeJson) }
}).pipe(
  Effect.provide(BrowserKeyValueStore.layerLocalStorage),
  Effect.catchCause(() => Effect.succeed({ preferences: DEFAULT_PREFERENCES })),
)

const a4ToInput = (a4: number): string => `${a4}`

export const init: Runtime.ApplicationInit<Model, Message, Flags> = ({
  preferences,
}) => ({
  model: {
    tuner: TunerState.Off(),
    tuningId: preferences.tuningId,
    a4: preferences.a4,
    a4Input: a4ToInput(preferences.a4),
    tuningListbox: Listbox.init({ id: 'tuning' }),
    a4Popover: Popover.init({ id: 'a4' }),
  },
})

// COMMAND

export const SavePreferences = Command.define('SavePreferences', {
  args: { tuningId: Schema.String, a4: Schema.Number },
  messages: [Message.SucceededSavePreferences, Message.FailedSavePreferences],
  execute: preferences =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set(STORAGE_KEY, preferencesToJson(preferences))

      return Message.SucceededSavePreferences()
    }).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage),
      Effect.catchCause(() => Effect.succeed(Message.FailedSavePreferences())),
    ),
})

export const ReportProblem = Command.define('ReportProblem', {
  args: { name: Schema.String, detail: Schema.String },
  messages: [Message.CompletedReportProblem],
  execute: problem =>
    Effect.sync(() => reportMicrophoneProblem(problem)).pipe(
      Effect.as(Message.CompletedReportProblem()),
      Effect.catchCause(() => Effect.succeed(Message.CompletedReportProblem())),
    ),
})

// UPDATE

const freshListening = (): TunerState =>
  TunerState.Listening({
    level: 0,
    maybeReading: Option.none(),
    needleCents: 0,
    quietTicks: 0,
  })

const moveNeedle = (needleCents: number, cents: number): number =>
  Math.abs(cents - needleCents) > NEEDLE_SNAP_CENTS
    ? cents
    : needleCents + (cents - needleCents) * NEEDLE_SETTLE_RATIO

const hearPitch = (
  listening: Listening,
  a4: number,
  level: number,
  pitch: Pitch,
): TunerState =>
  TunerState.Listening({
    level,
    maybeReading: Option.some(pitch),
    needleCents: moveNeedle(
      listening.needleCents,
      noteFromFrequency(pitch.frequency, a4).cents,
    ),
    quietTicks: 0,
  })

const hearNothing = (listening: Listening, level: number): TunerState => {
  const quietTicks = listening.quietTicks + 1

  return quietTicks > QUIET_TICKS_HELD
    ? TunerState.Listening({
        level,
        maybeReading: Option.none(),
        needleCents: 0,
        quietTicks,
      })
    : TunerState.Listening({
        level,
        maybeReading: listening.maybeReading,
        needleCents: listening.needleCents,
        quietTicks,
      })
}

const withTuner = (model: Model, tuner: TunerState): Model =>
  modifyFields(model, { tuner: () => tuner })

// A refusal and an unsupported browser are the person's own situation. Anything
// else means something is broken, so it is reported.
const failWith = (
  model: Model,
  failure: MicrophoneFailure,
): Update.Return<Model, Message> => ({
  model: withTuner(model, TunerState.Failed({ failure })),
  commands: MicrophoneFailure.match(failure, {
    Refused: () => [],
    Unsupported: () => [],
    Unexpected: ({ name, detail }) => [ReportProblem({ name, detail })],
  }),
})

const foldTuningListboxOutMessage = Listbox.OutMessage.match<
  Update.Step<Model, Message>
>({
  Selected:
    ({ value }) =>
    model => ({
      model: modifyFields(model, { tuningId: () => value }),
      commands: [SavePreferences({ tuningId: value, a4: model.a4 })],
    }),
})

const foldTuningListbox = Update.foldChild({
  update: TuningListbox.update,
  read: (model: Model) => Option.some(model.tuningListbox),
  write: (model, nextTuningListbox) =>
    modifyFields(model, { tuningListbox: () => nextTuningListbox }),
  toParentMessage: message => Message.GotTuningListboxMessage({ message }),
  foldOutMessage: foldTuningListboxOutMessage,
})

const foldA4PopoverOutMessage = Popover.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, { a4Input: () => a4ToInput(model.a4) }),
  }),
})

const foldA4Popover = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.a4Popover),
  write: (model, nextA4Popover) =>
    modifyFields(model, { a4Popover: () => nextA4Popover }),
  toParentMessage: message => Message.GotA4PopoverMessage({ message }),
  foldOutMessage: foldA4PopoverOutMessage,
})

type UpdateReturn = Update.Return<Model, Message, MicrophoneService>

const applyA4Input = (model: Model, value: string): UpdateReturn => {
  const typed = modifyFields(model, { a4Input: () => value })
  const maybeNextA4 = Option.filter(parseA4(value), a4 => a4 !== model.a4)

  return Option.match(maybeNextA4, {
    onNone: () => ({ model: typed }),
    onSome: nextA4 => ({
      model: modifyFields(typed, { a4: () => nextA4 }),
      commands: [SavePreferences({ tuningId: model.tuningId, a4: nextA4 })],
    }),
  })
}

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedPower: () => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: () => TunerState.Starting(),
          Starting: starting => starting,
          Listening: () => TunerState.Off(),
          Failed: () => TunerState.Starting(),
        }),
      ),
    }),

    SucceededAcquireMicrophone: () => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: off => off,
          Starting: freshListening,
          Listening: listening => listening,
          Failed: failed => failed,
        }),
      ),
    }),

    FailedAcquireMicrophone: ({ failure }) =>
      TunerState.match(model.tuner, {
        Off: () => ({ model }),
        Starting: () => failWith(model, failure),
        Listening: () => failWith(model, failure),
        Failed: () => ({ model }),
      }),

    ReleasedMicrophone: () => ({ model }),

    MeasuredInput: ({ level, maybePitch }) => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: off => off,
          Starting: starting => starting,
          Listening: listening =>
            Option.match(maybePitch, {
              onNone: () => hearNothing(listening, level),
              onSome: pitch => hearPitch(listening, model.a4, level, pitch),
            }),
          Failed: failed => failed,
        }),
      ),
    }),

    GotTuningListboxMessage: ({ message }) => foldTuningListbox(model, message),

    GotA4PopoverMessage: ({ message }) => foldA4Popover(model, message),

    UpdatedA4Input: ({ value }) => applyA4Input(model, value),

    SucceededSavePreferences: () => ({ model }),

    FailedSavePreferences: () => ({ model }),

    CompletedReportProblem: () => ({ model }),
  })

// MANAGED RESOURCE

export const managedResources = ManagedResource.make<Model, Message>()(
  entry => ({
    microphone: entry(Schema.Option(Schema.Null), {
      resource: Microphone,
      modelToMaybeRequirements: model =>
        TunerState.match(model.tuner, {
          Off: () => Option.none(),
          Starting: () => Option.some(null),
          Listening: () => Option.some(null),
          Failed: () => Option.none(),
        }),
      acquire: () => acquireMicrophone,
      release: releaseMicrophone,
      onAcquired: () => Message.SucceededAcquireMicrophone(),
      onReleased: () => Message.ReleasedMicrophone(),
      onAcquireError: error =>
        Message.FailedAcquireMicrophone({
          failure: microphoneFailure(error),
        }),
    }),
  }),
)

// SUBSCRIPTION

// NOTE: the Microphone is looked up on every tick, not once per stream. In
// development Vite restores the Model after a reload without running init, so
// the page can start already Listening before the Microphone is acquired
// again. A tick that finds no Microphone emits nothing.
const measureInput = (buffer: Float32Array<ArrayBuffer>) =>
  Stream.fromEffect(Microphone.get).pipe(
    Stream.map(microphone =>
      Message.MeasuredInput(readMeasurement(microphone, buffer)),
    ),
    Stream.catchTag('ResourceNotAvailable', () => Stream.empty),
  )

const readings = Stream.suspend(() => {
  const buffer = new Float32Array(WINDOW)

  return Stream.tick(READING_INTERVAL).pipe(
    Stream.flatMap(() => measureInput(buffer)),
  )
})

export const subscriptions = Subscription.make<
  Model,
  Message,
  MicrophoneService
>()(entry => ({
  readings: entry(
    { isListening: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isListening: model.tuner._tag === 'Listening',
      }),
      dependenciesToStream: ({ isListening }) =>
        Stream.when(
          readings,
          Effect.sync(() => isListening),
        ),
    },
  ),
}))
