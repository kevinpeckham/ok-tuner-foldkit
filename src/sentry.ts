import { Option, String } from 'effect'

import * as Sentry from '@sentry/browser'

// CONSTANT

/** A public value: it only says where reports go. */
export const SENTRY_DSN =
  'https://5e7e796c6a347b35e4a1402e17517f4a@o4505247956860928.ingest.us.sentry.io/4512488535621632'

// NOTE: Vercel serves the production deployment at all of these. The bare
// domain redirects to www, and is listed in case that is ever turned round.
const PRODUCTION_HOSTNAMES: ReadonlyArray<string> = [
  'www.oktuner.com',
  'oktuner.com',
  'ok-tuner.vercel.app',
  'ok-tuner-lightning-jar.vercel.app',
]
const VERCEL_HOSTNAME_SUFFIX = '.vercel.app'

// NOTE: the repository is public, so a copy of this app can run anywhere: a
// fork on someone else's Vercel account, or `bun run dev` on any machine.
// Reports are sent only from the hosts above and below. A new domain must be
// added to PRODUCTION_HOSTNAMES, or the site on it will report nothing.
const OUR_PREVIEW_PREFIX = 'ok-tuner-'
const OUR_PREVIEW_SUFFIX = '-lightning-jar.vercel.app'
const OUR_DEVELOPMENT_HOSTNAME = 'ok-tuner.bench.lj.dev'

// NOTE: this integration tells Sentry about every visit, crash or not. It is
// a default, and only sends once a release is set, which the build does.
const SESSION_INTEGRATION_NAME = 'BrowserSession'

/** A browser's error text is sent to Sentry cut to this many characters. */
export const DETAIL_LIMIT = 300

// NOTE: the SDK flattens anything nested deeper than 3 to "[Object]" by
// default, which loses the current reading from a crash report's Model.
const NORMALIZE_DEPTH = 10

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

/** Whether this hostname is one of ours, and so reports to Sentry. */
export const reportsFrom = (hostname: string): boolean =>
  PRODUCTION_HOSTNAMES.includes(hostname) ||
  hostname === OUR_DEVELOPMENT_HOSTNAME ||
  (String.startsWith(OUR_PREVIEW_PREFIX)(hostname) &&
    String.endsWith(OUR_PREVIEW_SUFFIX)(hostname))

// OPTIONS

/** Errors only, and only from our own hosts. Nothing is sent on a visit where
 *  nothing went wrong. An error report carries the page URL, the browser's
 *  locale and timezone, and recent clicks and console lines; the SDK's
 *  collection of IP address, cookies, headers and query strings is off. */
export const sentryOptions = (hostname: string): Sentry.BrowserOptions => ({
  dsn: SENTRY_DSN,
  enabled: reportsFrom(hostname),
  environment: environmentOf(hostname),
  attachStacktrace: true,
  normalizeDepth: NORMALIZE_DEPTH,
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
    return
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
