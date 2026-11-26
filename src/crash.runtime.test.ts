// CRASH RUNTIME TESTS: the crash screen inside a real, crashed runtime
//
// This file exercises `view` in `src/crash.ts` the way `src/entry.ts` uses
// it: as the `crash.view` of a Foldkit application that then crashes.
//
// WHY THIS FILE STARTS A RUNTIME
//
// Nearly every test here calls pure functions. A Story calls `update`, a
// Scene calls `update` and the view, and neither needs the Foldkit runtime.
// (The one other file that starts a runtime is `src/app.runtime.test.ts`,
// which runs the real app.) The crash screen rests on three things only a
// runtime can show:
//
//   1. the report is made once, and before the screen is drawn;
//   2. the screen takes the place of whatever the app had drawn;
//   3. the links on it still work, although the runtime that would have
//      handled a click is dead;
//   4. the microphone is closed by the same hook that reports, after the
//      report, whichever of the two throws (`reportThenClose`).
//
// The third is the reason for most of `src/crash.ts`, and it is about what
// the runtime does to a click, so nothing short of a runtime can test it.
//
// HOW IT IS DONE
//
// `Runtime.makeApplication` returns a program whose `start()` is an Effect.
// `src/entry.ts` hands the program to `Runtime.hydrate`, which starts it for
// the life of the page. Here the Effect is run with `Effect.runFork`, which
// gives back a Fiber, the handle of a running Effect, and each test ends by
// interrupting that Fiber, which stops the runtime and removes what it drew.
// Foldkit tests its own crash screen the same way
// (`repos/foldkit/packages/foldkit/src/test/apps/crashOnRender.test.ts`).
//
// The page is happy-dom's simulated document (`vitest.config.ts`), so there
// is no layout and no real navigation. The runtime draws on animation
// frames, which is why the tests wait for text to appear and do not look
// straight after a click.
//
// THE APP UNDER TEST
//
// Not the tuner. A crash is made by an `update` that throws, and the
// tuner's `update` does not throw on request. So the app here is the
// smallest one that can crash and has routing: one button, one link, and an
// `update` that throws for the button. The crash view and the report hook
// are wired as in `src/entry.ts`. The real page, with the real tuner, is
// crashed in headless Chrome outside this suite (FINDINGS.md, "A plain link
// does nothing after a crash").
import { Effect, Fiber, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { type Document, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { afterEach, describe, expect, test } from 'vitest'

import * as Crash from './crash'

// THE APP

// The Model holds nothing: `null` is a Schema like any other.
const Model = Schema.Null
type Model = typeof Model.Type

// `ClickedCrash` is the button. The other two are what routing needs: a
// Message for a link that was clicked and one for an address that changed.
const Message = defineMessageUnion({
  ClickedCrash: {},
  ClickedLink: {},
  ChangedUrl: {},
})
type Message = typeof Message.Type

// What the thrown error says. The crash screen must not show it.
const ERROR_TEXT = 'thrown on purpose by the crash runtime test'

// An `update` that throws is a crash: the runtime catches the error, stops,
// reports and draws the crash view. A real `update` never throws on purpose.
const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedCrash: () => {
      throw new Error(ERROR_TEXT)
    },
    ClickedLink: () => ({ model }),
    ChangedUrl: () => ({ model }),
  })

const APP_BUTTON = 'Crash the app'
const APP_LINK_ID = 'app-link'

const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'A small app',
  body: h.div(
    [],
    [
      h.button([h.OnClick(Message.ClickedCrash())], [APP_BUTTON]),
      h.a([h.Id(APP_LINK_ID), h.Href('/elsewhere')], ['A plain link']),
    ],
  ),
})

// HARNESS

// What the report hook saw, in order: each entry is the error's message and
// whether the crash screen was already in the page when the hook ran.
type Report = Readonly<{ errorText: string; wasScreenDrawn: boolean }>

const HEADING = 'The tuner has stopped'

const bodyText = (): string => document.body.textContent ?? ''

type Running = Readonly<{ fiber: Fiber.Fiber<void>; reports: Array<Report> }>

// The shape of a report hook, as this file's small app needs it: it is
// handed the crash and returns nothing.
type ReportHook = (context: Readonly<{ error: Error }>) => void

let maybeRunning: Running | undefined

// Starts the app in a fresh container, wired as `src/entry.ts` wires the
// tuner: routing on, our crash view, and a report hook. The hook here
// records instead of calling Sentry.
//
// `wrap` is for the tests of `reportThenClose` at the end of the file. It
// is given the recording hook and returns the hook the runtime gets, so a
// test can put `Crash.reportThenClose` round it as `src/entry.ts` does
// round `reportCrash`. Left out, the runtime gets the recording hook
// itself.
const boot = (
  wrap: (report: ReportHook) => ReportHook = report => report,
): Running => {
  const container = document.createElement('div')
  // The runtime refuses a container with no id: in development it files the
  // Model it saves across a reload under that id.
  container.id = 'app'
  document.body.appendChild(container)
  const reports: Array<Report> = []

  const application = Runtime.makeApplication({
    Model,
    init: () => ({ model: null }),
    update,
    view,
    container,
    // With routing, the runtime listens for clicks on links across the
    // whole document. That listener is what this file is about.
    routing: {
      onUrlRequest: () => Message.ClickedLink(),
      onUrlChange: () => Message.ChangedUrl(),
    },
    crash: {
      view: Crash.view,
      report: wrap(({ error }) => {
        reports.push({
          errorText: error.message,
          wasScreenDrawn: bodyText().includes(HEADING),
        })
      }),
    },
    devTools: false,
  })

  const running = { fiber: Effect.runFork(application.start()), reports }
  maybeRunning = running
  return running
}

// The runtime draws on an animation frame, so text appears a little after
// the click that caused it. This waits for it, and fails with the page's
// text if it never comes.
const waitForBodyText = async (wanted: string): Promise<void> => {
  const startedAt = Date.now()
  while (!bodyText().includes(wanted)) {
    if (Date.now() - startedAt > 2000) {
      throw new Error(`Timed out waiting for "${wanted}". Page: ${bodyText()}`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const crash = async (
  wrap?: (report: ReportHook) => ReportHook,
): Promise<Running> => {
  const running = boot(wrap)
  await waitForBodyText(APP_BUTTON)
  document.querySelector('button')?.click()
  await waitForBodyText(HEADING)
  return running
}

// Clicks a link the way a browser does, and says whether anything
// cancelled the click.
//
// A click on a link is an event that travels up from the link to the
// document and then to the window. Any listener on the way may call
// `preventDefault()`, which tells the browser not to follow the link. The
// runtime's listener is on the document. The listener added here is on the
// window, so it runs after the runtime's and sees what the runtime decided.
// It then cancels the click itself, so that happy-dom does not try to load
// the address.
const isClickCancelled = (link: Element): boolean => {
  const seen: Array<boolean> = []
  const observe = (event: Event): void => {
    seen.push(event.defaultPrevented)
    event.preventDefault()
  }
  window.addEventListener('click', observe)
  link.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
  )
  window.removeEventListener('click', observe)

  const [wasCancelled] = seen
  if (wasCancelled === undefined) {
    throw new Error('The click never reached the window.')
  }
  return wasCancelled
}

const linkNamed = (name: string): Element => {
  const maybeLink = [...document.querySelectorAll('a')].find(
    candidate => candidate.textContent === name,
  )
  if (maybeLink === undefined) {
    throw new Error(`No link named "${name}". Page: ${bodyText()}`)
  }
  return maybeLink
}

afterEach(async () => {
  if (maybeRunning !== undefined) {
    await Effect.runPromise(Fiber.interrupt(maybeRunning.fiber))
    maybeRunning = undefined
  }
  document.body.replaceChildren()
})

describe('a crashed runtime with our crash view', () => {
  test('draws the crash screen in place of the app', async () => {
    await crash()

    expect(bodyText()).toContain(HEADING)
    expect(bodyText()).not.toContain(APP_BUTTON)
    expect(document.getElementById(APP_LINK_ID)).toBeNull()
    expect(document.title).toBe(Crash.CRASH_TITLE)
  })

  // If the crash view itself threw, Foldkit would draw its default screen,
  // which starts "Application Crash" and prints the error.
  test('draws our screen and not the default one', async () => {
    await crash()

    expect(bodyText()).not.toContain('Application Crash')
    expect(bodyText()).not.toContain(ERROR_TEXT)
  })

  // `src/entry.ts` keeps a `report` hook beside the `view`. Having a view
  // must not cost the report, or move it after the drawing.
  test('reports once, before the screen is drawn', async () => {
    const { reports } = await crash()

    expect(reports).toEqual([{ errorText: ERROR_TEXT, wasScreenDrawn: false }])
  })

  // The control for the next test: while the app is alive, the runtime
  // cancels a click on a plain link, because it is going to handle the
  // click itself with a Message.
  test('before the crash, the runtime takes a plain link for itself', async () => {
    boot()
    await waitForBodyText(APP_BUTTON)

    expect(isClickCancelled(linkNamed('A plain link'))).toBe(true)
  })

  // And it still cancels it after the crash, when no Message will ever be
  // handled. This is why a plain link on the crash screen would be dead.
  test('after the crash, a plain link is still cancelled, and so is dead', async () => {
    await crash()
    const plain = document.createElement('a')
    plain.href = '/elsewhere'
    plain.textContent = 'Added by the test'
    document.body.appendChild(plain)

    expect(isClickCancelled(plain)).toBe(true)
  })

  // The crash screen's own links carry `target="_top"`, which the runtime's
  // listener leaves to the browser.
  test.each(['OK Tuner', 'Reload the page', 'tell us about it on GitHub'])(
    'after the crash, the link "%s" is left to the browser',
    async name => {
      await crash()

      expect(isClickCancelled(linkNamed(name))).toBe(false)
    },
  )
})

// `reportThenClose` builds the `crash.report` hook of `src/entry.ts`: it
// reports the crash, then closes the microphone, which a crashed runtime
// would otherwise leave open (FINDINGS.md, "A crash releases nothing, so
// the app closes the microphone itself"). Three promises are pinned here,
// in a runtime that really crashes:
//
//   - the report comes first, and the closing comes before the screen;
//   - a report that throws does not cost the closing;
//   - a closing that throws does not cost the report, which has already
//     been made, nor the screen.
//
// The closing here is a function that records. That the real one,
// `closeOpenMicrophones`, stops the stream of the real app is shown in
// `src/app.runtime.test.ts`.
//
// When the hook throws, the runtime catches it and logs "[foldkit]
// crash.report failed" (`renderCrashView` in
// `repos/foldkit/packages/foldkit/src/runtime/crashUI.ts`), then draws the
// crash view as usual. So a throw shows in the test's output and nowhere on
// the page.
describe('the crash hook that reports and then closes the microphone', () => {
  test('reports, then closes, both before the screen is drawn', async () => {
    const order: Array<string> = []
    const { reports } = await crash(report =>
      Crash.reportThenClose(
        context => {
          report(context)
          order.push('reported')
        },
        () => {
          order.push(
            bodyText().includes(HEADING)
              ? 'closed after the screen'
              : 'closed before the screen',
          )
        },
      ),
    )

    expect(order).toEqual(['reported', 'closed before the screen'])
    expect(reports).toEqual([{ errorText: ERROR_TEXT, wasScreenDrawn: false }])
  })

  test('a report that throws still closes the microphone, and the screen is drawn', async () => {
    const closed: Array<string> = []
    await crash(() =>
      Crash.reportThenClose(
        () => {
          throw new Error('the report failed')
        },
        () => {
          closed.push('closed')
        },
      ),
    )

    expect(closed).toEqual(['closed'])
    expect(bodyText()).toContain(HEADING)
    expect(bodyText()).not.toContain('Application Crash')
  })

  test('a closing that throws comes after the report, and the screen is drawn', async () => {
    const { reports } = await crash(report =>
      Crash.reportThenClose(report, () => {
        throw new Error('the closing failed')
      }),
    )

    expect(reports).toEqual([{ errorText: ERROR_TEXT, wasScreenDrawn: false }])
    expect(bodyText()).toContain(HEADING)
    expect(bodyText()).not.toContain('Application Crash')
  })
})
