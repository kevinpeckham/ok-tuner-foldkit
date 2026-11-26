# Test debt: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). It works through the "Tests" section of the backlog and the two test items of "Pages and routing".

## Intent

The suite has gaps that the backlog lists: assertions that cannot fail, paths that no test reaches, and behaviour that is only checked by hand in headless Chrome. This change closes the ones that can be closed without a browser, and says exactly what is left for the ones that cannot. A visitor gets nothing new, so the version stays at 0.7.1.

## What was found first

Read in `repos/foldkit/`, in the installed `@sentry/browser` 11.14.0, and tried in throwaway tests.

- **A click that opens a component, in a Scene.** `click` on the tuning picker returns one Command, the Listbox's `FocusItems`, and draws the open list, which carries two Mounts (`AnchorListbox`, `PortalListboxBackdrop`). `click` on the settings menu returns no Command and draws two Mounts (`AnchorPopover`, `PortalPopoverBackdrop`). Each has to be resolved before the next interaction. Foldkit's own Listbox test does the same (`repos/foldkit/packages/ui/src/listbox/single.test.ts`, "still opens from the button and closes on Escape").
- **Choosing with the list open returns two Commands:** the Listbox's `FocusButton` and our `SavePreferences`. With the list closed, as in the two existing Story tests, only `SavePreferences` comes back.
- **Where the "no IP" mark is.** The browser client sets `settings: { infer_ip: 'never' }` in its SDK metadata when `dataCollection.userInfo` is off (`client.js`). For an error it reaches the wire in the event itself, at `sdk.settings.infer_ip`: `createEventEnvelope` merges it in after `beforeSend` has run. The envelope's own header carries only the SDK's name and version. So `beforeSend` cannot see the mark when it runs, and the recording transport can. (The event object the hook was handed gains the mark afterwards, since the SDK writes to the same object. That is a side effect, not what was sent.)
- **`Sentry.captureException` cannot be replaced by a spy:** Vitest refuses to spy on an export of an ES module. It calls `getCurrentScope().captureException(...)`, and the scope is an ordinary object whose method can be replaced. That makes the real `reportMicrophoneProblem` throw.
- **The blocked-storage test is weaker than the backlog says.** It runs on `localhost`, where `enabled` is false, so the SDK sets up no integration at all. And with our options this SDK version reads site storage nowhere: the only file that does is the linked-traces code of browser tracing, which is not installed. An integration that reads `sessionStorage` in its set-up does make `Sentry.init` throw when storage is blocked and reporting is on.
- **There is no public way to hand `view` a builder.** `inertHtml` is an `HtmlBuilder<never>`, and the app's view needs an `HtmlBuilder<Message>`. `Server.renderToString` calls the real `view` with a builder of its own and returns the `title` and `canonical` of the Document it got back, unchanged (`server.ts`, where `RenderedApplication` is built).
- **happy-dom can click through.** A runtime started with routing in happy-dom cancels a click on a link, `history.pushState` moves `window.location`, the page and the title change, focus lands on the new page's heading, and `history.back()` fires `popstate` and brings the tuner back. `window.location.assign` can be replaced by a spy. `navigator.mediaDevices` and `AudioContext` do not exist there, so the microphone is a stand-in, as in `src/microphone.test.ts`.
- **A managed resource's value cannot be supplied from outside a runtime** through Foldkit's public interface: the service behind `Microphone.get` is the tag's `_tag` field, marked internal. Foldkit tests its own managed resources by starting a runtime (`managedResourceLifecycle.test.ts`).

## Goals

- Every item is either done and off the backlog, or still there with a sentence that says what remains and why.
- Every test added or repaired has been seen to fail, by breaking the line it guards. The pull request lists each breakage.
- The app is unchanged: the built script is the same, byte for byte.

## Not goals

- Changing what the app does, or its version (given).
- Any other backlog item (given).
- A browser in the suite. Layout, stacking, real audio and what Sentry receives from a built site stay with the headless Chrome scripts.

## Approaches

### The readings stream

1. **Start the real app in happy-dom with a stand-in microphone (chosen).** The runtime opens the stand-in, runs the real `readings` Subscription on the real clock, and the test reads the page. Nothing is exported, and it is how Foldkit tests a managed resource.
2. **Export `measureInput` and supply the Microphone service by hand.** Not chosen: the service's tag is internal to Foldkit, and an export for a test changes the built script for no gain in what is covered.
3. **Unit tests of `hasEnded` and `readMeasurement` only.** Already there in part. They do not show that an ended track produces `LostMicrophone` in place of a reading, which is the Subscription's decision.

What it costs: the test waits on a 50 ms tick, so it takes about a quarter of a second of real time, and a slow machine makes it slower, never wrong: every wait polls up to two seconds.

### The click-through

1. **A second runtime test, on the real app (chosen, given).** `src/crash.runtime.test.ts` already starts a runtime, on a toy app. This one wires `init`, `update`, `view`, the managed resource and the Subscription as `src/entry.ts` does.
2. **Import `src/entry.ts` in a test.** Not chosen: it starts Sentry and the analytics, and calls `Runtime.hydrate`, which needs a page drawn by the same build.

What it cannot cover is recorded in the backlog: `entry.ts` itself, and the takeover of a prerendered page.

### The title and the canonical address

1. **Assert on what `Server.renderToString` returns (chosen).** It is the real `view`, called by Foldkit, and its `title` and `canonical` are passed through untouched. The server entry's tests already read both out of the finished HTML for every route, so the item is covered today; one table in `src/view.test.ts` holds the view to `pageTitle` and `canonicalOf` directly and says so where a reader looks for it.
2. **Call `view` with `inertHtml`.** Does not compile: the builder's Message type is `never`.

### The blocked-storage test

1. **Keep it, say plainly that it cannot fail today, and add a stand-in for a later SDK (chosen).** An integration that reads `sessionStorage` as it is set up is what a later version might do. With it, the test fails when the `try` in `initSentry` is removed.
2. **Only reword the comment (given as the fallback).** Not needed: the stand-in makes it bite.

### Making `reportMicrophoneProblem` throw

1. **Replace `captureException` on the SDK's current scope (chosen).** The real function runs and throws. The test first asserts that it does throw, so an SDK that stops calling the scope fails the test instead of emptying it.
2. **`vi.mock('./sentry')`.** Not chosen: it replaces the module for the whole file, and every other test there needs the real one.

## The design

- `src/scene.test.ts`: a positive assertion in each of the two "absent" tests; two click-through tests, one for the picker and one for the menu; the header's last bullet, which said these were not covered, goes.
- `src/story.test.ts`: the three `resolveAll` calls become `resolveAllExact` with only what is returned; one new test chooses a tuning with the list open.
- `src/microphone.test.ts`: the analyser failing after the context exists, a rejected `resume()`, a rejected `close()`.
- `src/sentry.test.ts`: the mark on the wire, for both kinds of report; `ReportProblem` with a report that throws; the blocked-storage test with its stand-in.
- `src/view.test.ts`: the Document `view` returns, for every route.
- `src/app.runtime.test.ts` (new): the real app in a real runtime. A link clicked through and back and forward; a link to another site; readings from a stand-in microphone; the microphone lost; the microphone closed on leaving the page.
- No file outside the tests changes, apart from comments that the new tests make false.

## Calls made for Kevin

Beyond the decisions given, each with what it costs if it is wrong.

- **The readings are tested through a runtime, and nothing was exported.** If it is wrong: the test is slower and less direct than a unit test of `measureInput` would be, about half a second of real time for the three tests that listen.
- **`routing` is copied into the runtime test, not shared with `src/entry.ts`.** Sharing it would mean moving two lines of the app into a module both import. If it is wrong: a mistake in those two lines of `entry.ts` that still compiles is caught only in a browser. Written into the backlog.
- **The blocked-storage test was made to bite with a stand-in integration,** in place of only rewording its comment. If it is wrong: one more test that says something about a version of the SDK that does not exist.
- **The title and canonical address got a table of their own in `src/view.test.ts`,** although the server entry's tests already covered them. If it is wrong: five renders that repeat a check, a few milliseconds.
- **A test for leaving the tuner's page while it listens was added to the runtime file.** Nobody asked for it. It is the one place the two halves of that file meet, and it is what the headless Chrome script reports as `tracks=["ended"]`.
- **The two older "tuning" stories were kept on a closed list and renamed,** and the open list got a story of its own, as the backlog asked.

## Left to the builder

Nothing: the builder wrote this. What stays open is in the backlog: a reading tick that finds no microphone, stack frames, and `src/entry.ts` with the takeover of a prerendered page.

## Changes during the build

- **The helper that broke a line and put it back damaged a file once.** It undid a break by replacing in reverse, and the replacement matched a comment higher up. The file was put right by hand and the helper now writes back the text it saved (`FINDINGS.md`, "Put a broken line back from a saved copy").
- **A recorded event does show the "no IP" mark after `flush`.** The first draft said `beforeSend` could never see it. The hook cannot when it runs; the object it was handed gains the mark later. The test reads the envelope, and its comment says why.
- **The first runtime test looked at the button too soon.** The stand-in was closed before the page had been drawn again. The check moved inside the wait.

## Checking it

- `bun run test`: 477 tests in 16 files, where `main` has 452 in 15. Three runs in a row, all passing. The run takes about 2.8 seconds where it took 2.3: the five runtime tests are 0.9 seconds of real time, run beside the other files.
- `bun run typecheck` and `bun run lint` pass.
- Every new or repaired test was seen to fail with the line it guards broken. The list is in the pull request.
- A build with a fixed build id (`FOLDKIT_BUILD_ID`) gives the same 13 files as the same build of `main`, by SHA-256: the script, the stylesheet and every page.
- The two browser checks against that build, served with the site's headers: `pages.ts` (the click-through, with the microphone closed on leaving) and `csp.ts` (no violation).
