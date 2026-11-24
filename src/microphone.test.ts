import { Cause, Effect, Exit, Option } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  REFUSED,
  UNSUPPORTED,
  acquireMicrophone,
  microphoneErrorReason,
  releaseMicrophone,
} from './microphone'

afterEach(() => {
  vi.unstubAllGlobals()
})

const failureReason = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.match(exit, {
    onSuccess: () => 'acquired',
    onFailure: cause =>
      Option.match(Cause.findErrorOption(cause), {
        onNone: () => 'defect',
        onSome: microphoneErrorReason,
      }),
  })

describe('microphoneErrorReason', () => {
  test('a refused permission gets the refusal wording', () => {
    const refused = Object.assign(new Error('x'), { name: 'NotAllowedError' })

    expect(microphoneErrorReason(refused)).toBe(REFUSED)
    expect(REFUSED).toBe(
      'Microphone access was refused. Allow it in the browser to tune.',
    )
  })

  test('another error gives its own message', () => {
    expect(microphoneErrorReason(new Error('The device is busy'))).toBe(
      'The device is busy',
    )
  })

  test('an error with nothing to say gets a plain fallback', () => {
    expect(microphoneErrorReason('???')).toBe(
      'The microphone could not be opened.',
    )
    expect(microphoneErrorReason(new Error(''))).toBe(
      'The microphone could not be opened.',
    )
  })
})

describe('acquireMicrophone', () => {
  test('without getUserMedia, acquiring fails as unsupported', async () => {
    vi.stubGlobal('navigator', {})

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureReason(exit)).toBe(UNSUPPORTED)
    expect(UNSUPPORTED).toBe('This browser cannot open the microphone.')
  })

  test('a refused permission fails with the refusal wording', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(
            Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
          ),
      },
    })

    const exit = await Effect.runPromiseExit(acquireMicrophone)

    expect(failureReason(exit)).toBe(REFUSED)
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

    expect(failureReason(exit)).toBe('no audio')
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
