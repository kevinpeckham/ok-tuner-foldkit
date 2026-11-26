// SCENE TESTS: the page, as a person uses it
//
// A Scene test runs `update` and `view` together. It starts from a Model,
// draws the page, and then does what a person would do: click a button, type
// in a field. Whatever Message the page sends goes through `update`, the page
// is drawn again from the new Model, and the test checks what is now on it.
// Where `story.test.ts` shows that `update` gets the state right, this file
// shows that a person can reach that state through the page and is shown the
// right thing when they do.
//
// This file exercises `view` in `src/view.ts` together with `update` and
// `managedResources` in `src/main.ts`.
//
// WHAT "THE PAGE" IS HERE
//
// There is no browser. `view(model, h)` returns a tree of virtual nodes
// (VNodes): plain objects that describe elements, their attributes and their
// event handlers. Scene keeps that tree and works on it directly. A locator
// searches the tree, `click` calls the click handler stored on a node, and an
// assertion reads a node's text or attributes. So a Scene test sees what the
// view asked for, not what a browser made of it. Nothing here knows about
// CSS, layout, keyboard focus or which element is drawn on top.
//
// HOW A SCENE READS
//
//   scene({ update, view }, given(model), click(...), expect(...).toExist())
//
// `scene` takes the app's `update` and `view` and then any number of steps,
// and runs the steps in the order written. After every step it calls `view`
// again with the current Model, so the next step always sees the page as it
// now stands. As with `story`, `scene` returns nothing, and a step that is
// not satisfied throws, which fails the Vitest test around it.
//
//   given(model)          Sets the Model to start from.
//   click, type           Interactions. Find an element and call its event
//                         handler. The Message the handler sends goes
//                         through `update`.
//   expect(locator)...    An assertion about one element of the current page.
//   expectAll(many)...    An assertion about how many elements match.
//   Command.*             The same steps as in a story, for the Commands
//                         that `update` returns.
//   ManagedResource.*     Play the runtime's part in the life of the
//                         microphone: it opened, it failed to open, it closed.
//   Mount.resolve         Supplies the result of a Mount: work that an
//                         element of the page starts when it appears.
//
// Each step is explained in full where it first appears below.
//
// TWO DIFFERENT `expect`S
//
// The `expect` in this file is Scene's, imported from `foldkit/scene`. It
// checks nothing at the moment it is called. It builds a step, and the check
// runs when the scene reaches that step. That is why Vitest's own `expect`
// is not imported here.
//
// RULES SCENE ENFORCES (the ones these tests meet)
//
// 1. As in a story, a Command is only data: its Effect never runs, and every
//    Command that `update` returns must be resolved before the scene ends.
// 2. Mounts are held to the same rule: every Mount in the drawn page must be
//    given its result (see `acknowledgeSettingsMenu` near the end). And a
//    Mount whose element then leaves the page must be acknowledged with
//    `Mount.expectEnded` (see OPENING BY A CLICK, at the end).
// 3. A step that sends a Message (an interaction or a ManagedResource step)
//    throws if a Command or a Mount from an earlier step is still unresolved.
// 4. An interaction refuses what a browser would refuse. `click` throws if
//    the element is not on the page, is disabled, or has no click handler.
//
// WHAT A SCENE CANNOT SEE
//
// - The Model. A scene asserts through the page and has no step for looking
//   at the Model. Checks on the Model belong in `story.test.ts`.
// - Anything a real browser adds. The open tuning list was once drawn behind
//   the tuner, and it took a screenshot to see it (FINDINGS.md, "An open list
//   or menu hides behind the tuner body without a z-index").
// - A real microphone and real sound. Opening and closing the microphone is
//   tested in `microphone.test.ts` and finding a pitch in `pitch.test.ts`,
//   and `app.runtime.test.ts` has a runtime do both with a stand-in. The
//   real page, with and without a microphone, is checked outside this
//   suite, in headless Chrome (FINDINGS.md, "Checking the real page in
//   headless Chrome, with and without a microphone").
// - Where an open list or menu lands, and where the keyboard focus goes.
//   The last two scenes open the picker and the menu by clicking and use
//   them. Placing the panel and moving the focus are a Mount's and a
//   Command's work, which a scene resolves and does not run.

import { Option } from 'effect'
// The Scene steps and locators. Several of these names mean something else
// in other files:
// - `expect` is Scene's, not Vitest's (see the header).
// - `Command` is Scene's group of steps for pending Commands, as in
//   `story.test.ts`. It is not the `Command` module that defines Commands.
// - `ManagedResource` and `Mount` are likewise groups of Scene steps, not the
//   `foldkit` modules of the same names that `main.ts` and the UI components
//   use to define a managed resource or a Mount.
// `foldkit/scene` and `foldkit/story` share names such as `given` and
// `Command`, which is why a test file takes its steps from one of the two
// and not both (FOLDKIT.md, "Testing").
import {
  Command,
  ManagedResource,
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  nth,
  role,
  scene,
  selector,
  text,
  title,
  type,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import { describe, test } from 'vitest'

import { Listbox, Popover } from '@foldkit/ui'

import {
  Message,
  type Model,
  ReportProblem,
  SavePreferences,
  TunerState,
  WaitBeforeSlowStartHint,
  init,
  managedResources,
  update,
} from './main'
import { REFUSED } from './microphone'
import { DEFAULT_PREFERENCES } from './preferences'
import { AppRoute, PAGE_HEADING_ID } from './route'
import {
  GITHUB_URL,
  LICENSE_URL,
  LIGHTNING_JAR_URL,
  STEM_SHOVEL_URL,
  VERSION,
} from './site'
import { TUNINGS } from './tuning'
import { view } from './view'

// FIXTURES
//
// Models to start a scene from, built from the real `init` as in
// `story.test.ts`. `Option` is Effect's type for a value that may be
// missing: `Option.some(value)` or `Option.none()`.

// `init` takes the address the app is opened at, because the app has
// routing. `fromString` returns an Option, since a string may
// not be an address at all. This one is.
const urlOf = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Not an address: ${raw}`),
  )

// The very first Model: the page is drawn, and the app is not running yet.
const firstModel: Model = init(urlOf('http://localhost/')).model

// The Model once the saved preferences have been read, which is when the
// app counts as running and the On / Off button works. Every other fixture
// starts from here. See the same pair in story.test.ts.
const offModel: Model = update(
  firstModel,
  Message.CompletedLoadPreferences({ preferences: DEFAULT_PREFERENCES }),
).model

// The fields of the `Listening` state, each optional, without its `_tag`.
type ListeningFields = Partial<Omit<typeof TunerState.Listening.Type, '_tag'>>

// A Model that is listening and has heard nothing yet, unless fields are
// passed to say otherwise. `modifyFields` returns a copy of the Model with
// the named field replaced.
const listening = (fields: ListeningFields = {}): Model =>
  modifyFields(offModel, {
    tuner: () =>
      TunerState.Listening({
        level: 0,
        maybeReading: Option.none(),
        needleCents: 0,
        quietTicks: 0,
        ...fields,
      }),
  })

// A Model that is listening with a note on the screen. The needle is given
// separately from the frequency on purpose. The page draws the needle the
// Model holds (the smoothed one that `update` maintains) and does not work
// it out again from the frequency, so a test can put the needle wherever it
// wants: `hearing(440, 12)` is a perfect A4 shown 12 cents sharp.
const hearing = (frequency: number, needleCents: number): Model =>
  listening({
    level: 0.5,
    maybeReading: Option.some({ frequency, clarity: 0.95 }),
    needleCents,
  })

// The On / Off button has been pressed and the microphone has not opened
// yet. The Model is taken from a real call to `update`, like `offModel`.
// The timer Command that the same call returned is left behind, so a scene
// that begins here begins with nothing pending.
const startingModel: Model = update(offModel, Message.ClickedPower()).model

// THE START TIMER
//
// A press that starts the tuner returns a Command, WaitBeforeSlowStartHint:
// a timer of 1.2 seconds. If the tuner is still starting when it reports,
// the page says what it is waiting for (see "waiting for the microphone"
// below). No timer runs in a test. The Command is pending until the scene
// says how it ended, and rule 3 in the header means that has to be said
// before the microphone can open or fail. There are two things to say.
//
// `timerReports`: the 1.2 seconds are up, and this is the first start of
// the visit, attempt 1.
const timerReports = Command.resolve(
  WaitBeforeSlowStartHint,
  Message.CompletedWaitBeforeSlowStartHint({ attempt: 1 }),
)

// `timerSetAside`: the scene is about a start the microphone answers
// quickly, before the timer. The timer's Message carries the number of the
// attempt it belongs to, and `update` ignores a number that is not the
// current attempt's, so resolving the Command with a number no attempt has
// takes it off the pending list and changes nothing. `story.test.ts` says
// more about this, and shows that a timer which reports after the
// microphone has answered changes nothing either.
const timerSetAside = Command.resolve(
  WaitBeforeSlowStartHint,
  Message.CompletedWaitBeforeSlowStartHint({ attempt: -1 }),
)

// A copy of a Model on another tuning.
const withTuning = (model: Model, tuningId: string): Model =>
  modifyFields(model, { tuningId: () => tuningId })

// LOCATORS
//
// A locator says how to find an element. It is not the element. Each step
// that uses one searches the page as drawn at that step, so these can
// be made once, here, and used in every test and after every redraw.
// Foldkit's locators favour what a person or a screen reader goes by (role,
// name, label, visible text) over CSS, so a test that finds its button has
// also shown that the button is labelled.

// `role(role, { name })` finds an element by its ARIA role and its
// accessible name. The role can be written on the element (`role="alert"`)
// or implied by the tag (a `<button>` is a button, an `<h1>` a heading). The
// name is what a screen reader would call the element: its `aria-label`, an
// associated `<label>` or, failing those, its own text. A string must match
// the whole name.
const powerButton = role('button', { name: 'On / Off' })
// `selector(css)` finds the first element that matches a CSS selector. It is
// the fallback for an element with no role, label or text to go by. Only a
// small part of CSS is understood: a tag, `#id`, `.class`, `[attr]`,
// `[attr="value"]`, `[attr^="prefix"]`, `:not(...)` and a space for
// "somewhere inside". Anything else throws. The needle is decoration, so the
// view gives it a `data-needle-marker` attribute for this to find.
const needleMarker = selector('[data-needle-marker]')
// The string chip that the view marks as nearest to the note being played.
const litString = selector('[aria-current="true"]')
// `all.selector(css)` finds every match, not only the first. Its result goes
// to `expectAll(...)` to be counted, or to `nth(...)` to pick one out.
//
// The selector is scoped to the list labelled "Strings" on purpose. The
// how-to text was on this page when the test was written. It is a list too,
// and a bare `li` counted ten strings where there are six (FINDINGS.md, "Scope a locator to the part of
// the page it is about").
const strings = all.selector('[aria-label="Strings"] li')
// The place under the On / Off button where the page says what it is
// waiting for. `role="status"` is a polite live region: a screen reader
// reads out what appears in it, once it has finished what it was saying.
const statusRegion = role('status')
// The whole of the line, as the page words it.
const WAITING_LINE =
  'Waiting for the microphone. If your browser is asking for permission, allow it.'

// The page as the build draws it and as a browser first shows it, before
// the script has run. The On / Off button is there and says what it is, but
// it is disabled: a press could not do anything yet. `toBeDisabled` passes
// for `aria-disabled="true"`, which is how Foldkit's Button marks itself.
describe('before the app is running', () => {
  const powerButton = role('button', { name: 'On / Off' })

  test('the power button is drawn disabled', () => {
    scene(
      { update, view },
      given(firstModel),
      expect(powerButton).toBeDisabled(),
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
    )
  })

  test('the power button works once the app is running', () => {
    scene({ update, view }, given(offModel), expect(powerButton).toBeEnabled())
  })
})

// Turning the tuner on and off with the On / Off button, and what the page
// says when the microphone cannot be opened.
describe('power', () => {
  // The first scene, taken one step at a time. It is the page as a person
  // first meets it.
  test('off: the button is not pressed, there is no note and no alert', () => {
    scene(
      // The pair under test. Scene calls `view` to draw the page, and
      // `update` each time the page sends a Message.
      { update, view },
      // Start from the off Model. From here on the page is redrawn after
      // every step.
      given(offModel),
      // `expect(locator)` followed by a matcher makes one assertion step.
      // `toExist` passes when the locator finds an element.
      expect(role('heading', { name: 'Tuner' })).toExist(),
      // `toHaveAttr(name, value)` passes when the element has that attribute
      // with exactly that value. `aria-pressed="false"` is how a toggle
      // button tells a screen reader that it is off.
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      // `toBeEnabled` and `toBeDisabled` go by the `disabled` attribute or
      // `aria-disabled="true"`. Like every matcher except the two about
      // existence, they fail if the locator finds nothing at all.
      expect(powerButton).toBeEnabled(),
      // `toBeAbsent` is the opposite of `toExist`: it passes when the
      // locator finds nothing. While off there is no needle and no alert.
      expect(needleMarker).toBeAbsent(),
      expect(role('alert')).toBeAbsent(),
    )
  })

  // Turning on, as a person sees it: press, wait while the browser asks for
  // the microphone, then on.
  test('pressing the button shows Starting…, and acquiring the microphone turns it on', () => {
    scene(
      { update, view },
      given(offModel),
      // `click(locator)` finds the element and calls its click handler (and
      // those of its ancestors, the way a click bubbles). The handler sends
      // `ClickedPower`, Scene passes it to `update`, and the page is drawn
      // again from the `Starting` Model that comes back.
      click(powerButton),
      // `text(string)` finds an element by the text it shows.
      expect(text('Starting…')).toExist(),
      // The button's label has changed, so `powerButton`, which looks for
      // the name "On / Off", would find nothing now. A locator with the new
      // name finds the same button. It is disabled and marked busy, so a
      // second press cannot land while the microphone is being opened.
      expect(role('button', { name: 'Starting…' })).toBeDisabled(),
      expect(role('button', { name: 'Starting…' })).toHaveAttr(
        'aria-busy',
        'true',
      ),
      // The press also returned the timer Command. In this scene the
      // microphone opens before the 1.2 seconds are up, as it does when
      // permission was given on an earlier visit (THE START TIMER, among
      // the fixtures).
      timerSetAside,
      // Nothing opens a microphone in a test. The `ManagedResource` steps
      // play the runtime's part instead, and each takes the app's own entry
      // for the resource. `ManagedResource.acquire(entry)` says "the
      // microphone opened": it sends the entry's `onAcquired` Message,
      // `SucceededAcquireMicrophone`, through `update`.
      //
      // First it asks the entry's `modelToMaybeRequirements` whether the
      // Model wants the microphone, and throws if it does not. So this step
      // also shows that pressing the button made the Model ask for it.
      ManagedResource.acquire(managedResources.microphone),
      // On: pressed, enabled again, and labelled "On / Off" again.
      expect(powerButton).toHaveAttr('aria-pressed', 'true'),
      expect(powerButton).toBeEnabled(),
    )
  })

  // Turning off. `ManagedResource.release(entry)` says "the microphone was
  // closed" by sending the entry's `onReleased` Message, `ReleasedMicrophone`.
  // `update` does nothing with that Message, so what the step adds here is
  // its guard: it throws unless the Model has stopped wanting the microphone.
  // That is the half of "releases the microphone" a scene can show. In the
  // app, the Model no longer wanting it is what makes the runtime close it,
  // and the closing itself (stopping the tracks) is tested in
  // `microphone.test.ts`.
  //
  // The ManagedResource steps are optional. Scene is given `update` and
  // `view` only, not the app's managed resources, so it cannot insist on
  // these steps the way it insists that Commands are resolved.
  test('pressing the button while listening turns it off and releases the microphone', () => {
    scene(
      { update, view },
      given(hearing(110, 3)),
      click(powerButton),
      ManagedResource.release(managedResources.microphone),
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      expect(needleMarker).toBeAbsent(),
    )
  })

  // `ManagedResource.failAcquire(entry, error)` says "opening the microphone
  // failed, with this error". Scene hands the error to the entry's
  // `onAcquireError`, so the app's real classifier (`microphoneFailure` in
  // `microphone.ts`) decides what kind of failure it is. The error here is
  // what a browser throws when the person says no: an `Error` named
  // `NotAllowedError`. One test therefore covers the whole path: the thrown
  // value, the kind (`Refused`), the Message, the `Failed` state, and the
  // sentence in the alert.
  test('a refused microphone shows the reason as an alert', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      timerSetAside,
      ManagedResource.failAcquire(
        managedResources.microphone,
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      ),
      // A refusal is the person's own choice and is not reported to Sentry.
      Command.expectNone(),
      // `toHaveText(string)` passes when the element's whole text equals the
      // string. `REFUSED` is the app's own constant, and its wording is
      // pinned in `microphone.test.ts`. The alert is found by its role,
      // which is also what makes a screen reader announce it.
      expect(role('alert')).toHaveText(REFUSED),
      // The button is back to "On / Off" and enabled, ready for another try.
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      expect(powerButton).toBeEnabled(),
    )
  })

  // A fault, unlike a refusal, is both shown and reported. The Command steps
  // work exactly as in a story. `expectExact` checks the name and arguments
  // of what is pending, and `resolve` stands in for the Command finishing. No
  // report is sent: the Command's Effect never runs. The `resolve` cannot be
  // left out, because a scene with a Command still pending fails at its end.
  // The person is shown the browser's own message.
  test('an unexpected microphone error shows the browser’s message', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      timerSetAside,
      ManagedResource.failAcquire(
        managedResources.microphone,
        Object.assign(new Error('The device is busy'), {
          name: 'AbortError',
        }),
      ),
      Command.expectExact(
        ReportProblem({
          name: 'AbortError',
          detail: 'The device is busy',
        }),
      ),
      Command.resolve(ReportProblem, Message.CompletedReportProblem()),
      expect(role('alert')).toHaveText('The device is busy'),
    )
  })

  // Not everything that gets thrown is an `Error`. A bare string has no name
  // and no message, so the failure is named "Unknown" and has an empty
  // detail. It is still reported, and the person gets a plain sentence, not
  // an empty alert.
  test('an unexplained microphone error shows the fallback sentence', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      timerSetAside,
      ManagedResource.failAcquire(managedResources.microphone, '???'),
      Command.expectExact(ReportProblem({ name: 'Unknown', detail: '' })),
      Command.resolve(ReportProblem, Message.CompletedReportProblem()),
      expect(role('alert')).toHaveText('The microphone could not be opened.'),
    )
  })
})

// While the browser's permission prompt is open, the button says
// "Starting…". To someone who has not noticed the prompt that looks like a
// tuner that is stuck. So when a start has lasted 1.2 seconds, a line under
// the button says what the tuner is waiting for, and the line goes when the
// start ends, whichever way it ends. A start the microphone answers quickly
// never shows it.
describe('waiting for the microphone', () => {
  const startingButton = role('button', { name: 'Starting…' })

  // The region the line appears in is on the page from the very first
  // drawing, empty. That is for screen readers: one announces a change to a
  // live region it already knows about, and may say nothing about a region
  // that arrives with its text already in it. `toBeEmpty` passes when the
  // element has no text and no children.
  test.each([
    ['before the app is running', firstModel],
    ['off', offModel],
    ['listening', listening()],
  ])('%s: the status region is there, and empty', (_name, start) => {
    scene({ update, view }, given(start), expect(statusRegion).toBeEmpty())
  })

  // The whole of it, in the order a person meets it who takes a while to
  // find the browser's prompt.
  test('the line appears when the wait is over, and goes when the microphone opens', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      // Just after the press: starting, and nothing said yet.
      expect(startingButton).toExist(),
      expect(statusRegion).toBeEmpty(),
      // 1.2 seconds later the tuner is still starting.
      timerReports,
      expect(statusRegion).toHaveText(WAITING_LINE),
      // The button has not changed: still busy, still disabled.
      expect(startingButton).toBeDisabled(),
      // The person allows the microphone. The tuner is on and the line has
      // gone, though the region stays.
      ManagedResource.acquire(managedResources.microphone),
      expect(powerButton).toHaveAttr('aria-pressed', 'true'),
      expect(statusRegion).toBeEmpty(),
    )
  })

  // The person says no instead. The line gives way to the alert.
  test('the line goes when the microphone is refused', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      timerReports,
      expect(statusRegion).toHaveText(WAITING_LINE),
      ManagedResource.failAcquire(
        managedResources.microphone,
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      ),
      expect(statusRegion).toBeEmpty(),
      expect(role('alert')).toHaveText(REFUSED),
    )
  })

  // A start that is answered before the timer: the line is never drawn,
  // before or after.
  test('a start that is granted quickly never shows the line', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      expect(statusRegion).toBeEmpty(),
      timerSetAside,
      expect(statusRegion).toBeEmpty(),
      ManagedResource.acquire(managedResources.microphone),
      expect(statusRegion).toBeEmpty(),
    )
  })
})

// How the On / Off button looks to a pointer. While it is disabled (before
// the app is running, and while the tuner is starting) it must not look
// pressable: no pointing hand, and no change of colour under the pointer.
// The classes are Tailwind's, and a scene can only see that the view asked
// for them. What a browser then draws was checked in headless Chrome.
// `toHaveClass(name)` passes when the element's class list has that one
// name in it, and `.not` turns any matcher round.
describe('the power button under a pointer', () => {
  const startingButton = role('button', { name: 'Starting…' })

  test.each([
    ['off', offModel],
    ['listening', listening()],
  ])('%s: the pointing hand, and a hover colour', (_name, start) => {
    scene(
      { update, view },
      given(start),
      expect(powerButton).toHaveClass('cursor-pointer'),
      expect(powerButton).toHaveClass('hover:bg-slate-900'),
      expect(powerButton).not.toHaveClass('cursor-default'),
      expect(powerButton).not.toHaveClass('opacity-50'),
    )
  })

  // Starting is busy, not unavailable: the spinner says so, and the button
  // is not dimmed.
  test('starting: the ordinary cursor, no hover colour, not dimmed', () => {
    scene(
      { update, view },
      given(startingModel),
      expect(startingButton).toBeDisabled(),
      expect(startingButton).toHaveClass('cursor-default'),
      expect(startingButton).not.toHaveClass('cursor-pointer'),
      expect(startingButton).not.toHaveClass('hover:bg-slate-900'),
      expect(startingButton).not.toHaveClass('opacity-50'),
    )
  })

  test('before the app is running: the ordinary cursor, no hover colour, dimmed', () => {
    scene(
      { update, view },
      given(firstModel),
      expect(powerButton).toBeDisabled(),
      expect(powerButton).toHaveClass('cursor-default'),
      expect(powerButton).toHaveClass('opacity-50'),
      expect(powerButton).not.toHaveClass('cursor-pointer'),
      expect(powerButton).not.toHaveClass('hover:bg-slate-900'),
    )
  })
})

// The screen is the dark panel that shows the note, the detail line under
// it, the needle and the input level. These scenes have no interaction in
// them: each starts from a Model that is already listening and checks what
// the view draws for it. How the tuner comes to be listening is covered
// above.
describe('screen', () => {
  // 110 Hz is A2, the open A string of a guitar. On standard tuning the page
  // must name the note, give the detail, and light the A string and no
  // other.
  test('an in-tune A2 on standard tuning', () => {
    scene(
      { update, view },
      given(hearing(110, 3)),
      // The note display has no role or label, so it is found by its
      // `aria-live` attribute. The view draws the name ("A") and the octave
      // ("2") as two elements. `toHaveText` reads all the text inside the
      // element it is given, joined together, so it sees "A2".
      expect(selector('[aria-live="polite"]')).toHaveText('A2'),
      expect(text('110.0 Hz · +3 cents · in tune')).toExist(),
      // `expectAll(many).toHaveCount(n)` passes when exactly `n` elements
      // match. Exactly one string is lit...
      expectAll(all.selector('[aria-current="true"]')).toHaveCount(1),
      // ...and it is the A string.
      expect(litString).toHaveText('A'),
    )
  })

  // The wording of the detail line. "In tune" means within 5 cents either
  // way, 5 included. The row for 5.6 pins a detail: the number is rounded
  // for display ("+6"), but the word is chosen from the needle before
  // rounding. The frequency is 440 in every row, which is fine: see
  // `hearing` above.
  test.each([
    [12, '440.0 Hz · +12 cents · sharp'],
    [-12, '440.0 Hz · -12 cents · flat'],
    [5, '440.0 Hz · +5 cents · in tune'],
    [-5, '440.0 Hz · -5 cents · in tune'],
    [5.6, '440.0 Hz · +6 cents · sharp'],
    [0, '440.0 Hz · 0 cents · in tune'],
  ])('needle %d reads "%s"', (needleCents, detail) => {
    scene(
      { update, view },
      given(hearing(440, needleCents)),
      expect(text(detail)).toExist(),
    )
  })

  // Where the needle is drawn. The dial runs from -50 to +50 cents, spread
  // over 0% to 100% of its width, and a needle beyond either end is held at
  // that end. `toHaveStyle(name, value)` reads the inline style that the
  // view set on the element. No browser is involved, so there is no computed
  // style to read.
  test.each([
    [0, '50%'],
    [-80, '0%'],
    [80, '100%'],
    [-12.5, '37.5%'],
  ])('needle %d sits at %s', (needleCents, left) => {
    scene(
      { update, view },
      given(hearing(440, needleCents)),
      expect(needleMarker).toHaveStyle('left', left),
    )
  })

  // Listening, with sound coming in but no note found in it yet. Nothing
  // about a note may show.
  //
  // The first three checks say what is there. Without them the test would
  // pass on a blank page, or on the wrong page: "absent" is true of
  // everything a page does not have. So it first shows that this is the
  // tuner, switched on, with the level bar following the sound and the six
  // strings waiting.
  test('no reading: there is no detail line and no needle marker', () => {
    scene(
      { update, view },
      given(listening({ level: 0.2 })),
      expect(powerButton).toHaveAttr('aria-pressed', 'true'),
      expect(role('meter', { name: 'Input level' })).toHaveAttr(
        'aria-valuenow',
        '20',
      ),
      expectAll(strings).toHaveCount(6),
      // `text` also takes a regular expression, which it tests against the
      // text of each element. The pattern is `/Hz ·/` and not `/Hz/` because
      // the how-to text, which was on this page when the test was written,
      // says "442 Hz". The shorter pattern found that sentence and this
      // check failed (FINDINGS.md,
      // "Scope a locator to the part of the page it is about").
      expect(text(/Hz ·/)).toBeAbsent(),
      expect(needleMarker).toBeAbsent(),
      expect(litString).toBeAbsent(),
    )
  })

  // The level bar is a Foldkit UI Meter, found here the way a screen reader
  // finds it: by the role `meter` and its name. The level, 0 to 1 in the
  // Model, is reported as a whole number from 0 to 100.
  test('the level meter reports the level as a percentage', () => {
    scene(
      { update, view },
      given(listening({ level: 0.42 })),
      expect(role('meter', { name: 'Input level' })).toHaveAttr(
        'aria-valuenow',
        '42',
      ),
    )
  })
})

// The row of chips under the screen: one for each string of the chosen
// tuning.
describe('strings', () => {
  // `nth(many, index)` picks one element out of the matches, counting from
  // 0. Low E comes first and high E last.
  test('standard tuning shows six strings, low to high', () => {
    scene(
      { update, view },
      given(listening()),
      expect(role('list', { name: 'Strings' })).toExist(),
      expectAll(strings).toHaveCount(6),
      expect(nth(strings, 0)).toHaveText('E'),
      expect(nth(strings, 1)).toHaveText('A'),
      expect(nth(strings, 5)).toHaveText('E'),
    )
  })

  // G C E A is the order of the strings across a ukulele, not the order of
  // their pitches: the G string is tuned above the C beside it. The chips
  // must follow the instrument, so this test pins that they are not sorted.
  test('ukulele shows G C E A in that order', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'ukulele')),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 0)).toHaveText('G'),
      expect(nth(strings, 1)).toHaveText('C'),
      expect(nth(strings, 2)).toHaveText('E'),
      expect(nth(strings, 3)).toHaveText('A'),
    )
  })

  // A mandolin has eight strings in four pairs, each pair tuned to one note.
  // There is one chip for each pair, not one for each string: the tuner
  // hears a note and cannot tell which string of a pair made it.
  test('mandolin shows four chips, G D A E, one for each pair', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'mandolin')),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 0)).toHaveText('G'),
      expect(nth(strings, 1)).toHaveText('D'),
      expect(nth(strings, 2)).toHaveText('A'),
      expect(nth(strings, 3)).toHaveText('E'),
    )
  })

  // A five-string banjo in open G. Its short fifth string, the high G, comes
  // first, as it does when a player looks down at the instrument. The row
  // has two chips that read G and two that read D, an octave apart.
  test('banjo shows G D G B D, the short high string first', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'banjo')),
      expectAll(strings).toHaveCount(5),
      expect(nth(strings, 0)).toHaveText('G'),
      expect(nth(strings, 1)).toHaveText('D'),
      expect(nth(strings, 2)).toHaveText('G'),
      expect(nth(strings, 3)).toHaveText('B'),
      expect(nth(strings, 4)).toHaveText('D'),
    )
  })

  // 392 Hz is the banjo's high G. Of the two chips that read G, only the
  // first is lit: the one whose target is 392 Hz, not the G an octave below.
  // `all.selector` with `toHaveCount(1)` shows that exactly one chip is lit.
  test("the banjo's high G lights the first chip and no other", () => {
    scene(
      { update, view },
      given(withTuning(hearing(392, 0), 'banjo')),
      expectAll(
        all.selector('[aria-label="Strings"] [aria-current]'),
      ).toHaveCount(1),
      expect(nth(strings, 0)).toHaveAttr('aria-current', 'true'),
      expect(title('392.00 Hz')).toHaveText('G'),
    )
  })

  // Each chip is a keyed element, and its key is `stringKey` from
  // `src/tuning.ts`: the tuning's id and the string's place in the tuning.
  // A scene sees the key, though a browser does not: it is a field of the
  // virtual node, not an attribute of the element, and Scene's selectors
  // read it when the attribute asked for is called `key`. The banjo's two D
  // chips are told apart by it.
  test('each chip is keyed by its tuning and its place in it', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'banjo')),
      expect(selector('[aria-label="Strings"] [key="banjo-0"]')).toHaveText(
        'G',
      ),
      expect(selector('[aria-label="Strings"] [key="banjo-1"]')).toHaveText(
        'D',
      ),
      expect(selector('[aria-label="Strings"] [key="banjo-4"]')).toHaveText(
        'D',
      ),
    )
  })

  // Chromatic names any note and has no strings. The whole list is left out,
  // not drawn empty, and nothing is lit even with a note sounding.
  //
  // As in "no reading" above, the first three checks say what is there, so
  // that a blank page cannot pass: the picker names the tuning, and the note
  // that is sounding is named and measured as on any other tuning.
  test('chromatic shows no strings', () => {
    scene(
      { update, view },
      given(withTuning(hearing(110, 0), 'chromatic')),
      expect(role('button', { name: 'Tuning' })).toContainText(
        'Chromatic: Any Instrument',
      ),
      expect(selector('[aria-live="polite"]')).toHaveText('A2'),
      expect(text('110.0 Hz · 0 cents · in tune')).toExist(),
      expect(role('list', { name: 'Strings' })).toBeAbsent(),
      expect(litString).toBeAbsent(),
    )
  })

  // `title(text)` finds an element by its `title` attribute, the text a
  // browser shows as a tooltip. Each chip carries the frequency to tune that
  // string to: low E is 82.41 Hz when A4 is 440.
  test('a string chip carries its target frequency', () => {
    scene(
      { update, view },
      given(listening()),
      expect(title('82.41 Hz')).toHaveText('E'),
    )
  })

  // The targets are worked out from the Model's A4. With A4 at 442, low E is
  // 82.78 Hz.
  test('the target frequency follows A4', () => {
    scene(
      { update, view },
      given(modifyFields(listening(), { a4: () => 442 })),
      expect(title('82.78 Hz')).toHaveText('E'),
    )
  })
})

// The app has three pages, and the route in the Model says which one the
// view draws (src/route.ts). A scene is given a Model, so each page is
// reached by putting its route in the Model: `onRoute` does that.
//
// What a scene cannot do is follow a link. A click on a link is caught by
// the runtime, which listens on the real document and sends ClickedLink,
// and a scene has no runtime and no address bar. So these tests pin what
// each page shows and where its link points. `update`'s half is in
// story.test.ts under 'routing', and the click through and back is made in
// a running app, in app.runtime.test.ts (FINDINGS.md, "A Scene test cannot
// follow a link").
describe('pages', () => {
  const onRoute = (route: AppRoute): Model =>
    modifyFields(offModel, { route: () => route })

  const powerButton = role('button', { name: 'On / Off' })
  const howToHeading = role('heading', { name: 'How to use the tuner' })
  // A link is found by its role and its text, as a screen reader names it.
  // `toHaveAttr` then checks where it goes.
  const backLink = role('link', { name: 'Back to the tuner' })

  // The tuner's page has the tuner, and a link to the how-to text in place
  // of the text itself.
  test('the tuner page shows the tuner and links to the how-to page', () => {
    scene(
      { update, view },
      given(onRoute(AppRoute.Tuner())),
      expect(powerButton).toExist(),
      expect(role('link', { name: 'How to use the tuner' })).toHaveAttr(
        'href',
        '/how-to',
      ),
      expect(howToHeading).toBeAbsent(),
      expect(text(/Nothing is recorded\./)).toBeAbsent(),
    )
  })

  // The how-to page has the explanation, with the sentence that tells
  // people nothing is recorded, and no tuner.
  test('the how-to page explains the tuner and links back', () => {
    scene(
      { update, view },
      given(onRoute(AppRoute.HowTo())),
      expect(howToHeading).toExist(),
      expect(text(/Nothing is recorded\./)).toExist(),
      expect(role('heading', { name: 'Quick tips', level: 2 })).toExist(),
      expect(backLink).toHaveAttr('href', '/'),
      expect(powerButton).toBeAbsent(),
    )
  })

  // The first tip names the tunings in words, and nothing but this test
  // ties those words to the list in `src/tuning.ts`. Every label there has
  // the form "Instrument - Tuning" except Chromatic's, which has a colon
  // and is left out by the filter. The instrument is the part before the
  // dash, and the page must mention each one. A tuning for an instrument
  // the page does not name fails here until the tip is brought up to date.
  // The pattern ignores case: the label says "Mandolin" and the tip says
  // "mandolin".
  // `new Set` drops the repeats (five tunings are for the guitar), and the
  // spread turns the set back into a list for `test.each`.
  test.each([
    ...new Set(
      TUNINGS.filter(tuning => tuning.label.includes(' - ')).map(tuning =>
        tuning.label.slice(0, tuning.label.indexOf(' - ')),
      ),
    ),
  ])('the how-to page names the %s', instrument => {
    scene(
      { update, view },
      given(onRoute(AppRoute.HowTo())),
      expect(text(new RegExp(instrument, 'i'))).toExist(),
    )
  })

  // An address no route matches still draws a page. It does not print the
  // path that was asked for: the build draws this page once and it is
  // served for every unknown address, so it has to be the same for all of
  // them (src/page/notFound.ts).
  test('an unknown address says so and links back', () => {
    scene(
      { update, view },
      given(onRoute(AppRoute.NotFound({ path: '/nope' }))),
      expect(role('heading', { name: 'Page not found' })).toExist(),
      expect(text('There is no page at this address.')).toExist(),
      expect(text(/\/nope/)).toBeAbsent(),
      expect(backLink).toHaveAttr('href', '/'),
      expect(powerButton).toBeAbsent(),
    )
  })

  // Each page marks the heading that names it with the id that the
  // `FocusPageHeading` Command looks for, and makes it focusable from code
  // with `tabindex="-1"` (a heading cannot take focus otherwise). Foldkit
  // sets that one as the DOM property `tabIndex`, which is the name a scene
  // knows it by. When the
  // page changes, focus moves there and a screen reader reads it out
  // (FINDINGS.md, "A page change is silent unless the app moves focus").
  //
  // That heading is the page's one `<h1>`, and it names the page, not the
  // site: a screen reader's list of headings then starts with where you
  // are. Every page has exactly one.
  const pages: ReadonlyArray<readonly [string, AppRoute, string]> = [
    ['tuner', AppRoute.Tuner(), 'Tuner'],
    ['how-to', AppRoute.HowTo(), 'How to use the tuner'],
    ['built-with', AppRoute.BuiltWith(), 'Built with'],
    ['privacy', AppRoute.Privacy(), 'Privacy'],
    ['not-found', AppRoute.NotFound({ path: '/nope' }), 'Page not found'],
  ]

  test.each(pages)(
    'the %s page has one first-level heading, which names it and takes focus',
    (_, route, name) => {
      scene(
        { update, view },
        given(onRoute(route)),
        expect(role('heading', { name, level: 1 })).toHaveAttr(
          'id',
          PAGE_HEADING_ID,
        ),
        expect(role('heading', { name, level: 1 })).toHaveAttr(
          'tabIndex',
          '-1',
        ),
        expectAll(all.role('heading', { level: 1 })).toHaveCount(1),
        expectAll(all.selector(`#${PAGE_HEADING_ID}`)).toHaveCount(1),
      )
    },
  )

  // The site's name is not a heading. It is the brand, in the page's
  // header, and a link to the home page. `role('banner')` is the `<header>`
  // element when it sits outside `<main>`, as the footer's test explains
  // for `contentinfo`.
  test.each(pages)('the %s page has the brand in its header', (_, route) => {
    scene(
      { update, view },
      given(onRoute(route)),
      expect(
        within(role('banner'), role('link', { name: 'OK Tuner' })),
      ).toHaveAttr('href', '/'),
      expect(role('heading', { name: 'OK Tuner' })).toBeAbsent(),
    )
  })

  // The home page's heading is there for screen readers and for the
  // outline of the page, and is not shown: the tuner needs no title above
  // it. `sr-only` is Tailwind's class for "in the page, but not on screen".
  test('the tuner page keeps its heading off screen, and says what it is', () => {
    scene(
      { update, view },
      given(onRoute(AppRoute.Tuner())),
      expect(role('heading', { name: 'Tuner', level: 1 })).toHaveClass(
        'sr-only',
      ),
      expect(
        text(
          'A free chromatic tuner that works in the browser. For guitar, bass, ukulele and other stringed instruments.',
        ),
      ).toExist(),
    )
  })
})

// The Privacy page: what the site does with data, in plain words. The
// footer's first row links to it.
describe('privacy page', () => {
  const privacy = modifyFields(offModel, { route: () => AppRoute.Privacy() })

  test('says what is and is not collected, and by whom', () => {
    scene(
      { update, view },
      given(privacy),
      expect(role('heading', { name: 'Privacy', level: 1 })).toExist(),
      expect(role('heading', { name: 'Your microphone', level: 2 })).toExist(),
      expect(role('heading', { name: 'Error reports', level: 2 })).toExist(),
      expect(role('heading', { name: 'Visitor counts', level: 2 })).toExist(),
      expect(role('link', { name: 'Sentry' })).toHaveAttr(
        'href',
        'https://sentry.io',
      ),
      expect(role('link', { name: 'Vercel Web Analytics' })).toHaveAttr(
        'href',
        'https://vercel.com/docs/analytics/privacy-policy',
      ),
      expect(text(/no cookies/i)).toExist(),
      expect(role('link', { name: 'Back to the tuner' })).toHaveAttr(
        'href',
        '/',
      ),
      expect(role('button', { name: 'On / Off' })).toBeAbsent(),
    )
  })
})

// The Built With page: what the app is made of, as groups of cards. Each
// card is a link to the thing it names and a line about what it does here.
describe('built-with page', () => {
  const builtWith = modifyFields(offModel, {
    route: () => AppRoute.BuiltWith(),
  })

  test('says what it is, lists what the app is made of, and links back', () => {
    scene(
      { update, view },
      given(builtWith),
      expect(role('heading', { name: 'Built with', level: 1 })).toExist(),
      expect(role('heading', { name: 'The app', level: 2 })).toExist(),
      expect(role('heading', { name: 'Sound', level: 2 })).toExist(),
      expect(role('heading', { name: 'Running it', level: 2 })).toExist(),
      expect(role('link', { name: 'Foldkit' })).toHaveAttr(
        'href',
        'https://foldkit.dev',
      ),
      expect(role('link', { name: 'Effect' })).toHaveAttr(
        'href',
        'https://effect.website',
      ),
      expect(role('link', { name: 'Back to the tuner' })).toHaveAttr(
        'href',
        '/',
      ),
      expect(role('button', { name: 'On / Off' })).toBeAbsent(),
    )
  })
})

// The footer: two rows of small print under every page. It sits outside
// the <main> element, which is what makes it the page's `contentinfo`
// landmark: a screen reader can jump straight to it. (A <footer> inside
// <main> would not count, and `role('contentinfo')` would not find it.)
// Every locator is scoped to the footer with `within`, because the Built
// With page has links of the same names in its own text.
describe('footer', () => {
  const footer = role('contentinfo')
  const inFooter = (name: string) => within(footer, role('link', { name }))

  test.each([
    ['tuner', AppRoute.Tuner()],
    ['how-to', AppRoute.HowTo()],
    ['built-with', AppRoute.BuiltWith()],
    ['privacy', AppRoute.Privacy()],
    ['not-found', AppRoute.NotFound({ path: '/nope' })],
  ])('the %s page has the footer, with its links', (_, route) => {
    scene(
      { update, view },
      given(modifyFields(offModel, { route: () => route })),
      expect(footer).toExist(),
      // The first row: what kind of site this is, and a link to the page
      // that backs the claim. On screen the link reads "Learn More". Its
      // full name adds what it is about, for anyone who hears the link out
      // of its sentence, in words that are in the page but not on screen.
      expect(
        within(
          footer,
          text(
            /ad-free, open-source and privacy-respecting\. Safe for all ages\./,
          ),
        ),
      ).toExist(),
      expect(inFooter('Learn More about privacy')).toHaveAttr(
        'href',
        '/privacy',
      ),
      // Row one: the copyright and license line, the Built With page, and
      // the code.
      expect(within(footer, text(/© 2026 Lightning Jar\./))).toExist(),
      expect(inFooter('Apache 2.0 license')).toHaveAttr('href', LICENSE_URL),
      expect(inFooter('Built with Foldkit')).toHaveAttr('href', '/built-with'),
      expect(inFooter('GitHub')).toHaveAttr('href', GITHUB_URL),
      // Row two: who built it, which version this is, and where it came
      // from.
      expect(inFooter('Lightning Jar')).toHaveAttr('href', LIGHTNING_JAR_URL),
      expect(within(footer, text(`v${VERSION}`))).toExist(),
      expect(inFooter('Stem Shovel')).toHaveAttr('href', STEM_SHOVEL_URL),
    )
  })

  // The version shown is the one in package.json, so it cannot drift from
  // the one the project is released under. This pins its shape.
  test('the version is a release number', () => {
    scene(
      { update, view },
      given(offModel),
      expect(within(footer, text(/^v\d+\.\d+\.\d+$/))).toExist(),
    )
  })
})

// The two controls under the strings: the tuning picker, which is a Foldkit
// UI Listbox, and the settings menu, a Foldkit UI Popover that holds the A4
// field. Each has a button, and the name the button is found by here is the
// `ariaLabel` that the view passes to the component.
describe('controls', () => {
  const tuningPicker = role('button', { name: 'Tuning' })
  const settingsMenu = role('button', { name: 'Tuner settings' })

  // Both controls can be used only while the tuner is listening.
  test('the picker and the A4 menu are disabled while the tuner is off', () => {
    scene(
      { update, view },
      given(offModel),
      expect(tuningPicker).toBeDisabled(),
      expect(settingsMenu).toBeDisabled(),
    )
  })

  test('the picker and the A4 menu are enabled while listening', () => {
    scene(
      { update, view },
      given(listening()),
      expect(tuningPicker).toBeEnabled(),
      expect(settingsMenu).toBeEnabled(),
    )
  })

  // The closed picker shows the label of the tuning in use. `toContainText`
  // passes when the element's text includes the string, where `toHaveText`
  // wants the whole text to equal it.
  test('the picker shows the chosen tuning', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'drop-d')),
      expect(tuningPicker).toContainText('Guitar - Drop D'),
    )
  })

  // A bass has four strings, E to G. Together with the scene above, this
  // shows that both the picker and the chips are drawn from the one
  // `tuningId` in the Model.
  test('the strings follow the chosen tuning', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'bass')),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 0)).toHaveText('E'),
      expect(nth(strings, 3)).toHaveText('G'),
    )
  })

  // The A4 field is on the page only while the settings menu is open. This
  // helper puts the menu in its open state directly in the Model, using the
  // Popover's own `open` function. `open` returns the same shape as an
  // update, and `.model` is the opened Popover's Model. The scenes below
  // start with the menu already open and do not click its button.
  const withOpenSettings = (model: Model): Model =>
    modifyFields(model, {
      a4Popover: () => Popover.open(model.a4Popover).model,
    })

  // MOUNTS
  //
  // A Mount is work tied to an element of the page. The view attaches one
  // with `h.OnMount(...)`, and in the browser the runtime starts it when the
  // element appears and stops it when the element goes. An open Popover has
  // two: `AnchorPopover` places the panel against its button, and
  // `PortalPopoverBackdrop` moves the backdrop to another place in the
  // document.
  //
  // Scene has no real elements, so it runs neither. It finds the Mounts in
  // the page it has drawn and holds them as pending, as it does Commands,
  // until the test gives each its result Message with
  // `Mount.resolve(definition, resultMessage)`. While a Mount is pending no
  // interaction may run, and a scene that ends with one pending fails.
  //
  // The result Message is the Popover's own,
  // `Popover.Message.CompletedAnchorPopover()`, not wrapped in the app's
  // `GotA4PopoverMessage`. Scene applies the wrapping itself. Passing the
  // wrapped Message is a type error and a schema error (FINDINGS.md, "Scene's
  // `Mount.resolve` takes the child component's own Message").
  //
  // The two steps are kept in an array and spread into each scene that opens
  // the menu. Steps are ordinary values, so they can be shared like this.
  const acknowledgeSettingsMenu = [
    Mount.resolve(
      Popover.AnchorPopover,
      Popover.Message.CompletedAnchorPopover(),
    ),
    Mount.resolve(
      Popover.PortalPopoverBackdrop,
      Popover.Message.CompletedPortalPopoverBackdrop(),
    ),
  ]

  // The one scene that follows a change all the way round: typing in the
  // field, the Model changing, a Command returned, and another part of the
  // page (the string chips) drawn from the new value.
  test('typing a valid A4 in the settings menu applies and saves it', () => {
    scene(
      { update, view },
      given(withOpenSettings(listening())),
      // The open menu's two Mounts must be resolved before `type` may run.
      ...acknowledgeSettingsMenu,
      // `label(text)` finds a form control by its label. Here that is the
      // `<input>`, not the `<label>` element that reads "A4 (Hz)".
      // `toHaveValue` checks the control's current value.
      expect(label('A4 (Hz)')).toHaveValue('440'),
      // `type(locator, value)` calls the control's input handler once, with
      // `value` as the control's whole new text. It does not press keys one
      // at a time, and there is no real input to write into. The handler
      // sends `UpdatedA4Input`, and the field shows "442" afterwards only
      // because `update` stored it and the view drew it again.
      type(label('A4 (Hz)'), '442'),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
      expect(label('A4 (Hz)')).toHaveValue('442'),
      // Low E was 82.41 Hz at 440. The chip has followed the new A4.
      expect(title('82.78 Hz')).toHaveText('E'),
    )
  })

  // 39 is not a pitch between 400 and 480. The field keeps what was typed
  // and is marked invalid for assistive technology, nothing is saved, and
  // the string chips still show the targets for 440.
  test('junk in the A4 field is marked invalid and changes nothing', () => {
    scene(
      { update, view },
      given(withOpenSettings(listening())),
      ...acknowledgeSettingsMenu,
      type(label('A4 (Hz)'), '39'),
      Command.expectNone(),
      expect(label('A4 (Hz)')).toHaveAttr('aria-invalid', 'true'),
      expect(title('82.41 Hz')).toHaveText('E'),
    )
  })

  // OPENING BY A CLICK
  //
  // The scenes above build a Model with the menu already open. These two
  // start with everything closed and do what a person does: click the
  // control, then use what opens.
  //
  // A click that opens a Foldkit UI component is followed by up to three
  // steps before the scene may go on, because rule 3 in the header lets no
  // interaction run while a Command or a Mount is waiting:
  //
  //   1. the Commands the component's update returned for the click, if any;
  //   2. the Mount of the panel that has just been drawn;
  //   3. the Mount of the backdrop behind it.
  //
  // The three may come in any order, as long as all are done before the
  // next click.
  //
  // The Listbox returns one Command when it opens, `FocusItems`, which moves
  // the keyboard focus into the list. The Popover returns none, because
  // this one is not modal. Each step takes the component's own Message,
  // unwrapped, as `acknowledgeSettingsMenu` does. Foldkit's own Listbox test
  // opens one the same way
  // (`repos/foldkit/packages/ui/src/listbox/single.test.ts`).

  // The picker, from closed to a new tuning. The list is a `listbox` and
  // each tuning in it an `option`: the Listbox gives its elements those
  // roles, and they are what a screen reader goes by.
  test('clicking the picker opens the list, and clicking a tuning chooses it', () => {
    scene(
      { update, view },
      given(listening()),
      // Closed: there is no list on the page at all.
      expect(role('listbox')).toBeAbsent(),
      click(tuningPicker),
      // `expectExact` with a Command built from its definition checks the
      // arguments too: the Listbox is told which list to focus by its id.
      Command.expectExact(Listbox.FocusItems({ id: 'tuning' })),
      Command.resolve(
        Listbox.FocusItems,
        Listbox.Message.CompletedFocusItems(),
      ),
      Mount.resolve(
        Listbox.AnchorListbox,
        Listbox.Message.CompletedAnchorListbox(),
      ),
      Mount.resolve(
        Listbox.PortalListboxBackdrop,
        Listbox.Message.CompletedPortalListboxBackdrop(),
      ),
      // Open: every tuning is offered, and the one in use is marked.
      expect(tuningPicker).toHaveAttr('aria-expanded', 'true'),
      expectAll(all.role('option')).toHaveCount(TUNINGS.length),
      expect(role('option', { name: 'Guitar - Standard' })).toHaveAttr(
        'aria-selected',
        'true',
      ),
      click(role('option', { name: 'Bass - Standard' })),
      // Choosing returns two Commands: the Listbox hands the focus back to
      // its button, and the app saves the choice. `resolveAllExact` fails
      // if either is missing or if anything else came back.
      Command.resolveAllExact(
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [SavePreferences, Message.SucceededSavePreferences()],
      ),
      // The list has gone, and its two Mounts with it. In a browser that is
      // when the runtime runs a Mount's clean-up. `Mount.expectEnded`
      // acknowledges it, and is not optional: a scene in which a Mount
      // leaves the page fails at its end unless a step has said so. It
      // throws if a Mount it names is still on the page.
      Mount.expectEnded(Listbox.AnchorListbox, Listbox.PortalListboxBackdrop),
      // Closed again, on the new tuning: the button names it, and the
      // chips are a bass's four strings.
      expect(role('listbox')).toBeAbsent(),
      expect(tuningPicker).toContainText('Bass - Standard'),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 3)).toHaveText('G'),
    )
  })

  // The settings menu, from closed to a new A4 and closed again. The second
  // click on the button is how a person closes it, and closing returns the
  // Popover's one Command, which hands the focus back to the button.
  test('clicking the settings button opens the menu, where A4 can be changed', () => {
    scene(
      { update, view },
      given(listening()),
      // Closed: the field is not on the page.
      expect(label('A4 (Hz)')).toBeAbsent(),
      click(settingsMenu),
      Command.expectNone(),
      ...acknowledgeSettingsMenu,
      expect(settingsMenu).toHaveAttr('aria-expanded', 'true'),
      expect(label('A4 (Hz)')).toHaveValue('440'),
      type(label('A4 (Hz)'), '442'),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
      expect(title('82.78 Hz')).toHaveText('E'),
      click(settingsMenu),
      Command.resolveAllExact([
        Popover.FocusButton,
        Popover.Message.CompletedFocusButton(),
      ]),
      Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop),
      expect(settingsMenu).toHaveAttr('aria-expanded', 'false'),
      expect(label('A4 (Hz)')).toBeAbsent(),
      // The new pitch outlives the menu.
      expect(title('82.78 Hz')).toHaveText('E'),
    )
  })
})
