// MICROPHONE TESTS: the code that touches the browser's audio
//
// Exercises `src/microphone.ts`: sorting whatever went wrong into a kind of
// failure, the sentence shown for each kind, and the two Effects that open
// and close the microphone. In the app those two Effects are the `acquire`
// and `release` of a Foldkit managed resource, and the runtime runs them. A
// Story never reaches them, and a Scene stands in for them with its
// `ManagedResource` steps, so this is the file that runs them.
//
// These are plain Vitest tests. No microphone is involved: the tests replace
// `navigator` and `AudioContext` with small fakes (`vi.stubGlobal`) that
// succeed, refuse or throw on demand. What a fake cannot show is a real
// device. That is checked outside this suite, in headless Chrome with a WAV
// file played as the microphone (FINDINGS.md, "Checking the real page in
// headless Chrome, with and without a microphone").

import { Cause, Effect, Exit, Option } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  MicrophoneError,
  MicrophoneFailure,
  REFUSED,
  UNSUPPORTED,
  acquireMicrophone,
  failureSentence,
  hasEnded,
  microphoneFailure,
  releaseMicrophone,
} from './microphone'

// Take the fakes away after each test.
afterEach(() => {
  vi.unstubAllGlobals()
})

// Effect idioms used below. `Effect.runPromise(effect)` runs an Effect and
// returns a Promise that rejects if the Effect fails.
// `Effect.runPromiseExit(effect)` never rejects for a failure. It resolves
// with an `Exit`, which holds either the success value or the `Cause` of
// the failure. `failureOf` reads a failed Exit: `Cause.findErrorOption`
// gives the typed error if there is one (an `Option`, Effect's type for a
// value that may be missing), and `microphoneFailure` classifies it. A
// success gives `Option.none()`.
const failureOf = (
  exit: Exit.Exit<unknown, unknown>,
): Option.Option<MicrophoneFailure> =>
  Exit.match(exit, {
    onSuccess: () => Option.none(),
    onFailure: cause =>
      Option.map(Cause.findErrorOption(cause), microphoneFailure),
  })

// An `Error` with a chosen `name`, as a browser throws. The name is what
// says which problem it was: `NotAllowedError`, `AbortError`.
const named = (name: string, text: string): Error =>
  Object.assign(new Error(text), { name })

// The classifier. Foldkit hands a managed resource's `onAcquireError`
// whatever was thrown, typed `unknown`, so this function must cope with
// anything. It reads a browser's error by its `name` and `message`
// properties, which is why an error-like object that is not an `Error` is
// classified too (FINDINGS.md, "The Effect lint refuses `unknown` in an
// error channel").
describe('microphoneFailure', () => {
  test('a MicrophoneError gives the failure it carries', () => {
    expect(
      microphoneFailure(
        new MicrophoneError({ failure: MicrophoneFailure.Unsupported() }),
      ),
    ).toEqual(MicrophoneFailure.Unsupported())
  })

  test('a refused permission is Refused', () => {
    expect(microphoneFailure(named('NotAllowedError', 'denied'))).toEqual(
      MicrophoneFailure.Refused(),
    )
  })

  test('another error keeps its name and message', () => {
    expect(
      microphoneFailure(named('AbortError', 'The device is busy')),
    ).toEqual(
      MicrophoneFailure.Unexpected({
        name: 'AbortError',
        detail: 'The device is busy',
      }),
    )
  })

  // Not everything thrown is an `Error`. Anything with no usable name is
  // "Unknown", and anything with no message has an empty detail.
  test.each([
    ['a string', '???'],
    ['undefined', undefined],
    ['an object with no name', { code: 7 }],
  ])('%s is Unexpected with no name and nothing to say', (_name, thrown) => {
    expect(microphoneFailure(thrown)).toEqual(
      MicrophoneFailure.Unexpected({ name: 'Unknown', detail: '' }),
    )
  })

  test('an error-like object that is not an Error gives its name and message', () => {
    expect(
      microphoneFailure({
        name: 'OverconstrainedError',
        message: 'Requested device not found',
      }),
    ).toEqual(
      MicrophoneFailure.Unexpected({
        name: 'OverconstrainedError',
        detail: 'Requested device not found',
      }),
    )
  })
})

// What the person is told, for each kind of failure. The view puts this
// sentence in the alert. The wording of the two fixed sentences is pinned
// here, so `scene.test.ts` can compare against the constant.
// Two failures that are nobody's bug get kinds of their own, so the app can
// say something plain and need not report them: no microphone at all, and a
// microphone the browser could not start, which usually means another
// program has it.
describe('a missing or busy microphone', () => {
  test('no microphone is NotFound', () => {
    expect(
      microphoneFailure(
        new DOMException('Requested device not found', 'NotFoundError'),
      ),
    ).toEqual(MicrophoneFailure.NotFound())
  })

  test('a microphone that cannot be started is Busy', () => {
    expect(
      microphoneFailure(
        new DOMException('Could not start audio source', 'NotReadableError'),
      ),
    ).toEqual(MicrophoneFailure.Busy())
  })

  // The browser's own words ("Requested device not found") are replaced by
  // a sentence that says what to do.
  test.each([
    ['NotFound', MicrophoneFailure.NotFound(), /No microphone was found/],
    ['Busy', MicrophoneFailure.Busy(), /in use by another/],
    ['Lost', MicrophoneFailure.Lost(), /microphone was disconnected/],
  ])('%s has a plain sentence', (_, failure, pattern) => {
    expect(failureSentence(failure)).toMatch(pattern)
  })
})

// Whether an open microphone has stopped delivering sound. A track ends when
// its device is unplugged or when the person takes the permission back, and
// from then on the analyser reads silence for ever. The handle is faked:
// only the tracks' `readyState` matters.
describe('hasEnded', () => {
  // The handle comes from the real `acquireMicrophone`, with the browser's
  // two entry points replaced by stand-ins, as in the tests further down.
  // Only the tracks' `readyState` matters here.
  const handleWith = (states: ReadonlyArray<string>) => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          Promise.resolve({
            getTracks: () => states.map(readyState => ({ readyState })),
          }),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        createAnalyser = () => ({})
        createMediaStreamSource = () => ({ connect: vi.fn() })
      },
    )

    return Effect.runPromise(acquireMicrophone)
  }

  test('a live track has not ended', async () => {
    expect(hasEnded(await handleWith(['live']))).toBe(false)
  })

  test('an ended track has', async () => {
    expect(hasEnded(await handleWith(['ended']))).toBe(true)
  })

  test('a stream with no tracks left has ended', async () => {
    expect(hasEnded(await handleWith([]))).toBe(true)
  })
})

describe('failureSentence', () => {
  test('a refusal says how to allow the microphone', () => {
    expect(failureSentence(MicrophoneFailure.Refused())).toBe(REFUSED)
    expect(REFUSED).toBe(
      'Microphone access was refused. Allow it in the browser to tune.',
    )
  })

  test('an unsupported browser is named as such', () => {
    expect(failureSentence(MicrophoneFailure.Unsupported())).toBe(UNSUPPORTED)
    expect(UNSUPPORTED).toBe('This browser cannot open the microphone.')
  })

  test('an unexpected error gives its own message', () => {
    expect(
      failureSentence(
        MicrophoneFailure.Unexpected({
          name: 'AbortError',
          detail: 'The device is busy',
        }),
      ),
    ).toBe('The device is busy')
  })

  // The cut to 300 characters applies only to what is sent to Sentry (see
  // `sentry.test.ts`). The page shows the browser's message as it came.
  test('a very long message is shown whole', () => {
    const long = 'x'.repeat(1000)

    expect(
      failureSentence(
        MicrophoneFailure.Unexpected({ name: 'Error', detail: long }),
      ),
    ).toBe(long)
  })

  test('an unexpected error with nothing to say gets a plain fallback', () => {
    expect(
      failureSentence(
        MicrophoneFailure.Unexpected({ name: 'Unknown', detail: '' }),
      ),
    ).toBe('The microphone could not be opened.')
  })
})

// Opening the microphone, run against fake browsers. `acquireMicrophone` is
// an Effect: nothing happens until `runPromiseExit` or `runPromise` runs it.
describe('acquireMicrophone', () => {
  // A browser with no `navigator.mediaDevices` cannot open a microphone at
  // all. That is `Unsupported`, which the app shows and does not report.
  test('without getUserMedia, acquiring fails as unsupported', async () => {
    vi.stubGlobal('navigator', {})

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureOf(exit)).toEqual(
      Option.some(MicrophoneFailure.Unsupported()),
    )
  })

  // The person said no at the browser's prompt: `getUserMedia` rejects with
  // an error named `NotAllowedError`.
  test('a refused permission fails as refused', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(
            Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
          ),
      },
    })

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureOf(exit)).toEqual(Option.some(MicrophoneFailure.Refused()))
  })

  // The clean-up test. Here the stream opens and the next step throws. The
  // failure must be reported as a fault, and the stream's tracks must be
  // stopped first, so a failed start never leaves the microphone on. This is
  // one of the tests that was proved by breaking the code and watching it
  // fail (FINDINGS.md, "A test can pass because the thing it guards never
  // runs in a test").
  test('when the audio context cannot be created, the opened stream is stopped', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop }] }),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('no audio')
        }
      },
    )

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureOf(exit)).toEqual(
      Option.some(
        MicrophoneFailure.Unexpected({ name: 'Error', detail: 'no audio' }),
      ),
    )
    expect(stop).toHaveBeenCalledTimes(1)
  })

  // The same promise one step further on. Here the stream opens and the
  // audio context is created, and it is the analyser that cannot be made.
  // Two things are now open, and both must be shut before the failure is
  // reported: the context is closed (the `Effect.onError` in `listenTo`)
  // and the stream's tracks are stopped (the one in `acquireMicrophone`).
  // The failure is still the one that caused it all, with the browser's
  // name and message.
  test('when the analyser cannot be wired, the context is closed and the stream is stopped', async () => {
    const stop = vi.fn()
    const close = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop }] }),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        close = close
        createAnalyser = () => {
          throw named('NotSupportedError', 'no analyser')
        }
      },
    )

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureOf(exit)).toEqual(
      Option.some(
        MicrophoneFailure.Unexpected({
          name: 'NotSupportedError',
          detail: 'no analyser',
        }),
      ),
    )
    expect(close).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  // A context that starts out suspended is asked to resume, and the browser
  // may say no: `resume()` returns a Promise, and here it rejects. That is
  // not a reason to give up. The context may still start by itself, so the
  // rejection is dropped (`Effect.ignore` in `resumeIfSuspended`), the
  // analyser is wired as usual and the handle is returned.
  test('a context that refuses to resume is still wired and returned', async () => {
    const connect = vi.fn()
    const resume = vi.fn(() => Promise.reject(new Error('not allowed')))
    const analyser = { fftSize: 0, smoothingTimeConstant: 1 }
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [] }),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended'
        resume = resume
        createAnalyser = () => analyser
        createMediaStreamSource = () => ({ connect })
      },
    )

    const handle = await Effect.runPromise(acquireMicrophone)

    expect(resume).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith(analyser)
    expect(handle.analyser).toBe(analyser)
  })

  // The successful path, step by step. The stream is asked for with echo
  // cancellation, noise suppression and automatic gain all off. The fake
  // audio context starts out `suspended`, to show that it is resumed (iOS
  // can hand back a suspended one). The analyser is given a window of 4096
  // samples and no smoothing, and the stream is connected to it.
  test('opens the stream with processing off and wires it to an analyser', async () => {
    const connect = vi.fn()
    const resume = vi.fn(() => Promise.resolve())
    const analyser = { fftSize: 0, smoothingTimeConstant: 1 }
    const stream = { getTracks: () => [] }
    const getUserMedia = vi.fn(() => Promise.resolve(stream))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended'
        resume = resume
        createAnalyser = () => analyser
        createMediaStreamSource = () => ({ connect })
      },
    )

    const handle = await Effect.runPromise(acquireMicrophone)

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
      },
    })
    expect(resume).toHaveBeenCalledTimes(1)
    expect(analyser).toEqual({ fftSize: 4096, smoothingTimeConstant: 0 })
    expect(connect).toHaveBeenCalledWith(analyser)
    expect(handle.stream).toBe(stream)
  })
})

// Closing the microphone: every track of the stream is stopped and the audio
// context is closed. In the app the runtime runs this when the Model stops
// wanting the microphone.
describe('releaseMicrophone', () => {
  // The handle to release is made by really acquiring one against fakes.
  // `Effect.sync(...)` wraps the stubbing as an Effect, and
  // `.pipe(Effect.andThen(acquireMicrophone))` runs the acquisition after
  // it, so one `runPromise` does both. `.pipe(f)` passes the value on its
  // left to `f`.
  test('stops every track and closes the context', async () => {
    const stopFirst = vi.fn()
    const stopSecond = vi.fn()
    const close = vi.fn(() => Promise.resolve())
    const handle = await Effect.runPromise(
      Effect.sync(() => {
        vi.stubGlobal('navigator', {
          mediaDevices: {
            getUserMedia: () =>
              Promise.resolve({
                getTracks: () => [{ stop: stopFirst }, { stop: stopSecond }],
              }),
          },
        })
        vi.stubGlobal(
          'AudioContext',
          class {
            state = 'running'
            close = close
            createAnalyser = () => ({})
            createMediaStreamSource = () => ({ connect: vi.fn() })
          },
        )
      }).pipe(Effect.andThen(acquireMicrophone)),
    )

    await Effect.runPromise(releaseMicrophone(handle))

    expect(stopFirst).toHaveBeenCalledTimes(1)
    expect(stopSecond).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  // `close()` returns a Promise too, and a browser rejects it for a context
  // that is already closed. The release must end all the same: Foldkit asks
  // for a `release` that cannot fail, and nothing useful could be done about
  // it (`Effect.ignore` in `closeContext`). `runPromise` would reject if the
  // Effect failed, so the `await` is the assertion that it did not. The
  // track was stopped first, so the microphone is off either way.
  test('a context that will not close does not fail the release', async () => {
    const stop = vi.fn()
    const close = vi.fn(() => Promise.reject(new Error('already closed')))
    const handle = await Effect.runPromise(
      Effect.sync(() => {
        vi.stubGlobal('navigator', {
          mediaDevices: {
            getUserMedia: () =>
              Promise.resolve({ getTracks: () => [{ stop }] }),
          },
        })
        vi.stubGlobal(
          'AudioContext',
          class {
            state = 'running'
            close = close
            createAnalyser = () => ({})
            createMediaStreamSource = () => ({ connect: vi.fn() })
          },
        )
      }).pipe(Effect.andThen(acquireMicrophone)),
    )

    await Effect.runPromise(releaseMicrophone(handle))

    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
