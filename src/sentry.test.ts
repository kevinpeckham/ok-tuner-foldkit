import { Option } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'

import * as Sentry from '@sentry/browser'

import {
  SENTRY_DSN,
  environmentOf,
  initSentry,
  reportCrash,
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
    transport: recordingTransport(sent),
    beforeSend: event => {
      events.push(event)
      return event
    },
  })
  return { sent, events }
}

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

describe('sentryOptions', () => {
  test('reports errors only, to this project, tagged by hostname', () => {
    const options = sentryOptions('localhost')

    expect(options.dsn).toBe(SENTRY_DSN)
    expect(options.environment).toBe('development')
    expect(options.attachStacktrace).toBe(true)
    expect(options.tracesSampleRate).toBeUndefined()
    expect(sentryOptions('ok-tuner.vercel.app').environment).toBe('production')
  })

  test('collects nothing about the visitor', () => {
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
    initSentry({ transport: recordingTransport(sent), release: 'a-release' })

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

describe('reportCrash', () => {
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
