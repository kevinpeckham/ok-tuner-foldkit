// sentry.ts: everything that touches the Sentry SDK.
//
// What this file is. Sentry is the service that receives this app's error
// reports. This module and its test are the only files that import
// `@sentry/browser` (AGENTS.md, "Error reporting"), so the rest of the app
// depends on three small functions and not on the SDK. Nothing from Foldkit
// is imported here: these are plain functions that the Foldkit parts call.
//
// How it connects to the Foldkit parts. An error can reach Sentry by three
// routes, and it helps to keep them apart.
//
//   1. A crash inside the Foldkit runtime. The runtime itself catches an
//      error thrown in `update`, in the view, in a Command, in a Subscription
//      or in a managed resource's lifecycle, and shows the crash screen
//      (src/crash.ts).
//      Nothing reaches the browser's global error handlers, so Sentry's own
//      handlers never see it. Foldkit's hook for this case is the
//      `crash: { report }` option of `Runtime.makeApplication`, and
//      `src/entry.ts` passes `reportCrash` to it. See FINDINGS.md, "Foldkit
//      catches crashes itself, so Sentry's own handlers never see them".
//
//   2. A failure the app caught and handled, but which means something is
//      broken. Today there is one: a microphone that fails to open for a
//      reason the app does not recognise. (A refusal, an unsupported
//      browser, and a missing, busy or unplugged microphone are the
//      person's own situation, and are not reported.)
//      `update` returns the `ReportProblem` Command (`src/main.ts`), and
//      that Command calls `reportMicrophoneProblem`. It is a Command, and
//      not a call from where the error is caught, so that the report shows
//      in the devtools history and is tested like any other Command. See
//      FINDINGS.md, "A caught failure is reported by a Command, not where it
//      is caught".
//
//   3. An error thrown outside the runtime. Sentry's global handlers catch
//      these. They are installed by `initSentry`, which is why it must run
//      before the rest of the app loads: `src/instrument.ts` calls it, and
//      `entry.ts` imports that file first.
//
// What is sent. Errors only: a visit where nothing goes wrong sends nothing
// to Sentry. The reasons are in the Sentry design
// (docs/superpowers/specs/2026-11-24-sentry-design.md, "Anti-goals"), and
// what was learned on the way is in the Sentry section of FINDINGS.md.
//
// Read `src/instrument.ts` and `src/entry.ts` alongside this file, and the
// `ReportProblem` Command in `src/main.ts`.

// `Option` is Effect's "value that may be absent". `String` is Effect's
// module of string helpers, and inside this file the name hides JavaScript's
// global `String`.
import { Option, String } from 'effect'

// The whole SDK as one namespace: `Sentry.init`, `Sentry.captureException`,
// and the `Sentry.BrowserOptions` type.
import * as Sentry from '@sentry/browser'

// CONSTANT

// The DSN ("data source name") is the address of this app's project in
// Sentry. Every browser that runs the app has to be given it, so it cannot
// be a secret, and it is a constant here and not an environment variable.
// That keeps one of this project's rules: nothing under `src` reads the
// environment, so tests and typecheck need no secrets (FINDINGS.md, "The
// environment tag comes from the hostname"). What stops someone else's copy
// of the app reporting to this address is the host check in `reportsFrom`.
/** A public value: it only says where reports go. */
export const SENTRY_DSN =
  'https://5e7e796c6a347b35e4a1402e17517f4a@o4505247956860928.ingest.us.sentry.io/4512488535621632'

// The hostnames of the live site. The list is used twice: `environmentOf`
// tags a report from one of them `production`, and `reportsFrom` lets them
// report at all. A new domain must be added here, or the site on it reports
// nothing and says nothing about it (FINDINGS.md, "A new domain reports
// nothing until it is listed").
//
// NOTE: Vercel serves the production deployment at all of these. The bare
// domain redirects to www, and is listed in case that is ever turned round.
const PRODUCTION_HOSTNAMES: ReadonlyArray<string> = [
  'www.oktuner.com',
  'oktuner.com',
  'ok-tuner.vercel.app',
  'ok-tuner-lightning-jar.vercel.app',
]

// The one other host that is ours and reports: the project's own dev server
// (AGENTS.md, "Dev server on the lj-bench VM"). `reportsFrom` uses it.
//
// This project's Vercel previews are ours too, and report nothing. Their
// addresses have the form `ok-tuner-<something>-lightning-jar.vercel.app`,
// and the Sentry project's Allowed Domains setting has no pattern narrow
// enough to accept them, so Sentry would drop whatever they sent
// (FINDINGS.md, "Previews report nothing").
//
// NOTE: the repository is public, so a copy of this app can run anywhere: a
// fork on someone else's Vercel account, or `bun run dev` on any machine.
// Reports are sent only from the hosts above and below. A new domain must be
// added to PRODUCTION_HOSTNAMES, or the site on it will report nothing.
const OUR_DEVELOPMENT_HOSTNAME = 'ok-tuner.bench.lj.dev'

// An integration is a plug-in of the SDK, and each one has a `name`. This is
// the name of the one `sentryOptions` removes from the SDK's defaults. A
// "release" is the version label a report carries. The Sentry plugin in
// `vite.config.ts` writes one into every Vercel build, so the integration
// would stay silent in development and start sending on the live site
// (FINDINGS.md, "A default integration tells Sentry about every visit").
//
// NOTE: this integration tells Sentry about every visit, crash or not. It is
// a default, and only sends once a release is set, which the build does.
const SESSION_INTEGRATION_NAME = 'BrowserSession'

// Used by `reportMicrophoneProblem` below. Exported so the test can assert
// on it.
/** A browser's error text is sent to Sentry cut to this many characters. */
export const DETAIL_LIMIT = 300

// The value of the SDK's `normalizeDepth` option: how many levels of nested
// data it keeps in what is attached to a report. A crash report attaches
// the whole Model, and a `Listening` Model is nested deeper than the default
// (FINDINGS.md, "Crash reports flattened the Model").
//
// NOTE: the SDK flattens anything nested deeper than 3 to "[Object]" by
// default, which loses the current reading from a crash report's Model.
const NORMALIZE_DEPTH = 10

// ENVIRONMENT

// The two values of the `environment` tag on a report. The tag is what
// keeps reports from the live site and from development apart in Sentry.
export type SentryEnvironment = 'production' | 'development'

// Why the hostname: nothing under `src` reads an environment variable, so
// the hostname is all the browser has to go on.
//
// Every host that is not the live site comes out as `development`:
// `localhost`, the dev server, a Vercel preview. Whether a host reports at
// all is a separate question, answered by `reportsFrom`. Of the
// `development` hosts only the dev server does, so in Sentry `development`
// means the dev server.
/** The browser has only its hostname to say which deployment it is running. */
export const environmentOf = (hostname: string): SentryEnvironment =>
  PRODUCTION_HOSTNAMES.includes(hostname) ? 'production' : 'development'

// The gate. `sentryOptions` passes the answer to the SDK as `enabled`, and
// with `enabled: false` the SDK sends nothing. Two kinds of host pass:
//   - the production hostnames;
//   - the dev server.
// Nothing else does. `localhost` does not, so `bun run dev` on any machine
// reports nothing, and neither do the tests, which run on `localhost`. A
// proof in development has to use the dev server's own address. A Vercel
// preview does not, whether it is ours or a fork deployed from someone
// else's account (FINDINGS.md, "Reports are sent only from a list of our own
// hosts").
//
// The list has a twin outside the code: the Allowed Domains setting of the
// Sentry project, which makes Sentry drop a report from any other origin.
// Keep the two the same (FINDINGS.md, "Sentry's Allowed Domains").
/** Whether this hostname is one of ours, and so reports to Sentry. */
export const reportsFrom = (hostname: string): boolean =>
  PRODUCTION_HOSTNAMES.includes(hostname) ||
  hostname === OUR_DEVELOPMENT_HOSTNAME

// OPTIONS

// The options handed to `Sentry.init`. This is a pure function of the
// hostname, so the tests can check every option without starting the SDK.
//
//   dsn               Where reports go.
//
//   enabled           False on any host that is not ours. The SDK then
//                     sends nothing.
//
//   environment       The tag described at `SentryEnvironment` above.
//
//   attachStacktrace  Attach a stack trace to a report that has none of its
//                     own: a captured message, or a thrown value that is not
//                     an Error. `true` is also the default in the installed
//                     SDK (11.14.0); it is written out so that the choice
//                     can be seen.
//
//   normalizeDepth    See NORMALIZE_DEPTH above.
//
//   dataCollection    What the SDK may gather by itself. In this SDK version
//                     it takes the place of the older `sendDefaultPii`
//                     switch, and its categories are ON unless switched off
//                     (FINDINGS.md, "The SDK's privacy switches changed
//                     name, and they default to on"). The five set here:
//                       userInfo: false        Do not fill in the `user`
//                                              fields of a report. With this
//                                              off, the SDK also marks what
//                                              it sends so that Sentry does
//                                              not infer the visitor's IP
//                                              address.
//                       cookies: false         No cookies.
//                       httpHeaders: false     No request or response
//                                              headers.
//                       httpBodies: []         No request or response
//                                              bodies. The option is a list
//                                              of the kinds to collect, and
//                                              an empty list means none.
//                       urlQueryParams: false  No query strings from URLs.
//                     The SDK's other categories (GraphQL, AI, MCP, database
//                     queries, queues, stack-frame variables) are not set
//                     here and keep their defaults.
//
//   integrations      Given a function, the SDK calls it with its list of
//                     default integrations and installs whatever the function
//                     returns. This one drops `BrowserSession` and keeps the
//                     rest. The cost is that Sentry shows no
//                     crash-free-session figures for the app.
//
// What is left out matters as much: there is no `tracesSampleRate`, so no
// performance tracing, and no replay integration (the Sentry design, "The
// SDK in the browser").
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

// Starts the SDK. `src/instrument.ts` calls it once, as the page loads, and
// `Sentry.init` installs the SDK's handlers for uncaught errors and
// unhandled promise rejections (route 3 in the header).
//
// `overrides` is there for the tests. They pass `enabled: true` (tests run
// on `localhost`, where reporting is off), a `transport` that records what
// would have been sent, and a `beforeSend` that records each event, so
// nothing touches the network (FINDINGS.md, "Testing Sentry without the
// network"). The app itself calls `initSentry()` with no arguments.
//
// `window.location.hostname` is read here, at the edge, so that
// `sentryOptions`, `environmentOf` and `reportsFrom` stay pure functions of a
// string.
//
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

// What Foldkit passes to a crash reporter: the error, the Model at the time,
// and the Message that was being handled. The Message is an Option because a
// crash can happen with no Message in hand, as in a managed resource's
// lifecycle.
//
// Foldkit's own type for this is `CrashContext<Model, Message>`. Here the
// Model and the Message are typed `unknown`: the reporter only passes them on
// to Sentry, and this way the file does not need to import `main.ts`.
type Crash = Readonly<{
  error: Error
  model: unknown
  message: Option.Option<unknown>
}>

// Route 1 in the header. `entry.ts` wires it in as the first half of the
// `crash.report` hook (`Crash.reportThenClose(reportCrash, ...)`), and the
// runtime calls it when it crashes.
//
// `Sentry.captureException(error, context)` sends the error as a report.
// `extra` is free-form data shown with the report in Sentry: here the Model,
// and the Message. `Option.getOrUndefined` turns the Option into the Message
// or `undefined`, since Sentry knows nothing of Options. The pattern is the
// one in Foldkit's own documentation
// (`repos/foldkit/packages/website/src/snippet/crashReport.ts`).
/** Foldkit's crash hook: the error, with the Model and the Message that was
 *  being handled. The Model holds no personal data. */
export const reportCrash = ({ error, model, message }: Crash): void => {
  Sentry.captureException(error, {
    extra: { model, message: Option.getOrUndefined(message) },
  })
}

// What `reportMicrophoneProblem` needs: the browser error's name and its
// message. The same two fields are the arguments of the `ReportProblem`
// Command and the payload of `MicrophoneFailure.Unexpected`, so `main.ts`
// passes them through unchanged.
type MicrophoneProblem = Readonly<{ name: string; detail: string }>

// The text of the report when the browser's error had no message.
const NO_DETAIL = 'The browser gave no message.'

// Route 2 in the header. The `ReportProblem` Command in `main.ts` calls this
// inside `Effect.sync`. It is a plain function that returns nothing: the
// Command wraps it and supplies the Message that says the report was made.
//
// What is sent is an Error built for the purpose. The browser's own error
// object is gone by now, because the Model keeps only its name and message
// as text.
//   - `Object.assign(new Error(text), { name })` makes an Error whose `name`
//     is, for example, "Microphone failed: NotFoundError" and whose message
//     is the browser's. Sentry titles the issue from the two. Why it is not
//     a plain message: FINDINGS.md, "A reported message is titled by the
//     function that sent it".
//   - `detail.slice(0, DETAIL_LIMIT)` cuts the browser's text to 300
//     characters before it leaves the page.
//   - `level: 'error'` is its severity in Sentry.
//   - `tags` puts a searchable label on the report: the browser's error
//     name.
//   - `fingerprint` tells Sentry how to group reports into issues, in place
//     of its own grouping. With this one, every report with the same error
//     name lands in one issue.
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
