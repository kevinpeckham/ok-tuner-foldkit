import { Data, Effect, Predicate, String, pipe } from 'effect'
import { ManagedResource } from 'foldkit'

import { type Measurement, measure } from './pitch'

// CONSTANT

export const WINDOW = 4096

export const REFUSED =
  'Microphone access was refused. Allow it in the browser to tune.'
export const UNSUPPORTED = 'This browser cannot open the microphone.'
const UNEXPLAINED = 'The microphone could not be opened.'

const REFUSED_ERROR_NAME = 'NotAllowedError'

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

// ERROR

export class MicrophoneError extends Data.TaggedError('MicrophoneError')<{
  reason: string
}> {}

const hasName =
  (name: string) =>
  (error: unknown): boolean =>
    Predicate.hasProperty(error, 'name') && error.name === name

/** What to tell the person when the microphone could not be opened. */
export const microphoneErrorReason = (error: unknown): string => {
  if (error instanceof MicrophoneError) {
    return error.reason
  } else if (hasName(REFUSED_ERROR_NAME)(error)) {
    return REFUSED
  } else if (error instanceof Error && String.isNonEmpty(error.message)) {
    return error.message
  } else {
    return UNEXPLAINED
  }
}

// ACQUIRE

const toMicrophoneError = (error: unknown): MicrophoneError =>
  new MicrophoneError({ reason: microphoneErrorReason(error) })

const openStream: Effect.Effect<MediaStream, MicrophoneError> = Effect.suspend(
  () => {
    const mediaDevices: MediaDevices | undefined = navigator.mediaDevices

    if (
      Predicate.isUndefined(mediaDevices) ||
      !Predicate.isFunction(mediaDevices.getUserMedia)
    ) {
      return Effect.fail(new MicrophoneError({ reason: UNSUPPORTED }))
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
