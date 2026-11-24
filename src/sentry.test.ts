import { Effect, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as Sentry from '@sentry/browser'

import { Message, ReportProblem, TunerState, init } from './main'
import { DEFAULT_PREFERENCES } from './preferences'
import {
  DETAIL_LIMIT,
  SENTRY_DSN,
  environmentOf,
  initSentry,
  reportCrash,
  reportMicrophoneProblem,
  reportsFrom,
  sentryOptions,
} from './sentry'

// TRANSPORT

type TransportFactory = NonNullable<Sentry.BrowserOptions['transport']>
type Transport = ReturnType<TransportFactory>
type Envelope = Parameters<Transport['send']>[0]

/** Stands in for the network: keeps every envelope the SDK would have sent. */
const recordingTransport =
  (sent: Array<Envelope>): TransportFactory =>
  () => ({
    send: envelope => {
      sent.push(envelope)
      return Promise.resolve({})
    },
    flush: () => Promise.resolve(true),
  })

type Recording = Readonly<{
  sent: Array<Envelope>
  events: Array<Sentry.ErrorEvent>
}>

/** Starts Sentry with nothing leaving the machine: `events` is what it
 *  prepared to send, `sent` every envelope it handed to the transport. */
const startRecording = (): Recording => {
  const sent: Array<Envelope> = []
  const events: Array<Sentry.ErrorEvent> = []
  initSentry({
    enabled: true,
    transport: recordingTransport(sent),
    beforeSend: event => {
      events.push(event)
      return event
    },
  })
  return { sent, events }
}

/** A network that refuses everything, as an ad blocker or no connection does. */
const unreachableTransport =
  (send: Transport['send']): TransportFactory =>
  () => ({ send, flush: () => Promise.resolve(true) })

// STORAGE

const STORAGES = ['localStorage', 'sessionStorage'] as const

const workingStorages = STORAGES.map(
  name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
)

const blockStorage = (): void => {
  STORAGES.forEach(name => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  })
}

afterEach(async () => {
  workingStorages.forEach(([name, descriptor]) => {
    if (descriptor !== undefined) {
      Object.defineProperty(globalThis, name, descriptor)
    }
  })
  await Sentry.close()
})

describe('environmentOf', () => {
  test.each([
    ['www.oktuner.com', 'production'],
    ['oktuner.com', 'production'],
    ['ok-tuner.vercel.app', 'production'],
    ['ok-tuner-lightning-jar.vercel.app', 'production'],
    ['ok-tuner-git-feat-x-lightning-jar.vercel.app', 'preview'],
    ['ok-tuner-88kx3anqq-lightning-jar.vercel.app', 'preview'],
    ['ok-tuner.bench.lj.dev', 'development'],
    ['localhost', 'development'],
    ['', 'development'],
  ])('%s is %s', (hostname, environment) => {
    expect(environmentOf(hostname)).toBe(environment)
  })
})

describe('reportsFrom', () => {
  test.each([
    ['www.oktuner.com', true],
    ['oktuner.com', true],
    ['ok-tuner.vercel.app', true],
    ['ok-tuner-lightning-jar.vercel.app', true],
    ['ok-tuner-git-feat-x-lightning-jar.vercel.app', true],
    ['ok-tuner-88kx3anqq-lightning-jar.vercel.app', true],
    ['ok-tuner.bench.lj.dev', true],
    ['localhost', false],
    ['ok-tuner-fork-someone.vercel.app', false],
    ['someone-lightning-jar.vercel.app', false],
    ['staging.oktuner.com', false],
    ['www.oktuner.com.example.org', false],
    ['', false],
  ])('%s reports: %s', (hostname, reports) => {
    expect(reportsFrom(hostname)).toBe(reports)
    expect(sentryOptions(hostname).enabled).toBe(reports)
  })
})

describe('sentryOptions', () => {
  test('reports errors only, to this project, tagged by hostname', () => {
    const options = sentryOptions('localhost')

    expect(options.dsn).toBe(SENTRY_DSN)
    expect(options.environment).toBe('development')
    expect(options.attachStacktrace).toBe(true)
    expect(options.tracesSampleRate).toBeUndefined()
    expect(sentryOptions('ok-tuner.vercel.app').environment).toBe('production')
  })

  test('switches off every data-collection category', () => {
    expect(sentryOptions('localhost').dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    })
  })
})

describe('initSentry', () => {
  // NOTE: the SDK only sends its per-visit session when a release is set,
  // which the build does on Vercel. Without one here this would pass with the
  // session integration still installed.
  test('initialising sends nothing, even with a release set', async () => {
    const sent: Array<Envelope> = []
    initSentry({
      enabled: true,
      transport: recordingTransport(sent),
      release: 'a-release',
    })

    await Sentry.flush()

    expect(sent).toHaveLength(0)
  })

  test('no session integration is installed', () => {
    startRecording()

    const client = Sentry.getClient()

    expect(client).toBeDefined()
    expect(client?.getIntegrationByName('BrowserSession')).toBeUndefined()
    expect(client?.getIntegrationByName('GlobalHandlers')).toBeDefined()
  })

  test('blocked site storage does not stop start-up', () => {
    blockStorage()
    const sent: Array<Envelope> = []

    expect(() =>
      initSentry({ transport: recordingTransport(sent) }),
    ).not.toThrow()
  })

  test('a broken setting does not stop start-up', () => {
    expect(() => initSentry({ dsn: 'not a dsn' })).not.toThrow()
    expect(() =>
      initSentry({
        integrations: () => {
          throw new Error('integration set-up failed')
        },
      }),
    ).not.toThrow()
  })
})

describe('a host that is not ours', () => {
  test('a copy of the app running elsewhere sends nothing', async () => {
    const sent: Array<Envelope> = []
    initSentry({ transport: recordingTransport(sent) })

    reportCrash({
      error: new Error('boom'),
      model: {},
      message: Option.none(),
    })
    reportMicrophoneProblem({ name: 'Error', detail: 'elsewhere' })
    await Sentry.flush()

    expect(window.location.hostname).toBe('localhost')
    expect(sent).toHaveLength(0)
  })
})

describe('reportCrash', () => {
  test('a crash keeps the nested parts of the model and the message', async () => {
    const { events } = startRecording()
    const reading = Option.some({ frequency: 110, clarity: 0.95 })
    const model = modifyFields(
      init({ preferences: DEFAULT_PREFERENCES }).model,
      {
        tuner: () =>
          TunerState.Listening({
            level: 0.5,
            maybeReading: reading,
            needleCents: 3,
            quietTicks: 0,
          }),
      },
    )

    reportCrash({
      error: new Error('boom'),
      model,
      message: Option.some(
        Message.MeasuredInput({ level: 0.25, maybePitch: reading }),
      ),
    })
    await Sentry.flush()

    const sentModel = JSON.stringify(events[0]?.extra?.['model'])
    const sentMessage = JSON.stringify(events[0]?.extra?.['message'])
    expect(sentModel).toContain('"frequency":110')
    expect(sentModel).not.toContain('[Object]')
    expect(sentModel).not.toContain('[Array]')
    expect(sentMessage).toContain('"frequency":110')
  })

  test('a crash is sent as an exception with the model and the message', async () => {
    const { sent, events } = startRecording()

    reportCrash({
      error: new Error('boom'),
      model: { tuningId: 'standard' },
      message: Option.some({ _tag: 'ClickedPower' }),
    })
    await Sentry.flush()

    expect(sent).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0]?.exception?.values?.[0]?.value).toBe('boom')
    expect(events[0]?.extra?.['model']).toEqual({ tuningId: 'standard' })
    expect(events[0]?.extra?.['message']).toEqual({ _tag: 'ClickedPower' })
    expect(events[0]?.environment).toBe('development')
    expect(events[0]?.user).toBeUndefined()
  })

  test('a crash with no message sends no message extra', async () => {
    const { sent, events } = startRecording()

    reportCrash({
      error: new Error('boom'),
      model: { tuningId: 'standard' },
      message: Option.none(),
    })
    await Sentry.flush()

    expect(sent).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0]?.extra?.['message']).toBeUndefined()
  })
})

describe('reportMicrophoneProblem', () => {
  test('a microphone problem is sent as an error titled with the error name and grouped by it', async () => {
    const { sent, events } = startRecording()

    reportMicrophoneProblem({
      name: 'NotReadableError',
      detail: 'The device is busy',
    })
    await Sentry.flush()

    expect(sent).toHaveLength(1)
    expect(events).toHaveLength(1)
    const exception = events[0]?.exception?.values?.[0]
    expect(exception?.type).toBe('Microphone failed: NotReadableError')
    expect(exception?.value).toBe('The device is busy')
    expect(exception?.stacktrace?.frames?.length).toBeGreaterThan(0)
    expect(events[0]?.level).toBe('error')
    expect(events[0]?.tags?.['microphone_error']).toBe('NotReadableError')
    expect(events[0]?.fingerprint).toEqual(['microphone', 'NotReadableError'])
    expect(events[0]?.user).toBeUndefined()
  })

  test('a problem with nothing to say is still titled', async () => {
    const { events } = startRecording()

    reportMicrophoneProblem({ name: 'Unknown', detail: '' })
    await Sentry.flush()

    const exception = events[0]?.exception?.values?.[0]
    expect(exception?.type).toBe('Microphone failed: Unknown')
    expect(exception?.value).toBe('The browser gave no message.')
  })

  test('a long detail is cut to 300 characters', async () => {
    const { events } = startRecording()

    reportMicrophoneProblem({ name: 'Error', detail: 'x'.repeat(1000) })
    await Sentry.flush()

    expect(DETAIL_LIMIT).toBe(300)
    expect(events[0]?.exception?.values?.[0]?.value).toBe('x'.repeat(300))
  })

  test('reporting when Sentry is not running does nothing and does not throw', async () => {
    const { sent } = startRecording()
    await Sentry.close()

    expect(() =>
      reportMicrophoneProblem({ name: 'Error', detail: 'late' }),
    ).not.toThrow()
    expect(sent).toHaveLength(0)
  })
})

describe('ReportProblem', () => {
  const problem = { name: 'NotReadableError', detail: 'The device is busy' }

  test('sends the problem and completes', async () => {
    const { events } = startRecording()

    const result = await Effect.runPromise(ReportProblem(problem).effect)
    await Sentry.flush()

    expect(result).toEqual(Message.CompletedReportProblem())
    expect(events).toHaveLength(1)
    expect(events[0]?.exception?.values?.[0]?.type).toBe(
      'Microphone failed: NotReadableError',
    )
  })

  // NOTE: Vitest fails the run on any unhandled rejection, so a rejected send
  // that escaped the SDK would fail this test without an assertion for it.
  test('completes when Sentry cannot be reached', async () => {
    const send = vi.fn(() => Promise.reject(new Error('blocked')))
    initSentry({ enabled: true, transport: unreachableTransport(send) })

    const result = await Effect.runPromise(ReportProblem(problem).effect)
    await Sentry.flush()

    expect(result).toEqual(Message.CompletedReportProblem())
    expect(send).toHaveBeenCalledTimes(1)
  })
})
