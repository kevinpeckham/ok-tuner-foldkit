import { Data, Effect, Option, Predicate, Schema, String, pipe } from 'effect'
import { ManagedResource } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { type Measurement, measure } from './pitch'

// CONSTANT

export const WINDOW = 4096

export const REFUSED =
  'Microphone access was refused. Allow it in the browser to tune.'
export const UNSUPPORTED = 'This browser cannot open the microphone.'
const UNEXPLAINED = 'The microphone could not be opened.'

const REFUSED_ERROR_NAME = 'NotAllowedError'
const UNKNOWN_ERROR_NAME = 'Unknown'

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  },
}

// RESOURCE

export type MicrophoneHandle = Readonly<{
  stream: MediaStream
  context: AudioContext
  analyser: AnalyserNode
}>

export const Microphone = ManagedResource.tag<MicrophoneHandle>()('Microphone')
export type MicrophoneService = ManagedResource.ServiceOf<typeof Microphone>

// FAILURE

export const MicrophoneFailure = defineTaggedUnion({
  Refused: {},
  Unsupported: {},
  Unexpected: { name: Schema.String, detail: Schema.String },
})
export type MicrophoneFailure = typeof MicrophoneFailure.Type

export class MicrophoneError extends Data.TaggedError('MicrophoneError')<{
  failure: MicrophoneFailure
}> {}

const textProperty =
  (property: string) =>
  (error: unknown): Option.Option<string> =>
    Predicate.hasProperty(error, property) &&
    Predicate.isString(error[property])
      ? Option.some(error[property])
      : Option.none()

const nameOf = (error: unknown): string =>
  pipe(
    textProperty('name')(error),
    Option.filter(String.isNonEmpty),
    Option.getOrElse(() => UNKNOWN_ERROR_NAME),
  )

const detailOf = (error: unknown): string =>
  Option.getOrElse(textProperty('message')(error), () => '')

/** Sorts whatever went wrong opening the microphone into a kind: the person's
 *  own refusal, a browser that cannot do it, or a fault worth reporting. */
export const microphoneFailure = (error: unknown): MicrophoneFailure => {
  if (error instanceof MicrophoneError) {
    return error.failure
  } else if (nameOf(error) === REFUSED_ERROR_NAME) {
    return MicrophoneFailure.Refused()
  } else {
    return MicrophoneFailure.Unexpected({
      name: nameOf(error),
      detail: detailOf(error),
    })
  }
}

/** What to tell the person when the microphone could not be opened. */
export const failureSentence = (failure: MicrophoneFailure): string =>
  MicrophoneFailure.match(failure, {
    Refused: () => REFUSED,
    Unsupported: () => UNSUPPORTED,
    Unexpected: ({ detail }) =>
      String.isNonEmpty(detail) ? detail : UNEXPLAINED,
  })

// ACQUIRE

const toMicrophoneError = (error: unknown): MicrophoneError =>
  new MicrophoneError({ failure: microphoneFailure(error) })

const openStream: Effect.Effect<MediaStream, MicrophoneError> = Effect.suspend(
  () => {
    const mediaDevices: MediaDevices | undefined = navigator.mediaDevices

    if (
      Predicate.isUndefined(mediaDevices) ||
      !Predicate.isFunction(mediaDevices.getUserMedia)
    ) {
      return Effect.fail(
        new MicrophoneError({ failure: MicrophoneFailure.Unsupported() }),
      )
    } else {
      return Effect.tryPromise({
        try: () => mediaDevices.getUserMedia(AUDIO_CONSTRAINTS),
        catch: toMicrophoneError,
      })
    }
  },
)

const stopTracks = (stream: MediaStream): Effect.Effect<void> =>
  Effect.sync(() => {
    stream.getTracks().forEach(track => track.stop())
  })

const closeContext = (context: AudioContext): Effect.Effect<void> =>
  Effect.ignore(Effect.tryPromise(() => context.close()))

// NOTE: iOS can hand back a suspended context, which would read as on but
// silent. A resume that fails is left alone: the context may still start.
const resumeIfSuspended = (context: AudioContext): Effect.Effect<void> =>
  context.state === 'running'
    ? Effect.void
    : Effect.ignore(Effect.tryPromise(() => context.resume()))

const connectAnalyser = (
  stream: MediaStream,
  context: AudioContext,
): Effect.Effect<AnalyserNode, MicrophoneError> =>
  Effect.try({
    try: () => {
      const analyser = context.createAnalyser()
      analyser.fftSize = WINDOW
      analyser.smoothingTimeConstant = 0
      context.createMediaStreamSource(stream).connect(analyser)
      return analyser
    },
    catch: toMicrophoneError,
  })

const listenTo = (
  stream: MediaStream,
): Effect.Effect<MicrophoneHandle, MicrophoneError> =>
  Effect.gen(function* () {
    const context = yield* Effect.try({
      try: () => new AudioContext(),
      catch: toMicrophoneError,
    })

    const analyser = yield* pipe(
      resumeIfSuspended(context),
      Effect.andThen(connectAnalyser(stream, context)),
      Effect.onError(() => closeContext(context)),
    )

    return { stream, context, analyser }
  })

/** Opens the microphone and wires it to an analyser. If anything fails after
 *  the stream opens, its tracks are stopped before the failure is reported,
 *  so a failed start never leaves the microphone on. */
export const acquireMicrophone: Effect.Effect<
  MicrophoneHandle,
  MicrophoneError
> = Effect.flatMap(openStream, stream =>
  Effect.onError(listenTo(stream), () => stopTracks(stream)),
)

// RELEASE

export const releaseMicrophone = ({
  stream,
  context,
}: MicrophoneHandle): Effect.Effect<void> =>
  Effect.andThen(stopTracks(stream), closeContext(context))

// READ

/** Reads the analyser's current samples into `buffer` and measures them. */
export const readMeasurement = (
  { analyser, context }: MicrophoneHandle,
  buffer: Float32Array<ArrayBuffer>,
): Measurement => {
  analyser.getFloatTimeDomainData(buffer)
  return measure(buffer, context.sampleRate)
}
