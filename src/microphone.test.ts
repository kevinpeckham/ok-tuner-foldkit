import { Cause, Effect, Exit, Option } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  MicrophoneError,
  MicrophoneFailure,
  REFUSED,
  UNSUPPORTED,
  acquireMicrophone,
  failureSentence,
  microphoneFailure,
  releaseMicrophone,
} from './microphone'

afterEach(() => {
  vi.unstubAllGlobals()
})

const failureOf = (
  exit: Exit.Exit<unknown, unknown>,
): Option.Option<MicrophoneFailure> =>
  Exit.match(exit, {
    onSuccess: () => Option.none(),
    onFailure: cause =>
      Option.map(Cause.findErrorOption(cause), microphoneFailure),
  })

const named = (name: string, text: string): Error =>
  Object.assign(new Error(text), { name })

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
      microphoneFailure(named('NotReadableError', 'The device is busy')),
    ).toEqual(
      MicrophoneFailure.Unexpected({
        name: 'NotReadableError',
        detail: 'The device is busy',
      }),
    )
  })

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
        name: 'NotFoundError',
        message: 'Requested device not found',
      }),
    ).toEqual(
      MicrophoneFailure.Unexpected({
        name: 'NotFoundError',
        detail: 'Requested device not found',
      }),
    )
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
          name: 'NotReadableError',
          detail: 'The device is busy',
        }),
      ),
    ).toBe('The device is busy')
  })

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

describe('acquireMicrophone', () => {
  test('without getUserMedia, acquiring fails as unsupported', async () => {
    vi.stubGlobal('navigator', {})

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureOf(exit)).toEqual(
      Option.some(MicrophoneFailure.Unsupported()),
    )
  })

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

describe('releaseMicrophone', () => {
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
})
