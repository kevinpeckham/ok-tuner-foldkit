import { Duration, Effect, Option, Schema, Stream } from 'effect'
import {
  ManagedResource,
  type Runtime,
  Subscription,
  type Update,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  Microphone,
  type MicrophoneService,
  WINDOW,
  acquireMicrophone,
  microphoneErrorReason,
  readMeasurement,
  releaseMicrophone,
} from './microphone'
import { Pitch, noteFromFrequency } from './pitch'
import { DEFAULT_PREFERENCES } from './preferences'

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
  Failed: { reason: Schema.String },
})
export type TunerState = typeof TunerState.Type

type Listening = typeof TunerState.Listening.Type

export const Model = Schema.Struct({
  tuner: TunerState,
  tuningId: Schema.String,
  a4: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedPower: {},
  SucceededAcquireMicrophone: {},
  FailedAcquireMicrophone: { reason: Schema.String },
  ReleasedMicrophone: {},
  MeasuredInput: { level: Schema.Number, maybePitch: Schema.Option(Pitch) },
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    tuner: TunerState.Off(),
    tuningId: DEFAULT_PREFERENCES.tuningId,
    a4: DEFAULT_PREFERENCES.a4,
  },
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

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, MicrophoneService>>(message, {
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

    FailedAcquireMicrophone: ({ reason }) => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: off => off,
          Starting: () => TunerState.Failed({ reason }),
          Listening: () => TunerState.Failed({ reason }),
          Failed: failed => failed,
        }),
      ),
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
          reason: microphoneErrorReason(error),
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
