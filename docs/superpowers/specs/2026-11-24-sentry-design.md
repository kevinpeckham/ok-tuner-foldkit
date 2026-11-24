# Error reporting with Sentry, secrets with Varlock: design

Status: approved by Kevin on 2026-11-24. A builder's read-through of the same day is folded in.

## Intent

OK Tuner is live at <https://ok-tuner.vercel.app/>. Kevin built it to learn Foldkit and wants to test two more parts of his usual stack on it: Sentry for error reports, and Varlock with 1Password for secrets. This change adds both.

The why is learning: seeing how error reporting sits inside a Foldkit app (its crash hook, and a report sent as a Command), and how Varlock supplies a build-time secret to a plain Vite app on Vercel.

## Goals

1. A crash or uncaught error in the live tuner reaches the Sentry project `ok-tuner`, with a readable stack trace.
2. A caught failure that means something is broken is reported too. Today that is one case: the microphone fails to open for a reason that is neither "permission refused" nor "unsupported browser".
3. The one secret this needs, the token that uploads source maps, comes from 1Password through Varlock. It is never stored in Vercel or in the repository.
4. The tuner looks and behaves the same for the person using it.

## Non-goals

- Session replay, performance tracing, user feedback widgets.
- A Content Security Policy (in the backlog; Sentry's ingest host will be the one third-party origin it must allow).
- A custom crash screen. Foldkit's default stays; a friendlier one goes in the backlog.
- Better wording for a missing or busy microphone (in the backlog under "Microphone and listening").
- Reporting slow frames through Foldkit's `slow` hook. It does not measure pitch detection, which runs inside the readings stream.
- A Sentry tunnel to get past ad blockers. A visitor whose blocker stops Sentry is simply not reported.

## Anti-goals

- **Tracking people.** No user identifiers, no cookies, no replay, no stored IP addresses, and nothing sent to Sentry on a visit where nothing went wrong. The page is to be described as "ad-free, ad-tracker-free" and this change must keep that true.
- **Reporting people's own choices as errors.** Refusing the microphone and blocking site storage are choices. Neither is reported.
- **A secret in the wrong place.** The token must not appear in the repository, in the built files, in Vercel's own environment variables, or in a session transcript.
- **Breaking the build for people without 1Password.** The repository is public. Tests, lint, typecheck and a local dev server must still run for someone with no access to the 1Password environment.

## Constraints

- Foldkit conventions (`FOLDKIT.md`): side effects happen in Commands; a Command's result Message is named from the Command; no `NoOp`.
- Lightning Jar's Varlock conventions: `.env.schema` committed; `.env.local` git-ignored and holding only `OP_TOKEN` and `OP_ENV_ID`; Vercel holds only those two; every secret marked `@sensitive`. (Code that reads a variable uses `import { ENV } from 'varlock/env'`; nothing under `src` reads one in this change, and nothing under `src` may import `varlock/env` without revisiting the tests and the `SKIP_VARLOCK` route.)
- A repository that uses Varlock declares the documentation server `varlock-docs-mcp` (`https://docs.mcp.varlock.dev/mcp`) in `.mcp.json`. Read it before writing `.env.schema`.
- No attribution lines on commits or pull requests.
- Deployment is from GitHub: pull requests get previews, `main` is production.
- Dependencies are pinned to exact versions, as the rest of `package.json` is.

## Approaches

Three ways to get a caught microphone failure to Sentry were considered. All three share the crash hook, the DSN in source and the source-map upload; they differ in where the report is sent from.

1. **A Command returned by `update`.** The failure Message carries its kind; `update` returns a reporting Command for the unexpected kind. The decision is visible in the devtools history and tested like every other Command. Costs a change to the failure Message and the `Failed` state.
2. **The same, with the reporter as an Effect service** supplied through Foldkit's `resources` layer. More idiomatic Effect and exercises a Foldkit feature not yet used here, but more machinery than one Command and one SDK call need.
3. **Report where the error is classified,** inside the microphone module. Least code, but a side effect hidden in a mapping function that `update` never sees, against Foldkit's grain.

**Kevin picked 1.**

## What Kevin decided

- Report crashes, uncaught errors, and caught failures that mean something is broken (not crashes alone).
- Approach 1.
- One 1Password environment for all stages, holding `SENTRY_AUTH_TOKEN`. Kevin provisions it, the service-account token, and the Sentry Organization Token.
- The VM may hold `.env.local` with access to that environment.

Everything else below is the designer's call, open to correction.

## Design

### Sentry project

- Organisation `lightning-jar`, team `lightning-jar`, project `ok-tuner`, platform browser JavaScript. Created through the Sentry connector on 2026-11-24. Its DSN, a public value: `https://5e7e796c6a347b35e4a1402e17517f4a@o4505247956860928.ingest.us.sentry.io/4512488535621632`.
- "Prevent storing of IP addresses" is switched on for the project. The connector cannot set it, so Kevin switches it on in the project's Security & Privacy settings; the work is not done until it is on.

### The SDK in the browser

- Package `@sentry/browser`.
- A new module `src/sentry.ts` owns everything that touches the SDK: the DSN constant, `initSentry()`, the function the crash hook calls, and the function the reporting Command calls. No other module imports `@sentry/browser`.
- The DSN is a public value and is a constant in that module, as in Stem Shovel (`src/lib/constants/sentryDsn.ts` there).
- Sentry is initialised before any other module of the app is evaluated, so its handlers for uncaught errors and unhandled rejections are in place from the start. An `import` is evaluated before any statement in `src/entry.ts` runs, so this means a first side-effect import there, not a first statement. Tests never import `entry.ts`, so tests never initialise Sentry.
- Options: errors only.
  - No `tracesSampleRate` and no replay integration.
  - **No per-visit session ping.** The SDK's browser session integration is on by default and sends an envelope on every page load. It is removed. The cost is that Sentry shows no crash-free-session figures.
  - **Every data-collection category off.** Current SDKs replace `sendDefaultPii` with `dataCollection`, whose defaults are on and include inferring the IP address. User information, cookies, headers, query parameters and request bodies are all switched off, as Stem Shovel does in `src/hooks.client.ts`. The builder confirms the option names against the installed SDK version.
  - `attachStacktrace: true`, so a reported message carries the stack of the call that reported it.
- `environment` is decided from the hostname by a pure, tested function:
  - `ok-tuner.vercel.app` and `ok-tuner-lightning-jar.vercel.app` are `production` (Vercel serves the production deployment at both);
  - any other `*.vercel.app` is `preview`;
  - anything else (`localhost`, `ok-tuner.bench.lj.dev`) is `development`.
- Sentry is on in development too, as in Stem Shovel. The environment tag keeps the three apart.

### Crashes

`Runtime.makeApplication` gets `crash: { report }`. The report function sends the error with `captureException`, attaching the Model and the Message being handled as extra data (Foldkit's documented pattern, `repos/foldkit/packages/website/src/snippet/crashReport.ts`). The Model holds tuner state, the tuning id, A4 and the A4 field's text: nothing personal.

Foldkit's runtime catches a crash itself (in `update`, rendering, Commands, Subscriptions and the managed-resource lifecycle), so the hook is the only route for those. Sentry's own global handlers cover errors thrown outside the runtime.

### Caught failures: the microphone

Today a failed microphone becomes `FailedAcquireMicrophone({ reason })`, where `reason` is the sentence shown to the person, and `update` cannot tell a refusal from a fault.

The change:

- A microphone failure becomes a small tagged union with three kinds:
  - **Refused**: the browser's `NotAllowedError`.
  - **Unsupported**: the browser has no way to open a microphone.
  - **Unexpected**: anything else, carrying the error's name and its message as text.
- `FailedAcquireMicrophone` and the `Failed` tuner state carry that union instead of a sentence.
- The view turns the kind into the sentence. The three sentences stay word for word what they are today, with one exception noted next.
- **Exception, for the person's benefit:** today an unexpected error shows the browser's raw message when it has one. That stays. The union's `Unexpected` kind keeps the message so the view can still show it.
- When `update` receives an `Unexpected` failure while starting or listening, it returns a new Command, `ReportProblem`, alongside moving to `Failed`. For `Refused` and `Unsupported` it returns no Command.
- `ReportProblem` sends a Sentry message at level `error` naming the microphone and the error's name, with the error's message as extra data and the error's name as a tag, so Sentry groups by error name. Its result Message is `CompletedReportProblem`, which changes nothing in the Model.
- A missing microphone (`NotFoundError`) and a busy one (`NotReadableError`) count as unexpected for now and are reported. Once Sentry shows how often they happen they can get their own kinds and sentences; that is the backlog item, not this change.

Not reported: `FailedSavePreferences`. The app cannot tell blocked storage from any other storage fault, and blocked storage is the person's choice.

### Source maps

- Package `@sentry/vite-plugin`, in `vite.config.ts`, after the other plugins. Stem Shovel gets this plugin through `@sentry/sveltekit`, so it does not prove the standalone package on Vite 8: the builder checks the version's Vite support before installing.
- The build produces hidden source maps; the plugin uploads them and deletes them from `dist` afterwards, so they are not served.
- Upload happens only on Vercel builds (`VERCEL` is set) and only when the token is present. A local `bun run build` never uploads and needs no token.
- The plugin's own release handling is left at its defaults; the builder confirms that events from a Vercel build show resolved frames, by the check under "Proof it works".

### Varlock and 1Password

- Packages `varlock`, `@varlock/vite-integration`, `@varlock/1password-plugin`.
- `.env.schema`, modelled on Stem Shovel's (`~/projects/stem-shovel/.env.schema`), declares:
  - `OP_TOKEN` (the service-account token) and `OP_ENV_ID`, both internal;
  - `SENTRY_AUTH_TOKEN`, sensitive, **required on Vercel preview and production builds** and optional in development. A Vercel build without it fails, instead of quietly shipping unreadable stack traces;
  - the Vercel-set variables the build sees (`VERCEL`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_OIDC_TOKEN` and any other the leak scanner complains about), with the right sensitivity;
  - `APP_ENV`, falling back from `VERCEL_ENV` to `development`.
- `.gitignore` ignores `.env.*` today, which would hide `.env.schema`. It gains `!.env.schema`, as Stem Shovel's has.
- The Varlock Vite plugin is added to `vite.config.ts` and is what puts `SENTRY_AUTH_TOKEN` in front of the Sentry plugin: it resolves the environment into `process.env` when it is imported, and the Sentry plugin reads the token from there. It is imported only when it will be used: setting `SKIP_VARLOCK=1` leaves it out, as in Stem Shovel's `vite.config.ts`. `SKIP_VARLOCK` is never set on Vercel.
- Someone without 1Password access needs `SKIP_VARLOCK=1` only for the dev server and a local build. Tests, lint and typecheck need nothing: `vitest.config.ts` is a separate file, and typecheck and lint cover only `src`.
- On an invalid or unresolvable environment the plugin ends a build with an error and, in development, serves an error page in place of the app.
- The app's browser code reads no environment variable in this change. The schema and plugin are still the real thing: they resolve from 1Password at every dev start and every Vercel build.
- `.mcp.json` gains the `varlock-docs-mcp` server.
- Kevin puts `OP_TOKEN` and `OP_ENV_ID` in the Vercel project (Production and Preview) and in `.env.local` on the VM. Nobody pastes either into a session. As of 2026-11-24 both are in place, and `SENTRY_AUTH_TOKEN` is in the 1Password environment.
- **Fork pull requests.** The repository is public and a preview build runs the pull request's own `vite.config.ts` with `OP_TOKEN` in its environment. Vercel's Git Fork Protection, which holds a fork's pull request until a team member authorises it, is what stops a stranger reading the token. It was on for this project when checked on 2026-11-24. The plan checks it again before `OP_TOKEN` goes into Vercel, and stops if it is off.

### Order of work

The Sentry half needs no secret and comes first: project, SDK, crash hook, the failure kinds, the reporting Command. It can be finished and checked in development before Kevin's provisioning is done.

The Varlock half and the source-map upload come second and wait for the Vercel variables. The dev server on the VM serves the working tree, so the Varlock plugin is added to `vite.config.ts` only once `bunx varlock load --agent` validates there.

Both halves ship in one pull request from `feat/sentry`, so production never runs with reporting on and unreadable stack traces. If the Vercel variables are not in place when the rest is done, the work stops there and waits.

### Tests

- Story: an `Unexpected` failure while starting returns exactly `ReportProblem` and moves to `Failed`; `Refused` and `Unsupported` return no Command; a failure while `Off` changes nothing and returns nothing.
- Scene: each kind shows its sentence in the alert; the existing "refused" scene test keeps passing with its current wording.
- The classification of a thrown value into a kind, including a value that is not an `Error`.
- The hostname-to-environment function, for the three hostnames above and one preview hostname.
- What `ReportProblem` and the crash report actually hand to Sentry, checked without the network (the builder picks the means; Sentry's SDK accepts a custom transport).
- Existing tests that construct `FailedAcquireMicrophone` or `Failed` are updated to the new shape; none is deleted.

### Proof it works

1. **Development:** with the dev server running, dispatch an `Unexpected` microphone failure through the Foldkit devtools; an event appears in Sentry tagged `development`.
2. **Preview:** the pull request's Vercel build log shows source maps uploaded, and the built files contain no `.map` file and no token.
3. **Production, after merge:** open the live site in headless Chrome with no microphone device and press On. An event appears in Sentry tagged `production`, its stack frames naming files under `src/`, not minified bundle names.
4. `bunx varlock load --agent` validates on the VM.

## Left to the builder

- Exact names and shapes of the failure union, the new Command's arguments, and the functions in `src/sentry.ts`.
- Package versions (current stable, pinned exactly).
- The exact `.env.schema` decorators, after reading the Varlock documentation server.
- Whether the environment for a report is set once at `initSentry()` or per event.
- How the Sentry message is titled and fingerprinted, provided events group by error name.

## Housekeeping

- `README.md`: a short "Error reporting" and "Environment" section, including `SKIP_VARLOCK=1` for people without 1Password.
- `AGENTS.md`: Sentry and Varlock leave "Deliberately later"; an "Environment" note says where secrets live and that `.env.local` is never opened in a session.
- `docs/backlog.md`: remove Sentry and Varlock; add "custom crash screen"; under the Content Security Policy item, name Sentry's ingest host.
- `~/projects/CLAUDE.md`: the ok-tuner entry says it needs `.env.local` (`OP_TOKEN`, `OP_ENV_ID`) and names its Sentry project.
