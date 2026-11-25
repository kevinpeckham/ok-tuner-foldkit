// SENTRY TESTS: what the app would send to Sentry, without sending it
//
// Exercises `src/sentry.ts` (where reports go, when they are sent and what
// they carry) and the `ReportProblem` Command in `src/main.ts`. This is the
// only test file allowed to import `@sentry/browser`.
//
// These are plain Vitest tests, not Story or Scene tests. They start the
// real Sentry SDK and look at what it prepares to send. Nothing leaves the
// machine. Tests run on `localhost`, where the app's own rule switches
// reporting off, so a test that wants a report passes overrides to
// `initSentry`: `enabled: true` and two recorders (FINDINGS.md, "Testing
// Sentry without the network"):
//
// - a `transport` that keeps every envelope the SDK would have sent. The
//   contents of an envelope are untyped, so it is used only to answer "was
//   anything sent, and how many".
// - a `beforeSend` hook that keeps each event. The SDK hands it a typed
//   event, so the assertions read from there.
//
// What these tests cannot show is what Sentry does with a report once it
// arrives: how it titles and groups an issue, whether source maps resolve,
// what it adds on its side. Those were checked against the real service and
// are written up in FINDINGS.md under "Sentry".

// `Effect.runPromise` (used at the end of the file) runs an Effect and
// returns a Promise of its result. `Option` is Effect's type for a value
// that may be missing: `Option.some(value)` or `Option.none()`.
import { Effect, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as Sentry from '@sentry/browser'

import { Message, ReportProblem, TunerState, init } from './main'
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

// A transport is the part of the SDK that puts a report on the network. The
// `transport` option takes a function that makes one. These three types are
// read off the SDK's own option type: the function, the transport it makes,
// and the envelope a transport is asked to send.
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

// The same imitation of blocked site data as in `storage.test.ts`, here for
// both kinds of site storage: the property throws when it is touched. The
// working properties are kept so that `afterEach` can put them back.
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

// After each test, working storage is put back and `Sentry.close()` shuts
// the SDK down, so the next test starts its own with its own recorders.
afterEach(async () => {
  workingStorages.forEach(([name, descriptor]) => {
    if (descriptor !== undefined) {
      Object.defineProperty(globalThis, name, descriptor)
    }
  })
  await Sentry.close()
})

// The tag on each report that says which deployment sent it. Nothing under
// `src` reads an environment variable, so the browser has only its hostname
// to go by (FINDINGS.md, "The environment tag comes from the hostname"). A
// host that is not on the production list counts as development. That
// includes a Vercel preview, which reports nothing, so its tag never reaches
// Sentry.
describe('environmentOf', () => {
  test.each([
    ['www.oktuner.com', 'production'],
    ['oktuner.com', 'production'],
    ['ok-tuner.vercel.app', 'production'],
    ['ok-tuner-lightning-jar.vercel.app', 'production'],
    ['ok-tuner-git-feat-x-lightning-jar.vercel.app', 'development'],
    ['ok-tuner-88kx3anqq-lightning-jar.vercel.app', 'development'],
    ['ok-tuner.bench.lj.dev', 'development'],
    ['localhost', 'development'],
    ['', 'development'],
  ])('%s is %s', (hostname, environment) => {
    expect(environmentOf(hostname)).toBe(environment)
  })
})

// Whether a host is one of ours. The repository is public, so a copy of the
// app can run anywhere, and only our own hosts may report (FINDINGS.md,
// "Reports are sent only from a list of our own hosts"). The `false` rows
// are the point of the table: `localhost`, our own Vercel previews (Sentry's
// Allowed Domains setting cannot name them, so the app does not send from
// them: FINDINGS.md, "Previews report nothing"), someone else's Vercel
// project with a similar name, a subdomain we do not use, and a look-alike
// domain.
// Each row also checks that the SDK's `enabled` option gives the same
// answer. A new domain reports nothing until it is added to the list
// (FINDINGS.md, "A new domain reports nothing until it is listed").
describe('reportsFrom', () => {
  test.each([
    ['www.oktuner.com', true],
    ['oktuner.com', true],
    ['ok-tuner.vercel.app', true],
    ['ok-tuner-lightning-jar.vercel.app', true],
    ['ok-tuner-git-feat-x-lightning-jar.vercel.app', false],
    ['ok-tuner-88kx3anqq-lightning-jar.vercel.app', false],
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

// The options the SDK is started with, before any override.
describe('sentryOptions', () => {
  // Errors only: no tracing sample rate is set, so no performance data is
  // collected.
  test('reports errors only, to this project, tagged by hostname', () => {
    const options = sentryOptions('localhost')

    expect(options.dsn).toBe(SENTRY_DSN)
    expect(options.environment).toBe('development')
    expect(options.attachStacktrace).toBe(true)
    expect(options.tracesSampleRate).toBeUndefined()
    expect(sentryOptions('ok-tuner.vercel.app').environment).toBe('production')
  })

  // In this version of the SDK these categories default to on, so each one
  // has to be switched off by name (FINDINGS.md, "The SDK's privacy switches
  // changed name, and they default to on").
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

// Starting the SDK. Two promises are pinned here: a visit where nothing goes
// wrong sends nothing, and a failure to start never stops the tuner.
describe('initSentry', () => {
  // This test once passed while the thing it guards against was still in
  // place, and the release it sets is the fix. It was then proved the hard
  // way: with the session integration put back, it fails (FINDINGS.md, "A
  // test can pass because the thing it guards never runs in a test").
  // `Sentry.flush()` waits for the SDK to send whatever it has queued, so
  // the count below is taken after anything that was going to be sent.
  //
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

  // The same promise, checked directly: the running client is asked which
  // integrations it has. `GlobalHandlers` must still be there. It covers
  // what is thrown outside the Foldkit runtime. What is thrown inside the
  // runtime goes through the crash hook tested further down (FINDINGS.md,
  // "Foldkit catches crashes itself, so Sentry's own handlers never see
  // them").
  test('no session integration is installed', () => {
    startRecording()

    const client = Sentry.getClient()

    expect(client).toBeDefined()
    expect(client?.getIntegrationByName('BrowserSession')).toBeUndefined()
    expect(client?.getIntegrationByName('GlobalHandlers')).toBeDefined()
  })

  // Reporting is an extra. If the SDK cannot start, the tuner must still
  // start, which is why `initSentry` wraps the SDK's own start in a
  // try/catch. These two tests give it a browser with site data blocked, a
  // malformed address and an integration that throws.
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

// The one group with no `enabled: true` override, so the app's own rule
// decides, and the test environment's hostname is `localhost`. Both kinds of
// report are attempted and nothing reaches the transport. The assertion on
// the hostname is there to say why.
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

// `reportCrash` is the function `entry.ts` gives to Foldkit as
// `crash: { report }`. The runtime catches an error thrown in `update`, in
// the view or in a Command and shows its crash screen, so this hook is the
// only route by which such an error reaches Sentry. Foldkit calls it with
// the error, the Model at that moment, and the Message that was being
// handled as an `Option`, which is `None` when the first render crashes.
describe('reportCrash', () => {
  // A real `Listening` Model is nested deeper than the three levels the SDK
  // keeps by default, and the first crash reports showed "[Object]" where
  // the reading should have been (FINDINGS.md, "Crash reports flattened the
  // Model"). The reading must arrive as data, in the Model and in the
  // Message.
  test('a crash keeps the nested parts of the model and the message', async () => {
    const { events } = startRecording()
    const reading = Option.some({ frequency: 110, clarity: 0.95 })
    // `init` takes the address the app is opened at.
    const url = Option.getOrThrow(fromString('http://localhost/'))
    const model = modifyFields(init(url).model, {
      tuner: () =>
        TunerState.Listening({
          level: 0.5,
          maybeReading: reading,
          needleCents: 3,
          quietTicks: 0,
        }),
    })

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

  // The shape of a crash report: one envelope, one event, the error as the
  // exception, the Model and the Message attached as extra data. The
  // environment is `development` because the hostname is `localhost`. No
  // user is attached: nothing in a report identifies the visitor.
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

  // `Option.none()` becomes no `message` entry at all in the report.
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

// The report behind the `ReportProblem` Command: a microphone that failed
// for a reason other than the person's own refusal.
describe('reportMicrophoneProblem', () => {
  // The report is sent as an `Error` named after the browser's error, so the
  // issue in Sentry is titled by it. Sent as a plain message, it was titled
  // by the function that sent it (FINDINGS.md, "A reported message is titled
  // by the function that sent it"). The tag and the fingerprint make Sentry
  // group reports by the browser's error name.
  test('a microphone problem is sent as an error titled with the error name and grouped by it', async () => {
    const { sent, events } = startRecording()

    reportMicrophoneProblem({
      name: 'AbortError',
      detail: 'The device is busy',
    })
    await Sentry.flush()

    expect(sent).toHaveLength(1)
    expect(events).toHaveLength(1)
    const exception = events[0]?.exception?.values?.[0]
    expect(exception?.type).toBe('Microphone failed: AbortError')
    expect(exception?.value).toBe('The device is busy')
    expect(exception?.stacktrace?.frames?.length).toBeGreaterThan(0)
    expect(events[0]?.level).toBe('error')
    expect(events[0]?.tags?.['microphone_error']).toBe('AbortError')
    expect(events[0]?.fingerprint).toEqual(['microphone', 'AbortError'])
    expect(events[0]?.user).toBeUndefined()
  })

  // A thrown value with no name and no message (see the "unexplained" scene
  // in `scene.test.ts`) still makes a report with a title and some text.
  test('a problem with nothing to say is still titled', async () => {
    const { events } = startRecording()

    reportMicrophoneProblem({ name: 'Unknown', detail: '' })
    await Sentry.flush()

    const exception = events[0]?.exception?.values?.[0]
    expect(exception?.type).toBe('Microphone failed: Unknown')
    expect(exception?.value).toBe('The browser gave no message.')
  })

  // Only what is sent to Sentry is cut. The person is shown the browser's
  // whole message: see `failureSentence` in `microphone.test.ts`.
  test('a long detail is cut to 300 characters', async () => {
    const { events } = startRecording()

    reportMicrophoneProblem({ name: 'Error', detail: 'x'.repeat(1000) })
    await Sentry.flush()

    expect(DETAIL_LIMIT).toBe(300)
    expect(events[0]?.exception?.values?.[0]?.value).toBe('x'.repeat(300))
  })

  // A report made after the SDK has been shut down is dropped quietly.
  // Reporting must never be the thing that breaks the page.
  test('reporting when Sentry is not running does nothing and does not throw', async () => {
    const { sent } = startRecording()
    await Sentry.close()

    expect(() =>
      reportMicrophoneProblem({ name: 'Error', detail: 'late' }),
    ).not.toThrow()
    expect(sent).toHaveLength(0)
  })
})

// The Command itself, run for real. `story.test.ts` and `scene.test.ts`
// check that `update` returns `ReportProblem` and never run it. Here
// `ReportProblem(problem)` builds the Command, `.effect` is the Effect
// inside it (the work the Foldkit runtime would run), and `Effect.runPromise`
// runs that Effect and resolves with the result Message it ends in.
describe('ReportProblem', () => {
  const problem = { name: 'AbortError', detail: 'The device is busy' }

  test('sends the problem and completes', async () => {
    const { events } = startRecording()

    const result = await Effect.runPromise(ReportProblem(problem).effect)
    await Sentry.flush()

    expect(result).toEqual(Message.CompletedReportProblem())
    expect(events).toHaveLength(1)
    expect(events[0]?.exception?.values?.[0]?.type).toBe(
      'Microphone failed: AbortError',
    )
  })

  // An ad blocker or a lost connection makes every send fail. The Command
  // must still end with its result Message, or `update` would never hear
  // back. The project has no Node types, so the test cannot listen for an
  // unhandled rejection itself and relies on Vitest instead (FINDINGS.md,
  // "There are no Node types, so a test cannot listen for unhandled
  // rejections").
  //
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
