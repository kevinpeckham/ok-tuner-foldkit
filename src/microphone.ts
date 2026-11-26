// microphone.ts: opening and closing the microphone.
//
// What this file is. Everything that touches the browser's audio APIs
// (`getUserMedia`, `AudioContext`, `AnalyserNode`) lives here, and nothing
// here knows about the Model, the Messages or the view. It exports what the
// Foldkit parts of the app need:
//
//   - `Microphone`: the tag that names the managed resource.
//   - `acquireMicrophone` and `releaseMicrophone`: how to open and close it.
//     `src/main.ts` hands them to `ManagedResource.make` as `acquire` and
//     `release`.
//   - `MicrophoneFailure` and `microphoneFailure`: what went wrong, sorted
//     into a kind. `main.ts` calls `microphoneFailure` in `onAcquireError`
//     and keeps the kind in the Model; `src/view.ts` turns the kind into a
//     sentence with `failureSentence`.
//   - `readMeasurement`: one reading of the live audio. The `readings`
//     Subscription in `main.ts` calls it every 50 ms.
//
// Why a managed resource. A Foldkit Command does one piece of work and ends
// with a Message. A microphone is not like that: it has to stay open for as
// long as the Model says the tuner is on, and be closed when it is not.
// Foldkit calls that a ManagedResource. You say how to acquire a value and
// how to release it, and the runtime does both at the right moments by
// watching the Model. That half is under "MANAGED RESOURCE" in `main.ts`.
// Why this shape was chosen: FINDINGS.md, "The microphone is a managed
// resource and the readings a subscription".
//
// What an Effect is, briefly. Most functions below return an
// `Effect.Effect<A, E>`. An Effect is a description of work, not the work
// itself: building one does nothing. It runs only when something runs it,
// which is Foldkit's runtime in the app and `Effect.runPromise` in
// `microphone.test.ts`. `A` is the value it gives on success. `E` is the
// type of the failure it can end with, so the ways this code can fail are
// written in its types. (A third type parameter, the services an Effect
// needs, is left at its default of `never` throughout this file.)
//
// Read `src/pitch.ts` before this file (it supplies `measure`), and the
// MANAGED RESOURCE and SUBSCRIPTION sections of `src/main.ts` after it.

// From Effect: `Data` (typed error classes), `Effect` (described work),
// `Option` (a value that may be absent, used in place of null), `Predicate`
// (type guards), `Schema` (types that also exist at runtime), `String`
// (string helpers; inside this file the name hides the global `String`) and
// `pipe` (passes a value through a list of functions, first to last).
import { Data, Effect, Option, Predicate, Schema, String, pipe } from 'effect'
// From Foldkit: `ManagedResource` for the tag below, and `defineTaggedUnion`
// for the kinds of failure.
import { ManagedResource } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { type Measurement, measure } from './pitch'

// CONSTANT

// How many samples one reading looks at. It is the analyser's `fftSize` (set
// in `connectAnalyser` below) and the length of the buffer the `readings`
// Subscription creates in `main.ts`. At the 48 kHz asked for below, 4096
// samples is about 85 ms of sound. Pitch detection needs two full periods of
// the lowest note it looks for (see `detectPitch` in `pitch.ts`): at 48 kHz
// one period of 40 Hz is 1200 samples, so 4096 leaves room. The value is the
// original tuner's (the tuner design, "Microphone: a managed resource"). The
// Web Audio API accepts only a power of two for `fftSize`.
export const WINDOW = 4096

// The sentences shown to the person when the microphone cannot be opened.
// REFUSED and UNSUPPORTED keep the wording of the Stem Shovel tuner this app
// is a port of, and are exported because the tests assert on them.
// UNEXPLAINED is the fallback for an error that arrives with no message.
export const REFUSED =
  'Microphone access was refused. Allow it in the browser to tune.'
export const UNSUPPORTED = 'This browser cannot open the microphone.'
// The sentences for the three failures that are about the microphone itself
// and not about the app. Each says what to do next.
export const NOT_FOUND =
  'No microphone was found. Connect one, then switch the tuner on again.'
export const BUSY =
  'The microphone could not be started. It may be in use by another app. Close that app, then switch the tuner on again.'
export const LOST =
  'The microphone was disconnected. Reconnect it, then switch the tuner on again.'
const UNEXPLAINED = 'The microphone could not be opened.'

// `NotAllowedError` is the `name` of the error `getUserMedia` rejects with
// when permission for the microphone is denied. A refusal is the person's
// own choice and not a fault, so it gets a kind of its own, as do the two
// errors named below it. UNKNOWN_ERROR_NAME stands in when a thrown value has no
// usable `name`.
const REFUSED_ERROR_NAME = 'NotAllowedError'
// The names the browser gives two more errors that are no fault of the
// app: there is no microphone at all, and there is one that could not be
// started, which most often means another program is using it.
const NOT_FOUND_ERROR_NAME = 'NotFoundError'
const BUSY_ERROR_NAME = 'NotReadableError'
const UNKNOWN_ERROR_NAME = 'Unknown'

// What is asked of `getUserMedia`.
//   - The browser's three processing steps (echo cancellation, noise
//     suppression, automatic gain) are switched off, so the analyser gets
//     the sound without them.
//   - `ideal` marks a preference, not a requirement: the browser comes as
//     close as it can and the request still succeeds if it cannot match.
//     That is why the real sample rate is read from the audio context in
//     `readMeasurement`, never assumed to be 48000.
//   - One channel is enough: the analyser's samples are a single stream of
//     numbers.
// The values are the original tuner's (the tuner design, "Microphone: a
// managed resource").
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

// The value the managed resource holds while it is open: what
// `acquireMicrophone` produces, what `releaseMicrophone` receives, and what
// `Microphone.get` gives the `readings` Subscription.
//   - `stream`: the live microphone input. The microphone stays on until
//     every track of the stream is stopped.
//   - `context`: the Web Audio graph the stream is connected into. Its
//     `sampleRate` is the rate the samples are processed at.
//   - `analyser`: a node in that graph that holds the most recent samples
//     for `readMeasurement` to copy out.
// A plain TypeScript type, not a Schema: these are live browser objects, and
// they never enter the Model.
export type MicrophoneHandle = Readonly<{
  stream: MediaStream
  context: AudioContext
  analyser: AnalyserNode
}>

// `ManagedResource.tag<Value>()(key)` creates the identity of a managed
// resource. It opens nothing. It is called in two steps so that the value
// type (`MicrophoneHandle`) can be given by hand while the key
// (`'Microphone'`) is inferred as a literal type.
//
// `main.ts` uses the tag in two ways:
//   1. `resource: Microphone` in `ManagedResource.make` ties this identity
//      to its `acquire` and `release`.
//   2. `Microphone.get` is an Effect that gives the live `MicrophoneHandle`.
//      While the resource is not acquired it fails instead, with Foldkit's
//      `ResourceNotAvailable` error, which the readings stream catches by
//      its tag.
//
// Behind the tag the runtime keeps one cell holding an
// `Option<MicrophoneHandle>`: `Some(handle)` once `acquire` has succeeded,
// `None` again after `release`. `Microphone.get` only reads that cell, so
// code that reads the microphone never opens or closes it.
export const Microphone = ManagedResource.tag<MicrophoneHandle>()('Microphone')

// The type-level side of the tag. `Microphone.get` has this type as its
// requirement (the third type parameter of `Effect`), so anything built from
// it carries the requirement too. `main.ts` names it in
// `Update.Return<Model, Message, MicrophoneService>` and in
// `Subscription.make<Model, Message, MicrophoneService>()`. Foldkit's source
// describes the purpose as compile-time enforcement that the resource is
// registered.
export type MicrophoneService = ManagedResource.ServiceOf<typeof Microphone>

// FAILURE

// The kinds of failure, as a tagged union. `defineTaggedUnion` (Foldkit)
// takes one object: each key is a variant's name, each value lists that
// variant's fields as Effect Schemas. What comes back is two things at once.
//   - A Schema for the whole union. Foldkit requires Model fields to be
//     Schemas (FOLDKIT.md, "Project Conventions"), and this union is one:
//     `TunerState.Failed` and the `FailedAcquireMicrophone` Message in
//     `main.ts` both carry a `MicrophoneFailure`.
//   - A namespace of constructors and helpers.
//     `MicrophoneFailure.Refused()` builds `{ _tag: 'Refused' }`, and
//     `MicrophoneFailure.match` (used in `failureSentence` below) handles
//     every variant.
//
// Why kinds, and not simply the sentence to show: `update` has to tell a
// person's own situation from a fault, because only a fault is reported to
// Sentry. See FINDINGS.md, "A caught failure is reported by a Command, not
// where it is caught".
//   - `Refused`: permission for the microphone was denied.
//   - `Unsupported`: this browser has no `getUserMedia`.
//   - `NotFound`: there is no microphone to open.
//   - `Busy`: the microphone could not be started, usually because another
//     program has it.
//   - `Lost`: the microphone was open and then went away: it was unplugged,
//     or the permission was taken back. This one does not come from opening
//     the microphone. `update` sets it when the readings report the loss
//     (`hasEnded` below, and LostMicrophone in src/main.ts).
//   - `Unexpected`: anything else. `name` and `detail` are the thrown
//     error's `name` and `message`, kept as text.
export const MicrophoneFailure = defineTaggedUnion({
  Refused: {},
  Unsupported: {},
  NotFound: {},
  Busy: {},
  Lost: {},
  Unexpected: { name: Schema.String, detail: Schema.String },
})
// The same name is declared twice on purpose. The `const` above is the
// runtime value (the Schema and its constructors). This `type` is the
// TypeScript type of a value of the union, read off the Schema with `.Type`.
// Foldkit code uses this value-and-type pair throughout: `Model` and
// `Message` in `main.ts` are declared the same way.
export type MicrophoneFailure = typeof MicrophoneFailure.Type

// The error `acquireMicrophone` fails with. `Data.TaggedError('X')` (Effect)
// makes a base class for an `Error` that also carries `_tag: 'X'`. The object
// type in angle brackets is its payload: it is passed to the constructor and
// read back as `error.failure`.
//
// Why a typed error at all: an Effect's failure type is part of its
// signature, and this project's lint refuses an Effect whose failure type is
// `unknown`. A browser API can throw anything, so the raw value is sorted
// into a `MicrophoneFailure` at the edge (`toMicrophoneError` below) and
// wrapped in this class. See FINDINGS.md, "The Effect lint refuses `unknown`
// in an error channel".
export class MicrophoneError extends Data.TaggedError('MicrophoneError')<{
  failure: MicrophoneFailure
}> {}

// Reads one string property off a value of unknown type, as an `Option`:
// `Option.some(text)` when the value has that property and it is a string,
// `Option.none()` otherwise. `Predicate.hasProperty` and `Predicate.isString`
// are type guards, so TypeScript follows the checks and no cast is needed
// (the lint allows none).
//
// The error is read by property, not with `instanceof Error`. An error-like
// object that is not an `Error` therefore still gives its name and message;
// `microphone.test.ts` pins that.
const textProperty =
  (property: string) =>
  (error: unknown): Option.Option<string> =>
    Predicate.hasProperty(error, property) &&
    Predicate.isString(error[property])
      ? Option.some(error[property])
      : Option.none()

// The error's `name`, or 'Unknown' when it has none or an empty one.
// `pipe(value, f, g)` means `g(f(value))`, written in the order it happens.
// `Option.filter` turns a `Some` whose value fails the test into `None`.
// `Option.getOrElse` unwraps the Option, giving the fallback for `None`.
const nameOf = (error: unknown): string =>
  pipe(
    textProperty('name')(error),
    Option.filter(String.isNonEmpty),
    Option.getOrElse(() => UNKNOWN_ERROR_NAME),
  )

// The error's `message`, or an empty string when it has none.
const detailOf = (error: unknown): string =>
  Option.getOrElse(textProperty('message')(error), () => '')

// Two callers reach `microphoneFailure`:
//   - `toMicrophoneError` below, with the raw value a browser API threw. The
//     second and third branches sort it.
//   - `onAcquireError` in `main.ts`. Foldkit types the error it hands to
//     `onAcquireError` as `unknown`, which is why the parameter is `unknown`.
//     What arrives there is the `MicrophoneError` that `acquireMicrophone`
//     failed with, so the first branch returns the kind already chosen.
/** Sorts whatever went wrong opening the microphone into a kind: the person's
 *  own refusal, a browser that cannot do it, or a fault worth reporting. */
export const microphoneFailure = (error: unknown): MicrophoneFailure => {
  if (error instanceof MicrophoneError) {
    return error.failure
  } else if (nameOf(error) === REFUSED_ERROR_NAME) {
    return MicrophoneFailure.Refused()
  } else if (nameOf(error) === NOT_FOUND_ERROR_NAME) {
    return MicrophoneFailure.NotFound()
  } else if (nameOf(error) === BUSY_ERROR_NAME) {
    return MicrophoneFailure.Busy()
  } else {
    return MicrophoneFailure.Unexpected({
      name: nameOf(error),
      detail: detailOf(error),
    })
  }
}

// `MicrophoneFailure.match(value, handlers)` is the union's own exhaustive
// matcher: one handler per variant, each given that variant's fields. It is
// what Foldkit code uses where plain TypeScript would use `switch`
// (FOLDKIT.md, "Code Style"). `src/view.ts` calls this function to fill the
// alert. An `Unexpected` failure shows the browser's own message when there
// is one.
/** What to tell the person when the microphone could not be opened. */
export const failureSentence = (failure: MicrophoneFailure): string =>
  MicrophoneFailure.match(failure, {
    Refused: () => REFUSED,
    Unsupported: () => UNSUPPORTED,
    NotFound: () => NOT_FOUND,
    Busy: () => BUSY,
    Lost: () => LOST,
    Unexpected: ({ detail }) =>
      String.isNonEmpty(detail) ? detail : UNEXPLAINED,
  })

// ACQUIRE

// Acquiring happens in three steps, each its own Effect: open the stream
// (`openStream`), create and wake the audio context, and connect an analyser
// (`listenTo`, which uses `resumeIfSuspended` and `connectAnalyser`).
// `acquireMicrophone` at the end of the section joins them. Each step that
// opens something is paired with the clean-up to run if a later step fails.

// Wraps any thrown value in the typed error. The steps below pass it as the
// `catch` handler of `Effect.try` and `Effect.tryPromise`.
const toMicrophoneError = (error: unknown): MicrophoneError =>
  new MicrophoneError({ failure: microphoneFailure(error) })

// Step 1: ask the browser for the microphone.
//
// `Effect.suspend(() => effect)` puts off building the Effect until it is
// run. The body reads `navigator.mediaDevices`, and that must be read when
// the tuner is switched on, not when this module is first imported.
//
// `Effect.fail(error)` is an Effect that fails at once with a typed error.
//
// `Effect.tryPromise({ try, catch })` wraps a function that returns a
// Promise. If the Promise resolves, the Effect succeeds with its value. If
// it rejects, `catch` turns the reason into the typed error. `getUserMedia`
// is the call that makes the browser ask for permission, and it rejects with
// a `NotAllowedError` when permission is denied.
//
// The DOM types say `navigator.mediaDevices` always exists. The annotation on
// the local widens it to `| undefined`, because the check below is for
// browsers and pages where it does not.
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

// Turns the microphone off, by stopping every track of the stream.
// `Effect.sync(() => ...)` wraps synchronous code that is not expected to
// throw. Its failure type is `never`, hence the return type
// `Effect.Effect<void>` with no error named.
const stopTracks = (stream: MediaStream): Effect.Effect<void> =>
  Effect.sync(() => {
    stream.getTracks().forEach(track => track.stop())
  })

// Closes the audio context. `context.close()` returns a Promise, so it is
// wrapped with `Effect.tryPromise`. With no `catch` given, a rejection
// becomes Effect's generic `UnknownError`. `Effect.ignore` then discards
// both the result and that failure, leaving an Effect that cannot fail.
// Nothing useful can be done if closing fails, and Foldkit's `release` must
// be an `Effect.Effect<void>`, with no failure type.
const closeContext = (context: AudioContext): Effect.Effect<void> =>
  Effect.ignore(Effect.tryPromise(() => context.close()))

// The second half of step 2: make sure the audio context is running before
// anything is connected to it. `Effect.void` is an Effect that succeeds with
// nothing, for the case where there is nothing to do. As in `closeContext`,
// `Effect.ignore` makes a failed `resume()` harmless.
//
// NOTE: iOS can hand back a suspended context, which would read as on but
// silent. A resume that fails is left alone: the context may still start.
const resumeIfSuspended = (context: AudioContext): Effect.Effect<void> =>
  context.state === 'running'
    ? Effect.void
    : Effect.ignore(Effect.tryPromise(() => context.resume()))

// Step 3: build the part of the audio graph the tuner reads from, and plug
// the microphone into it.
//   - `fftSize = WINDOW`: the analyser holds the last 4096 samples, which is
//     how many `getFloatTimeDomainData` copies out for each reading.
//   - `smoothingTimeConstant = 0`: the analyser's own smoothing over time is
//     switched off, as the tuner design asks ("no smoothing").
//   - `createMediaStreamSource(stream).connect(analyser)`: the stream becomes
//     a source node that feeds the analyser. The analyser is connected to
//     nothing further, so the input is never played through the speakers.
//
// `Effect.try({ try, catch })` is the synchronous twin of `tryPromise`: it
// runs `try`, and if that throws, `catch` maps the thrown value to the typed
// error.
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

// Steps 2 and 3 together: given an open stream, create the audio context,
// wake it if needed, connect the analyser, and return the finished handle.
//
// `Effect.gen(function* () { ... })` lets a sequence of Effects be written
// like async/await. `yield*` on an Effect waits for it and gives its success
// value, as `await` does for a Promise. If a yielded Effect fails, the
// generator stops at that line and the whole `Effect.gen` fails with the
// same error, so the body needs no try/catch.
//
// The second `yield*` is a pipeline over one Effect:
//   - `Effect.andThen(next)`: when the first Effect succeeds, run `next` and
//     keep its result (here, the analyser).
//   - `Effect.onError(cleanup)`: if what came before ends in failure, run
//     `cleanup`, then fail as before. Here it closes the context that was
//     just created, so a failed start leaves no audio context behind. On
//     success the context is not closed: it belongs to the handle, and
//     `releaseMicrophone` closes it later.
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

// This is the Effect `main.ts` gives the managed resource as `acquire`. The
// runtime runs it when the Model starts to require the microphone (the tuner
// enters `Starting`). Then:
//   - on success it stores the handle behind the `Microphone` tag and
//     dispatches the `onAcquired` Message (`SucceededAcquireMicrophone`);
//   - on failure it dispatches the `onAcquireError` Message
//     (`FailedAcquireMicrophone`), carrying the kind of failure. A failed
//     acquire does not crash the app.
//
// `Effect.flatMap(first, f)` runs `first`, then the Effect that `f` returns
// for its value. The `Effect.onError` here is the outer safety net, one
// level out from the one in `listenTo`: that one closes the audio context,
// this one stops the stream's tracks.
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

// The function `main.ts` gives the managed resource as `release`. The
// runtime calls it with the stored handle when the Model stops requiring the
// microphone (most often, the tuner goes back to `Off`). It then empties the
// cell behind the `Microphone` tag and dispatches the `onReleased` Message
// (`ReleasedMicrophone`), and does both even if this Effect were to fail.
// `Effect.andThen` runs the two steps in order: the tracks are stopped
// first, so the microphone is off before the context is closed.
export const releaseMicrophone = ({
  stream,
  context,
}: MicrophoneHandle): Effect.Effect<void> =>
  Effect.andThen(stopTracks(stream), closeContext(context))

// READ

// Whether an open microphone has stopped delivering sound. A track's
// `readyState` turns to `'ended'` when its device is unplugged, and when the
// person takes the microphone permission back in the browser. Nothing else
// in the handle changes: the analyser goes on answering, with silence, so
// without this check the tuner would sit switched on and deaf.
//
// The readings Subscription in src/main.ts asks this before every reading,
// twenty times a second, which is prompt enough and needs no event listener
// to add and remove. A stream with no tracks at all counts as ended too.
/** True once every track of the microphone's stream has ended. */
export const hasEnded = ({ stream }: MicrophoneHandle): boolean =>
  stream.getTracks().every(track => track.readyState === 'ended')

// Called on every tick by the `readings` Subscription in `main.ts`, with the
// handle from `Microphone.get` and one buffer that the stream creates once
// and reuses for every reading. `getFloatTimeDomainData` copies the
// analyser's latest samples into that buffer (the raw waveform, as floating
// point numbers), and `measure` in `pitch.ts` turns them into a level and,
// when there is one, a pitch. The result is the payload of the
// `MeasuredInput` Message.
//
// This is a plain function, not an Effect, and it is not pure: it reads from
// the browser and writes into `buffer`. That is acceptable because it is
// only ever called from inside the Subscription's stream, which is where
// Foldkit expects outside events to come from, and never from `update` or
// the view.
/** Reads the analyser's current samples into `buffer` and measures them. */
export const readMeasurement = (
  { analyser, context }: MicrophoneHandle,
  buffer: Float32Array<ArrayBuffer>,
): Measurement => {
  analyser.getFloatTimeDomainData(buffer)
  return measure(buffer, context.sampleRate)
}
