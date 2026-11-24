import { Option, String } from 'effect'

import * as Sentry from '@sentry/browser'

// CONSTANT

/** A public value: it only says where reports go. */
export const SENTRY_DSN =
  'https://5e7e796c6a347b35e4a1402e17517f4a@o4505247956860928.ingest.us.sentry.io/4512488535621632'

// Vercel serves the production deployment at both.
const PRODUCTION_HOSTNAMES: ReadonlyArray<string> = [
  'ok-tuner.vercel.app',
  'ok-tuner-lightning-jar.vercel.app',
]
const VERCEL_HOSTNAME_SUFFIX = '.vercel.app'

// The integration that tells Sentry about every visit, crash or not.
const SESSION_INTEGRATION_NAME = 'BrowserSession'

/** A browser's error text is sent to Sentry cut to this many characters. */
export const DETAIL_LIMIT = 300

// ENVIRONMENT

export type SentryEnvironment = 'production' | 'preview' | 'development'

/** The browser has only its hostname to say which deployment it is running. */
export const environmentOf = (hostname: string): SentryEnvironment => {
  if (PRODUCTION_HOSTNAMES.includes(hostname)) {
    return 'production'
  } else if (String.endsWith(VERCEL_HOSTNAME_SUFFIX)(hostname)) {
    return 'preview'
  } else {
    return 'development'
  }
}

// OPTIONS

/** Errors only. Nothing is sent on a visit where nothing went wrong, and
 *  nothing about the visitor is collected when something does. */
export const sentryOptions = (hostname: string): Sentry.BrowserOptions => ({
  dsn: SENTRY_DSN,
  environment: environmentOf(hostname),
  attachStacktrace: true,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
  integrations: defaults =>
    defaults.filter(({ name }) => name !== SESSION_INTEGRATION_NAME),
})

// INIT

// NOTE: this is the one place a plain try/catch is right. Reporting is an
// extra: if the SDK cannot start (a bad setting, a browser that blocks what
// it needs), the tuner must still start, and there is nowhere to report to.
export const initSentry = (
  overrides: Partial<Sentry.BrowserOptions> = {},
): void => {
  try {
    Sentry.init({ ...sentryOptions(window.location.hostname), ...overrides })
  } catch {
    // Start without reporting.
  }
}

// REPORT

type Crash = Readonly<{
  error: Error
  model: unknown
  message: Option.Option<unknown>
}>

/** Foldkit's crash hook: the error, with the Model and the Message that was
 *  being handled. The Model holds no personal data. */
export const reportCrash = ({ error, model, message }: Crash): void => {
  Sentry.captureException(error, {
    extra: { model, message: Option.getOrUndefined(message) },
  })
}

type MicrophoneProblem = Readonly<{ name: string; detail: string }>

const NO_DETAIL = 'The browser gave no message.'

/** A microphone that failed to open for a reason other than the person's own
 *  refusal. Sent as an error named after the browser's error, so the issue in
 *  Sentry is titled by it and carries the stack of this call. Grouped by the
 *  error's name. */
export const reportMicrophoneProblem = ({
  name,
  detail,
}: MicrophoneProblem): void => {
  const text = String.isNonEmpty(detail)
    ? detail.slice(0, DETAIL_LIMIT)
    : NO_DETAIL

  Sentry.captureException(
    Object.assign(new Error(text), { name: `Microphone failed: ${name}` }),
    {
      level: 'error',
      tags: { microphone_error: name },
      fingerprint: ['microphone', name],
    },
  )
}
