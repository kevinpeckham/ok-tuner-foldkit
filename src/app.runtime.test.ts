// APP RUNTIME TESTS: the whole app, running
//
// This file starts the real app in a real Foldkit runtime: the `init`,
// `update`, managed resource and Subscription of `src/main.ts` and the
// `view` of `src/view.ts`, wired as `src/entry.ts` wires them. It covers
// what no pure test can reach, because each of these is the runtime's
// doing:
//
//   1. a click on a link becoming a new address and a new page, and the
//      browser's back and forward buttons doing the same;
//   2. the two navigation Commands, run and not only returned;
//   3. the microphone being opened and closed as the Model asks;
//   4. the readings Subscription: a reading every 50 ms while the tuner is
//      listening, and the microphone reported lost when its track has ended;
//   5. a crash while the tuner listens: the runtime releases nothing, and
//      the crash hook closes the microphone.
//
// WHY THE OTHER TESTS CANNOT
//
// A Story calls `update` and a Scene calls `update` and the view. Both stop
// at a Command and never run it, a Scene has no address bar and no document
// for the runtime to listen on, and neither has a managed resource or a
// Subscription: a test there sends by hand the Message the runtime would
// have sent (FINDINGS.md, "A Scene test cannot follow a link", "Story has
// no managed-resource steps; Scene does"). Those tests are still where the
// tuner's behaviour is pinned, one case at a time. This file shows that the
// parts are joined up.
//
// HOW IT IS DONE
//
// As in `src/crash.runtime.test.ts`, which was the first test here to start
// a runtime and explains the method: `Runtime.makeApplication` returns a
// program, `Effect.runFork(application.start())` runs it and gives back a
// Fiber, and each test ends by interrupting the Fiber. The page is
// happy-dom's simulated document (`vitest.config.ts`). It has a working
// `history` and `location`, which is what makes the click-through possible,
// and no microphone at all: `navigator.mediaDevices` and `AudioContext` do
// not exist in it. So the microphone is a stand-in, built like the ones in
// `src/microphone.test.ts`, and the "sound" is a 110 Hz sine written into
// the buffer the Subscription hands over.
//
// Time is real here. The runtime draws on animation frames and the
// Subscription ticks on the clock, so a test cannot look straight after a
// click. Each expectation that depends on the runtime is wrapped in
// `eventually`, which tries it again until it holds or two seconds have
// gone. Nothing waits for a fixed time except the two checks that
// something has stopped happening.
//
// WHAT THIS DOES NOT COVER
//
// - `src/entry.ts` itself. Importing it would start Sentry and the
//   analytics and call `Runtime.hydrate`. The `routing` option below is a
//   copy of the two lines there, and the compiler holds both to the same
//   type. The crash test's `crash` option is a copy too, with a function
//   that records in the place of `reportCrash`.
// - Taking over a prerendered page. The live site starts with
//   `Runtime.hydrate`, over HTML the build drew. This file starts with
//   `start()`, which draws into an empty container.
// - Anything a real browser adds: layout, scrolling to the top of a new
//   page, a real microphone and the permission prompt.
// Those are checked in headless Chrome against a build (FINDINGS.md,
// "Checking the real page in headless Chrome, with and without a
// microphone").
import { Effect, Fiber } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as Crash from './crash'
import {
  Message,
  Model,
  init,
  managedResources,
  subscriptions,
  update,
} from './main'
import { LOST, WINDOW, closeOpenMicrophones } from './microphone'
import { PAGE_HEADING_ID } from './route'
import { GITHUB_URL } from './site'
import { view } from './view'

// HARNESS

// The Fiber of the app a test started, kept so that `afterEach` can stop
// it. A test starts at most one.
let maybeFiber: Fiber.Fiber<void> | undefined

// Starts the app in a fresh container, as `src/entry.ts` does, with four
// differences. The app is started with `start()` and not hydrated. There is
// no `crash` option unless a test passes one, so a crash would show
// Foldkit's own screen, with the error on it, and fail the test that was
// waiting for something else. The DevTools are off. And `slow: false`
// silences the runtime's warnings about a slow render: the first drawing of
// the whole tuner takes longer in happy-dom than the budget of one frame,
// and the warning prints the Model.
//
// `crash` is for the one test that crashes the app on purpose.
// `Runtime.CrashConfig<Model, Message>` is Foldkit's type for the option:
// the two hooks, each optional.
const boot = (crash?: Runtime.CrashConfig<Model, Message>): void => {
  const container = document.createElement('div')
  // The runtime refuses a container with no id (`src/crash.runtime.test.ts`).
  container.id = 'app'
  document.body.appendChild(container)

  const application = Runtime.makeApplication({
    Model,
    init,
    update,
    view,
    managedResources,
    subscriptions,
    // The same two lines as in `src/entry.ts`.
    routing: {
      onUrlRequest: request => Message.ClickedLink({ request }),
      onUrlChange: url => Message.ChangedUrl({ url }),
    },
    container,
    // Spreading an object that is empty or holds the one key adds the
    // option only when a test gave it.
    ...(crash === undefined ? {} : { crash }),
    devTools: false,
    slow: false,
  })

  maybeFiber = Effect.runFork(application.start())
}

// Tries an expectation until it holds. `vi.waitFor` is Vitest's own: it
// calls the function again every `interval` milliseconds for as long as it
// throws, and after `timeout` fails the test with the last error, so a
// failure still says what was expected and what was found.
const eventually = (expectation: () => void): Promise<void> =>
  vi.waitFor(expectation, { timeout: 2000, interval: 10 })

// A pause of real time, for the two places that check that something has
// stopped: there is no event to wait for when nothing happens.
const pause = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

const bodyText = (): string => document.body.textContent ?? ''

// The page's one first-level heading, which names the page.
const headingText = (): string =>
  document.querySelector('h1')?.textContent ?? ''

const linkNamed = (name: string): HTMLAnchorElement => {
  const maybeLink = [...document.querySelectorAll('a')].find(
    candidate => candidate.textContent === name,
  )
  if (maybeLink === undefined) {
    throw new Error(`No link named "${name}". Page: ${bodyText()}`)
  }
  return maybeLink
}

// The On / Off button: the page's only toggle button, so the only element
// with `aria-pressed`.
const powerButton = (): HTMLElement => {
  const maybeButton = document.querySelector<HTMLElement>(
    'button[aria-pressed]',
  )
  if (maybeButton === null) {
    throw new Error(`No On / Off button. Page: ${bodyText()}`)
  }
  return maybeButton
}

// Clicks the way a browser does: an event that travels up to the document,
// where the runtime's listener for links is, and that can be cancelled.
// The event is returned so that a test can ask whether the runtime
// cancelled it, which is how the runtime says "this click is mine".
const click = (element: Element): MouseEvent => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  })
  element.dispatchEvent(event)
  return event
}

// Starts the app and waits until it is running. The page is first drawn
// with the On / Off button disabled (the tuner is `Booting`), and the
// button comes alive when the Command that `init` returned has read the
// saved preferences. So an enabled button also shows that the runtime runs
// Commands.
const start = async (
  crash?: Runtime.CrashConfig<Model, Message>,
): Promise<void> => {
  boot(crash)
  await eventually(() => {
    expect(powerButton().getAttribute('aria-disabled')).not.toBe('true')
  })
}

afterEach(async () => {
  if (maybeFiber !== undefined) {
    await Effect.runPromise(Fiber.interrupt(maybeFiber))
    maybeFiber = undefined
  }
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // `src/microphone.ts` keeps a note of the streams it has open, in the
  // module and not in the Model. Stopping the runtime released them all,
  // so this finds nothing. It is here so that a test which goes wrong
  // cannot leave a stream for the next one to find.
  closeOpenMicrophones()
  // The next test starts on the tuner's page again. `replaceState` moves
  // the address without telling the runtime, which is stopped by now.
  window.history.replaceState({}, '', '/')
})

// THE MICROPHONE'S STAND-IN

const SAMPLE_RATE = 48000

// One window of a 110 Hz sine: the note A2, the open A string of a guitar.
const A2_TONE = Float32Array.from(
  { length: WINDOW },
  (_, index) => 0.5 * Math.sin((2 * Math.PI * 110 * index) / SAMPLE_RATE),
)

// What a test can see and do to the stand-in.
//   track           the stream's one track. A test sets its `readyState` to
//                   'ended', which is what a browser does when the
//                   microphone is unplugged. Stopping the track ends it
//                   too, as in a browser.
//   getUserMedia    counts how often the microphone was asked for.
//   read            counts the readings taken: each is one call of the
//                   analyser's `getFloatTimeDomainData`.
//   stop, close     count the two halves of closing the microphone.
type StandIn = Readonly<{
  track: { readyState: string }
  getUserMedia: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}>

// Gives the page a microphone that always opens and always hears A2. The
// two globals are the browser's two entry points, replaced as in
// `src/microphone.test.ts`. Everything between them and the page is real:
// `acquireMicrophone`, the managed resource, the Subscription, pitch
// detection, `update` and the view.
const installMicrophone = (): StandIn => {
  // `stop` names `track` before the line that declares it. That is sound:
  // the function is not called until a test is running.
  const stop = vi.fn(() => {
    track.readyState = 'ended'
  })
  const track = { readyState: 'live', stop }
  const getUserMedia = vi.fn(() =>
    Promise.resolve({ getTracks: () => [track] }),
  )
  const read = vi.fn((buffer: Float32Array) => {
    buffer.set(A2_TONE)
  })
  const close = vi.fn(() => Promise.resolve())

  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      sampleRate = SAMPLE_RATE
      close = close
      createAnalyser = () => ({ getFloatTimeDomainData: read })
      createMediaStreamSource = () => ({ connect: vi.fn() })
    },
  )

  return { track, getUserMedia, read, stop, close }
}

// Switches the tuner on and waits until it has named the note.
const listen = async (): Promise<void> => {
  click(powerButton())
  await eventually(() => {
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'A2',
    )
  })
}

// Routing, end to end. `update`'s two halves are pinned in
// `src/story.test.ts` ('routing'): ClickedLink returns a navigation Command,
// and ChangedUrl sets the route. Here the runtime joins them: it turns the
// click into ClickedLink, runs the Command, sees the address move, and
// sends ChangedUrl.
describe('pages, clicked through', () => {
  test('a link changes the address and the page, and back and forward follow', async () => {
    await start()
    expect(window.location.pathname).toBe('/')
    expect(headingText()).toBe('Tuner')
    expect(document.title).toBe('OK Tuner | Chromatic Instrument Tuner')

    // The click. The runtime cancels it, so the browser loads nothing, and
    // the NavigateInternal Command moves the address with `pushState`.
    const clicked = click(linkNamed('How to use the tuner'))

    expect(clicked.defaultPrevented).toBe(true)
    await eventually(() => {
      expect(headingText()).toBe('How to use the tuner')
    })
    expect(window.location.pathname).toBe('/how-to')
    expect(document.title).toBe('How to use the tuner | OK Tuner')
    expect(document.querySelector('button[aria-pressed]')).toBeNull()
    // The FocusPageHeading Command ran too: focus is on the new page's
    // heading, which is what makes a screen reader announce the page.
    await eventually(() => {
      expect(document.activeElement?.id).toBe(PAGE_HEADING_ID)
    })

    // The back button. Nothing in the page is clicked: the browser moves
    // the address and fires `popstate`, and the runtime sends ChangedUrl.
    window.history.back()

    await eventually(() => {
      expect(headingText()).toBe('Tuner')
    })
    expect(window.location.pathname).toBe('/')
    expect(document.title).toBe('OK Tuner | Chromatic Instrument Tuner')

    // And forward again.
    window.history.forward()

    await eventually(() => {
      expect(headingText()).toBe('How to use the tuner')
    })
    expect(window.location.pathname).toBe('/how-to')

    // The page's own way back is a link like any other.
    click(linkNamed('Back to the tuner'))

    await eventually(() => {
      expect(headingText()).toBe('Tuner')
    })
    expect(window.location.pathname).toBe('/')
  })

  // A link to another site is the same element with a full address. The
  // runtime cancels that click as well and reports it as an external
  // request, and it is the LoadExternal Command that then loads the address
  // with `window.location.assign`. Without the Command the link would do
  // nothing. `assign` is replaced so that happy-dom does not go looking for
  // the address. The footer's GitHub link is such a link.
  test('a link to another site is loaded by the browser, at the app’s request', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined)
    await start()

    const clicked = click(linkNamed('GitHub'))

    expect(clicked.defaultPrevented).toBe(true)
    await eventually(() => {
      expect(assign).toHaveBeenCalledTimes(1)
    })
    expect(assign).toHaveBeenCalledWith(GITHUB_URL)
    // The app itself has not moved.
    expect(window.location.pathname).toBe('/')
    expect(headingText()).toBe('Tuner')
  })
})

// The managed resource and the Subscription, run by the runtime. Nothing
// in these tests sends a Message about the microphone: the runtime opens
// the stand-in because the Model says Starting, starts the readings because
// it says Listening, and closes it when the Model stops asking.
describe('the microphone and its readings', () => {
  test('switching on opens the microphone and reads it until it is switched off', async () => {
    const microphone = installMicrophone()
    await start()
    // Off: nothing has asked for the microphone, and nothing reads one.
    expect(microphone.getUserMedia).not.toHaveBeenCalled()

    await listen()

    expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
    expect(powerButton().getAttribute('aria-pressed')).toBe('true')
    expect(bodyText()).toContain('110.0 Hz')
    // The readings keep coming: this is a stream, not one reading.
    await eventually(() => {
      expect(microphone.read.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    click(powerButton())

    // Off again: the page says so, and the runtime closes the microphone,
    // both halves of it.
    await eventually(() => {
      expect(powerButton().getAttribute('aria-pressed')).toBe('false')
      expect(microphone.stop).toHaveBeenCalledTimes(1)
      expect(microphone.close).toHaveBeenCalledTimes(1)
    })
    // And the readings have stopped. Three ticks' worth of time passes
    // with no reading taken.
    const readingsWhenClosed = microphone.read.mock.calls.length
    await pause(150)
    expect(microphone.read.mock.calls.length).toBe(readingsWhenClosed)
  })

  // The microphone is unplugged while the tuner listens. A browser marks
  // the track ended and says nothing else: the analyser would go on
  // answering, with silence. The Subscription asks before each reading
  // (`hasEnded`), sends LostMicrophone in place of a reading, and `update`
  // moves the tuner to Failed, which closes what is left of the microphone.
  test('a microphone whose track has ended is reported lost, and is not read again', async () => {
    const microphone = installMicrophone()
    await start()
    await listen()

    microphone.track.readyState = 'ended'
    const readingsWhenLost = microphone.read.mock.calls.length

    await eventually(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(LOST)
    })
    expect(powerButton().getAttribute('aria-pressed')).toBe('false')
    await eventually(() => {
      expect(microphone.stop).toHaveBeenCalledTimes(1)
      expect(microphone.close).toHaveBeenCalledTimes(1)
    })
    // Not one reading was taken from the ended microphone, then or after.
    await pause(150)
    expect(microphone.read.mock.calls.length).toBe(readingsWhenLost)
  })

  // The two halves of this file together. Leaving the tuner's page
  // switches the tuner off (`enterRoute` in `src/main.ts`), and off is
  // what closes the microphone: none is left open on a page with no tuner.
  test('leaving the tuner’s page while it listens closes the microphone', async () => {
    const microphone = installMicrophone()
    await start()
    await listen()

    click(linkNamed('How to use the tuner'))

    await eventually(() => {
      expect(headingText()).toBe('How to use the tuner')
    })
    await eventually(() => {
      expect(microphone.stop).toHaveBeenCalledTimes(1)
      expect(microphone.close).toHaveBeenCalledTimes(1)
    })

    // Coming back finds the tuner switched off, not listening again.
    window.history.back()

    await eventually(() => {
      expect(headingText()).toBe('Tuner')
    })
    expect(powerButton().getAttribute('aria-pressed')).toBe('false')
    expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

// A crash while the tuner is listening. The runtime stops handling
// Messages and releases nothing: the managed resource is released when the
// Model stops asking for the microphone, and the Model never changes again.
// Left at that, the stream's track stays live and the browser goes on
// showing its microphone indicator under a screen that says the tuner has
// stopped. So the crash hook closes it (`Crash.reportThenClose` and
// `closeOpenMicrophones`, wired in `src/entry.ts`; FINDINGS.md, "A crash
// releases nothing, so the app closes the microphone itself").
//
// The crash is made the way the browser check makes it: the next reading
// throws inside the readings Subscription. The `crash` option is a copy of
// the one in `src/entry.ts`, with a function that records in the place of
// `reportCrash`, so nothing is sent anywhere.
describe('a crash while the tuner listens', () => {
  const CRASH_HEADING = 'The tuner has stopped'

  const crashTheNextReading = (microphone: StandIn): void => {
    microphone.read.mockImplementation(() => {
      throw new Error('thrown on purpose by the app runtime test')
    })
  }

  test('the crash hook stops the microphone’s track', async () => {
    // The runtime logs the crash with `console.error`. It is expected
    // here, so it is kept out of the test's output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const microphone = installMicrophone()
    const report = vi.fn()
    await start({
      view: Crash.view,
      report: Crash.reportThenClose(report, closeOpenMicrophones),
    })
    await listen()
    expect(microphone.track.readyState).toBe('live')

    crashTheNextReading(microphone)

    await eventually(() => {
      expect(bodyText()).toContain(CRASH_HEADING)
    })
    expect(report).toHaveBeenCalledTimes(1)
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    expect(microphone.track.readyState).toBe('ended')
  })

  // The control: the same crash with a hook that only reports. This is how
  // the app was wired until 0.7.2, and it shows what the test above is
  // for. The crashed runtime closes neither half of the microphone.
  test('without the closing, the crashed runtime leaves the track live', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const microphone = installMicrophone()
    await start({ view: Crash.view, report: vi.fn() })
    await listen()

    crashTheNextReading(microphone)

    await eventually(() => {
      expect(bodyText()).toContain(CRASH_HEADING)
    })
    // Long enough for a release to have happened, had there been one.
    await pause(150)
    expect(microphone.stop).not.toHaveBeenCalled()
    expect(microphone.close).not.toHaveBeenCalled()
    expect(microphone.track.readyState).toBe('live')
  })
})
