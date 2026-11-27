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
//    given its result (see MOUNTS, after the fixtures). And a
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
  expectHandled,
  expectIgnored,
  given,
  keydown,
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

// The announcer is the part of the `Listening` state that holds what a
// screen reader is told. A tuner starts with the silent one.
import { type Announcement, SILENT_ANNOUNCER } from './intonation'
import {
  AttachA4SelectOnFocus,
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
import { BUSY, MicrophoneFailure, REFUSED } from './microphone'
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
        announcer: SILENT_ANNOUNCER,
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

// MOUNTS
//
// A Mount is work tied to an element of the page. The view attaches one
// with `h.OnMount(...)`, and in the browser the runtime starts it when the
// element appears and stops it when the element goes. The open settings
// menu has three. Two are the Popover's: `AnchorPopover` places the panel
// against its button and then puts focus in the A4 field, and
// `PortalPopoverBackdrop` moves the backdrop to another place in the
// document. The third is the app's own, on the A4 field:
// `AttachA4SelectOnFocus` selects the field's text whenever the field takes
// focus, so that typing replaces the number.
//
// Scene has no real elements, so it runs none of them. It finds the Mounts
// in the page it has drawn and holds them as pending, as it does Commands,
// until the test gives each its result Message with
// `Mount.resolve(definition, resultMessage)`. While a Mount is pending no
// interaction may run, and a scene that ends with one pending fails.
//
// The Popover's result Messages are the Popover's own,
// `Popover.Message.CompletedAnchorPopover()`, not wrapped in the app's
// `GotA4PopoverMessage`. Scene applies the wrapping itself. Passing the
// wrapped Message is a type error and a schema error (FINDINGS.md, "Scene's
// `Mount.resolve` takes the child component's own Message"). The app's own
// Mount reports with one of the app's Messages.
//
// The three steps are kept in an array and spread into each scene that
// opens the menu. Steps are ordinary values, so they can be shared like
// this.
const acknowledgeSettingsMenu = [
  Mount.resolve(
    Popover.AnchorPopover,
    Popover.Message.CompletedAnchorPopover(),
  ),
  Mount.resolve(
    Popover.PortalPopoverBackdrop,
    Popover.Message.CompletedPortalPopoverBackdrop(),
  ),
  Mount.resolve(
    AttachA4SelectOnFocus,
    Message.CompletedAttachA4SelectOnFocus(),
  ),
]

// The other end of the same three. When the menu closes, their elements
// leave the page, which in a browser is when the runtime runs a Mount's
// clean-up. A scene in which a Mount leaves the page fails at its end
// unless a step has said so, and `Mount.expectEnded` is that step. It
// throws if a Mount it names is still on the page.
//
// NOTE: this is a function that makes the step afresh each time, where
// `acknowledgeSettingsMenu` above is one array shared by every scene. A
// `Mount.expectEnded` step can be used once. It crosses the Mounts off its
// own list as it finds them, so a second scene given the same step finds
// the list empty, acknowledges nothing, and fails at its end with "Mounts
// that ended without being acknowledged" (FINDINGS.md, "A
// `Mount.expectEnded` step works once").
const settingsMenuGone = () =>
  Mount.expectEnded(
    Popover.AnchorPopover,
    Popover.PortalPopoverBackdrop,
    AttachA4SelectOnFocus,
  )

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
// The big note on the tuner's screen. It has no role or label, so the view
// gives it a `data-tuner-note` attribute for this to find.
const noteDisplay = selector('[data-tuner-note]')
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
// What each chip shows: the note's letter. A chip holds two pieces of text.
// The letter is drawn and hidden from assistive technology (`aria-hidden`),
// and the note with its octave ("E2") is off screen and read out. So the
// letters are found by the attribute that hides them, and a chip's name is
// checked with `toHaveAccessibleName`, which leaves hidden text out. See
// "what a screen reader is told" below.
const letters = all.selector('[aria-label="Strings"] li [aria-hidden="true"]')
// The tuning picker, whichever tuning it shows. Its accessible name is the
// word "Tuning", a colon and the chosen tuning's label, so the pattern
// matches the start. A regular expression may match part of the name, where
// a string must match all of it.
const tuningPicker = role('button', { name: /^Tuning: / })
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

// Neither line may move the page when it appears or goes. So both are drawn
// inside one block that is on the page from the first drawing and always
// keeps its room: beside the On / Off button where the pedal is wide
// enough, and under it on a phone (`powerRowView` in `src/view.ts`). The
// view marks the block with a `data-tuner-messages` attribute for these
// tests to find, since an empty block has no role, name or text.
//
// What a scene can show is that the block is always there, that both lines
// are drawn inside it and not beside it, and that the view asked for the
// classes that keep the room. That the pedal is then the same height with
// and without a line was measured in headless Chrome, at 1280 and at 375
// pixels wide. `within(parent, child)` narrows a locator to what is inside
// another.
describe('the room kept for a line by the On / Off button', () => {
  const messages = selector('[data-tuner-messages]')

  const failedModel: Model = modifyFields(offModel, {
    tuner: () => TunerState.Failed({ failure: MicrophoneFailure.Busy() }),
  })

  test.each([
    ['before the app is running', firstModel],
    ['off', offModel],
    ['starting', startingModel],
    ['listening', listening()],
    ['failed', failedModel],
  ])('%s: the block is there, with its room', (_name, start) => {
    scene(
      { update, view },
      given(start),
      // Three lines of text on a phone, two beside the button from 640
      // pixels up, where a line is longer.
      expect(messages).toHaveClass('min-h-[60px]'),
      expect(messages).toHaveClass('sm:min-h-[40px]'),
      expect(within(messages, statusRegion)).toExist(),
    )
  })

  test('the waiting line is drawn inside the block', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      timerReports,
      expect(within(messages, statusRegion)).toHaveText(WAITING_LINE),
      ManagedResource.acquire(managedResources.microphone),
    )
  })

  test('the failure line is drawn inside the block', () => {
    scene(
      { update, view },
      given(failedModel),
      expect(within(messages, role('alert'))).toHaveText(BUSY),
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
      // The view draws the name ("A") and the octave ("2") as two
      // elements. `toHaveText` reads all the text inside the element it is
      // given, joined together, so it sees "A2".
      expect(noteDisplay).toHaveText('A2'),
      expect(text('110.0 Hz · +3 cents · in tune')).toExist(),
      // `expectAll(many).toHaveCount(n)` passes when exactly `n` elements
      // match. Exactly one string is lit...
      expectAll(all.selector('[aria-current="true"]')).toHaveCount(1),
      // ...and it is the A string, the one in the second octave.
      // `toHaveAccessibleName` checks what a screen reader would call the
      // element, which for a chip is the note with its octave.
      expect(litString).toHaveAccessibleName('A2'),
    )
  })

  // The wording of the detail line, away from the edge of "in tune". The
  // frequency is 440 in every row, which is fine: see `hearing` above.
  test.each([
    [12, '440.0 Hz · +12 cents · sharp'],
    [-12, '440.0 Hz · -12 cents · flat'],
    [5, '440.0 Hz · +5 cents · in tune'],
    [-5, '440.0 Hz · -5 cents · in tune'],
    [0, '440.0 Hz · 0 cents · in tune'],
  ])('needle %d reads "%s"', (needleCents, detail) => {
    scene(
      { update, view },
      given(hearing(440, needleCents)),
      expect(text(detail)).toExist(),
    )
  })

  // The edge of "in tune". There is one rule, and it goes by the number as
  // shown: the needle is rounded to a whole cent, and that whole number is
  // in tune when it is within 5 (`IN_TUNE_CENTS`). Four things on the page
  // say "in tune", and each row checks all four together, because the
  // fault this replaced was two of them disagreeing: a needle at 5.4 read
  // "+5 cents · sharp".
  //
  //   the number   the needle rounded, halves away from zero both ways
  //   the word     "in tune", or "sharp" or "flat" by the sign
  //   the marker   green in tune, yellow otherwise
  //   the chip     the lit string's border and letter, the same two colours
  //
  // Zero has no sign, whichever side of it the needle is: "-0 cents" was
  // what a needle a hair flat used to print.
  //
  // A row is the needle, the number and word expected, and whether that is
  // in tune. The colours are Tailwind classes, which is as far as a scene
  // can see (the note at "the power button under a pointer" above).
  const litChipFace = selector('[aria-current="true"] [title]')

  test.each([
    [4.4, '+4 cents · in tune', true],
    [4.5, '+5 cents · in tune', true],
    [5.4, '+5 cents · in tune', true],
    [5.5, '+6 cents · sharp', false],
    [5.6, '+6 cents · sharp', false],
    [-0.4, '0 cents · in tune', true],
    [0.4, '0 cents · in tune', true],
    [-4.5, '-5 cents · in tune', true],
    [-5.4, '-5 cents · in tune', true],
    [-5.5, '-6 cents · flat', false],
    [-5.6, '-6 cents · flat', false],
  ])(
    'needle %d reads "%s", and the colours agree',
    (needleCents, ending, isInTune) => {
      scene(
        { update, view },
        given(hearing(440, needleCents)),
        // The whole line, so a "-0" or a stray sign cannot hide in front
        // of a match.
        expect(text(`440.0 Hz · ${ending}`)).toExist(),
        isInTune
          ? expect(needleMarker).toHaveClass('bg-green-300')
          : expect(needleMarker).toHaveClass('bg-maximum-yellow'),
        isInTune
          ? expect(needleMarker).not.toHaveClass('bg-maximum-yellow')
          : expect(needleMarker).not.toHaveClass('bg-green-300'),
        isInTune
          ? expect(litChipFace).toHaveClass('border-green-400')
          : expect(litChipFace).toHaveClass('border-accent'),
        isInTune
          ? expect(litChipFace).toHaveClass('text-green-400')
          : expect(litChipFace).toHaveClass('text-accent'),
      )
    },
  )

  // The green zone on the needle bar is the picture of the same rule. A
  // needle reads in tune until it rounds to 6, which is at 5.5, so the zone
  // is 5.5 cents either side of the middle: from 44.5% across, 11% wide.
  // Drawn 5 either side, a green needle at 5.4 would sit outside it. The
  // zone is decoration with no role or text, so the view marks it with a
  // `data-in-tune-zone` attribute for this to find.
  test('the green zone of the bar covers every needle that reads in tune', () => {
    scene(
      { update, view },
      given(listening()),
      expect(selector('[data-in-tune-zone]')).toHaveStyle('left', '44.5%'),
      expect(selector('[data-in-tune-zone]')).toHaveStyle('width', '11%'),
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
      expect(nth(letters, 0)).toHaveText('E'),
      expect(nth(letters, 1)).toHaveText('A'),
      expect(nth(letters, 5)).toHaveText('E'),
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
      expect(nth(letters, 0)).toHaveText('G'),
      expect(nth(letters, 1)).toHaveText('C'),
      expect(nth(letters, 2)).toHaveText('E'),
      expect(nth(letters, 3)).toHaveText('A'),
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
      expect(nth(letters, 0)).toHaveText('G'),
      expect(nth(letters, 1)).toHaveText('D'),
      expect(nth(letters, 2)).toHaveText('A'),
      expect(nth(letters, 3)).toHaveText('E'),
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
      expect(nth(letters, 0)).toHaveText('G'),
      expect(nth(letters, 1)).toHaveText('D'),
      expect(nth(letters, 2)).toHaveText('G'),
      expect(nth(letters, 3)).toHaveText('B'),
      expect(nth(letters, 4)).toHaveText('D'),
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
      expect(title('392.00 Hz')).toHaveAccessibleName('G4'),
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
      expect(
        selector('[aria-label="Strings"] [key="banjo-0"]'),
      ).toHaveAccessibleName('G4'),
      expect(
        selector('[aria-label="Strings"] [key="banjo-1"]'),
      ).toHaveAccessibleName('D3'),
      expect(
        selector('[aria-label="Strings"] [key="banjo-4"]'),
      ).toHaveAccessibleName('D4'),
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
      expect(tuningPicker).toContainText('Chromatic: Any Instrument'),
      expect(noteDisplay).toHaveText('A2'),
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
      expect(title('82.41 Hz')).toHaveAccessibleName('E2'),
    )
  })

  // The targets are worked out from the Model's A4. With A4 at 442, low E is
  // 82.78 Hz.
  test('the target frequency follows A4', () => {
    scene(
      { update, view },
      given(modifyFields(listening(), { a4: () => 442 })),
      expect(title('82.78 Hz')).toHaveAccessibleName('E2'),
    )
  })
})

// What the page says to someone who cannot see it. Three things are pinned
// here: the one live region and its text, the names of the string chips,
// and the names of the controls.
//
// A scene sees roles, names and attributes, which is what a browser builds
// its accessibility tree from. It cannot hear a screen reader, and neither
// could anyone when this was written: FINDINGS.md, "What is still unheard",
// lists what a person with one should check.
describe('what a screen reader is told', () => {
  // The live region: an element whose changes of text a screen reader
  // reads out. It is off screen and has no role, so the view marks it with
  // a `data-tuner-announcement` attribute for this to find.
  const announcement = selector('[data-tuner-announcement]')
  // Every live region on the page, of any kind: an element with
  // `aria-live`, or with a role that makes it one.
  const liveByAttribute = all.selector('[aria-live]')

  // A Model that is listening, with the announcer saying something. The
  // announcer is real state, kept by `update` (see "what is spoken" in
  // story.test.ts for when it changes). A scene is given a Model, so it
  // can put the words there directly.
  const speaking = (model: Model, spoken: Announcement): Model =>
    modifyFields(model, {
      tuner: tuner =>
        TunerState.match(tuner, {
          Booting: booting => booting,
          Off: off => off,
          Starting: starting => starting,
          Listening: fields =>
            TunerState.Listening({
              ...fields,
              announcer: {
                maybeSpoken: Option.some(spoken),
                maybeCandidate: Option.some(spoken),
                heldReadings: 7,
              },
            }),
          Failed: failed => failed,
        }),
    })

  // The region has to be in the page before it has anything to say: a
  // screen reader announces a change inside a region it already knows
  // about, and may say nothing when a region arrives with its text in it.
  // So it is there in every state, the very first drawing included, empty.
  // `toHaveText('')` passes only when the element holds no text at all.
  test.each([
    ['before the app is running', firstModel],
    ['off', offModel],
    ['starting', startingModel],
    ['listening and hearing nothing', listening()],
  ])('%s: the region is in the page, polite, whole, and empty', (_, model) => {
    scene(
      { update, view },
      given(model),
      expect(announcement).toExist(),
      expect(announcement).toHaveAttr('aria-live', 'polite'),
      // `aria-atomic="true"`: the whole text is read, not only the part
      // that changed.
      expect(announcement).toHaveAttr('aria-atomic', 'true'),
      // Tailwind's class for "read out, and off screen".
      expect(announcement).toHaveClass('sr-only'),
      expect(announcement).toHaveText(''),
    )
  })

  // The words are the note with its octave and one of three states.
  test.each([
    [{ midi: 40, intonation: 'Flat' }, 'E2, flat'],
    [{ midi: 40, intonation: 'InTune' }, 'E2, in tune'],
    [{ midi: 64, intonation: 'Sharp' }, 'E4, sharp'],
    [{ midi: 54, intonation: 'InTune' }, 'F sharp 3, in tune'],
  ] as const)('the region says what the Model holds: %o', (spoken, words) => {
    scene(
      { update, view },
      given(speaking(hearing(82.41, 0), spoken)),
      expect(announcement).toHaveText(words),
    )
  })

  // What is shown and what is spoken are separate on purpose: the screen
  // follows every reading, and the region lags it by a third of a second.
  // Here the screen already shows a sharp note while the region still says
  // nothing, as it would just after a pluck.
  test('the region says nothing until the Model says so, whatever the screen shows', () => {
    scene(
      { update, view },
      given(hearing(440, 12)),
      expect(text('440.0 Hz · +12 cents · sharp')).toExist(),
      expect(announcement).toHaveText(''),
    )
  })

  // One region speaks for the reading, and nothing else on the tuner's
  // screen is live. The big note was a live region until 0.8.0. Left as
  // one, a screen reader would say the note twice. The detail line changes
  // twenty times a second and must never be one.
  test('the note and the detail line are not live regions', () => {
    scene(
      { update, view },
      given(speaking(hearing(110, 3), { midi: 45, intonation: 'InTune' })),
      expectAll(liveByAttribute).toHaveCount(1),
      expect(noteDisplay).toHaveText('A2'),
      expect(noteDisplay).not.toHaveAttr('aria-live'),
      expect(noteDisplay).not.toHaveAttr('aria-atomic'),
      // The other region on the page is the waiting line's, a `status`,
      // which is empty unless a start is slow. The failure line's `alert`
      // is absent unless the microphone failed.
      expectAll(all.role('status')).toHaveCount(1),
      expect(statusRegion).toHaveText(''),
      expect(role('alert')).toBeAbsent(),
    )
  })

  // The chips. Each shows one letter, and is called by the note with its
  // octave, so the two E strings of a guitar can be told apart by ear.
  // `it.each` rows: the tuning, what the chips show, what they are called.
  test.each([
    ['standard', 'E A D G B E', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']],
    ['banjo', 'G D G B D', ['G4', 'D3', 'G3', 'B3', 'D4']],
    ['mandolin', 'G D A E', ['G3', 'D4', 'A4', 'E5']],
    [
      'half-down',
      'D♯ G♯ C♯ F♯ A♯ D♯',
      [
        'D sharp 2',
        'G sharp 2',
        'C sharp 3',
        'F sharp 3',
        'A sharp 3',
        'D sharp 4',
      ],
    ],
  ])('%s: the chips show %s and are named by octave', (id, shown, names) => {
    const shownLetters = shown.split(' ')

    scene(
      { update, view },
      given(withTuning(listening(), id)),
      expectAll(strings).toHaveCount(names.length),
      ...names.map((name, index) =>
        expect(nth(strings, index)).toHaveAccessibleName(name),
      ),
      // The letter is all that is drawn: one hidden-from-assistive-
      // technology span in each chip, holding the letter alone.
      expectAll(letters).toHaveCount(names.length),
      ...shownLetters.map((letter, index) =>
        expect(nth(letters, index)).toHaveText(letter),
      ),
    )
  })

  // The list keeps its role and its name. `role="list"` is written out
  // because Safari with VoiceOver stops calling a `<ul>` a list once its
  // bullets are styled away.
  test('the chips are a list named "Strings"', () => {
    scene(
      { update, view },
      given(listening()),
      expect(role('list', { name: 'Strings' })).toHaveAttr('role', 'list'),
    )
  })

  // The lit chip is marked with `aria-current`, which `role` can ask for.
  // 329.63 Hz is the high E of a guitar: of the two chips that show E, the
  // one called E4 is current and the one called E2 is not.
  test('the lit chip is the current one, by name', () => {
    scene(
      { update, view },
      given(hearing(329.63, 0)),
      expect(role('listitem', { name: 'E4', current: true })).toExist(),
      expect(role('listitem', { name: 'E2', current: true })).toBeAbsent(),
      expectAll(
        all.selector('[aria-label="Strings"] [aria-current]'),
      ).toHaveCount(1),
    )
  })

  // What the tuner shows of its tuning while it is off. The picker's text
  // and the chips' letters are dimmed and can still be read: which tuning
  // is chosen is information. A scene sees classes, not colours, so this
  // pins the classes whose contrast was measured in headless Chrome: 5.2
  // to 1 for the picker's text and 3.4 to 1 for a letter (FINDINGS.md,
  // "The chosen tuning can be read while the tuner is off"). A change to
  // either class needs a new measurement.
  test('off: the chosen tuning is dimmed, not hidden', () => {
    scene(
      { update, view },
      given(offModel),
      expect(tuningPicker).toHaveClass('text-blue-100/55'),
      expect(nth(letters, 0)).toHaveClass('opacity-70'),
      expect(nth(letters, 5)).toHaveClass('opacity-70'),
    )
  })

  test('listening: the tuning is at full strength', () => {
    scene(
      { update, view },
      given(listening()),
      expect(tuningPicker).toHaveClass('text-blue-100/80'),
      expect(nth(letters, 0)).toHaveClass('opacity-100'),
    )
  })

  // The failure line's colour is this project's own, `failure` in
  // `src/styles.css`: the darkest red that still reads as one, 4.8 to 1
  // at the foot of the pedal. Measured, like the two above.
  test('the failure line is drawn in the failure colour', () => {
    scene(
      { update, view },
      given(
        modifyFields(offModel, {
          tuner: () =>
            TunerState.Failed({ failure: MicrophoneFailure.Refused() }),
        }),
      ),
      expect(role('alert')).toHaveText(REFUSED),
      expect(role('alert')).toHaveClass('text-failure'),
    )
  })

  // The picker's name says what it is and what is chosen, and it contains
  // the words on the button, whole and in order. It gets there by having
  // no `aria-label` at all: such a label would replace the button's own
  // text as its name, which is how the control came to be called "Tuning"
  // and nothing more.
  test.each([
    ['standard', 'Tuning: Guitar - Standard'],
    ['banjo', 'Tuning: Banjo - Open G'],
    ['chromatic', 'Tuning: Chromatic: Any Instrument'],
  ])('the picker on %s is named "%s"', (id, name) => {
    scene(
      { update, view },
      given(withTuning(listening(), id)),
      expect(role('button', { name })).toExist(),
      expect(role('button', { name })).not.toHaveAttr('aria-label'),
      expect(role('button', { name })).not.toHaveAttr('aria-labelledby'),
    )
  })

  // While the tuner is off the picker is disabled and still says which
  // tuning is chosen.
  test('the disabled picker keeps its name', () => {
    scene(
      { update, view },
      given(offModel),
      expect(
        role('button', { name: 'Tuning: Guitar - Standard' }),
      ).toBeDisabled(),
    )
  })

  // The open list is called "Tuning" and each option by its tuning. The
  // Listbox names its list after its button, which would put the chosen
  // tuning in the list's name as well. The view points the list at the
  // word alone, by handing the Listbox an `aria-labelledby` that replaces
  // the Listbox's own. If a later Foldkit stops letting it, this fails.
  test('the open list is named "Tuning", and each option by its tuning', () => {
    scene(
      { update, view },
      given(listening()),
      click(tuningPicker),
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
      expect(role('listbox', { name: 'Tuning' })).toExist(),
      ...TUNINGS.map(tuning =>
        expect(role('option', { name: tuning.label })).toExist(),
      ),
      expect(
        role('option', { name: 'Guitar - Standard', selected: true }),
      ).toExist(),
      // The button's name is unchanged by the list being open.
      expect(
        role('button', { name: 'Tuning: Guitar - Standard', expanded: true }),
      ).toExist(),
      // Close the list, as the scenes under "controls" do: a scene may not
      // end with a Mount on the page unacknowledged.
      click(role('option', { name: 'Guitar - Standard' })),
      Command.resolveAllExact(
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [SavePreferences, Message.SucceededSavePreferences()],
      ),
      Mount.expectEnded(Listbox.AnchorListbox, Listbox.PortalListboxBackdrop),
    )
  })

  // The settings menu. Its button shows only an icon, so an `aria-label`
  // is its whole name. The field is a number field, which has the role
  // `spinbutton`, and its name is the visible label beside it.
  //
  // `Mount.expectHas` with a Mount built from its definition checks the
  // arguments too. `focusSelector` is how the view asks the Popover to put
  // focus in the field when the menu opens: the panel's Mount focuses the
  // element that selector finds, once it has placed the panel. A scene
  // runs no Mount, so this shows only that the view asked. That focus
  // really lands in the field, and returns to the button on closing, was
  // checked in headless Chrome.
  test('the settings menu names its parts, and asks for focus in the A4 field', () => {
    const settingsMenu = role('button', { name: 'Tuner settings' })

    scene(
      { update, view },
      given(listening()),
      click(settingsMenu),
      Mount.expectHas(
        Popover.AnchorPopover({
          buttonId: 'a4-button',
          anchor: { placement: 'bottom-end', gap: 4, padding: 8 },
          focusSelector: '#a4-input',
          arrowId: 'a4-arrow',
        }),
      ),
      ...acknowledgeSettingsMenu,
      expect(role('spinbutton', { name: 'A4 (Hz)' })).toHaveAttr(
        'id',
        'a4-input',
      ),
      // The visible label is a real `<label>` tied to the field.
      expect(text('A4 (Hz)')).toHaveAttr('htmlFor', 'a4-input'),
      // The panel can take focus, so it has a role and a name.
      expect(role('group', { name: 'Tuner settings' })).toExist(),
      // Closing by the button returns focus to it: the Popover's own
      // Command, and nothing else.
      click(settingsMenu),
      Command.resolveAllExact([
        Popover.FocusButton,
        Popover.Message.CompletedFocusButton(),
      ]),
      settingsMenuGone(),
    )
  })

  // Tab and Shift+Tab in the A4 field close the menu and hand focus back
  // to the settings button. Left to the browser, Tab would go to the first
  // link of the page: an open Popover moves its panel to the start of the
  // document, and the keyboard follows the document.
  //
  // `keydown(locator, key, modifiers)` calls the element's keydown
  // handlers the way `click` calls its click handlers. `expectHandled`
  // passes when the last interaction called `preventDefault`, which is
  // what stops the browser from moving focus by itself, and
  // `expectIgnored` when it did not.
  test.each([
    ['Tab', {}],
    ['Shift+Tab', { shiftKey: true }],
  ])(
    '%s in the A4 field closes the menu and returns focus to its button',
    (_, modifiers) => {
      const settingsMenu = role('button', { name: 'Tuner settings' })
      const a4Field = role('spinbutton', { name: 'A4 (Hz)' })

      scene(
        { update, view },
        given(listening()),
        click(settingsMenu),
        ...acknowledgeSettingsMenu,
        keydown(a4Field, 'Tab', modifiers),
        expectHandled(),
        Command.resolveAllExact([
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ]),
        settingsMenuGone(),
        expect(settingsMenu).toHaveAttr('aria-expanded', 'false'),
        expect(a4Field).toBeAbsent(),
      )
    },
  )

  // The panel can hold focus itself, after a click on its padding. From
  // there Shift+Tab would go to the last link of the page, so it is taken
  // too, with the same result.
  test('Shift+Tab on the panel itself closes the menu and returns focus to its button', () => {
    const settingsMenu = role('button', { name: 'Tuner settings' })

    scene(
      { update, view },
      given(listening()),
      click(settingsMenu),
      ...acknowledgeSettingsMenu,
      keydown(role('group', { name: 'Tuner settings' }), 'Tab', {
        shiftKey: true,
      }),
      expectHandled(),
      Command.resolveAllExact([
        Popover.FocusButton,
        Popover.Message.CompletedFocusButton(),
      ]),
      settingsMenuGone(),
      expect(settingsMenu).toHaveAttr('aria-expanded', 'false'),
    )
  })

  // Every other key in the field is the browser's: digits, the arrows
  // that step the number, and Escape, which the panel round the field
  // answers by closing the menu.
  test('other keys in the A4 field are left to the browser', () => {
    const settingsMenu = role('button', { name: 'Tuner settings' })
    const a4Field = role('spinbutton', { name: 'A4 (Hz)' })

    scene(
      { update, view },
      given(listening()),
      click(settingsMenu),
      ...acknowledgeSettingsMenu,
      keydown(a4Field, '4'),
      expectIgnored(),
      keydown(a4Field, 'ArrowUp'),
      expectIgnored(),
      // Tab on the panel itself goes forward into the field, which is the
      // browser's to do. (Shift+Tab there is taken: the next scene.)
      keydown(role('group', { name: 'Tuner settings' }), 'Tab'),
      expectIgnored(),
      expect(settingsMenu).toHaveAttr('aria-expanded', 'true'),
      // Escape, to end the scene with the menu closed. It is sent to the
      // panel, where the Popover's handler is. In a browser an Escape
      // pressed in the field travels up to the panel by itself. A scene's
      // `keydown` calls the handlers of the one element it is given.
      keydown(a4Field, 'Escape'),
      expectIgnored(),
      keydown(role('group', { name: 'Tuner settings' }), 'Escape'),
      expectHandled(),
      Command.resolveAllExact([
        Popover.FocusButton,
        Popover.Message.CompletedFocusButton(),
      ]),
      settingsMenuGone(),
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
      expect(nth(letters, 0)).toHaveText('E'),
      expect(nth(letters, 3)).toHaveText('G'),
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
      expect(title('82.78 Hz')).toHaveAccessibleName('E2'),
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
      expect(title('82.41 Hz')).toHaveAccessibleName('E2'),
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
      expect(nth(letters, 3)).toHaveText('G'),
    )
  })

  // How tall the open list may be is the Listbox's business, and the view
  // must stay out of it. The Listbox measures the list, opens it on the
  // side of the button where it fits, and sets the room left as an inline
  // `max-height`. A `max-h-...` class of our own makes the list measure
  // short on that first pass: it then seems to fit under the button, stays
  // there, and scrolls with room to spare above (FINDINGS.md, "A height
  // class on the open list stopped it opening upwards"). So the list has no
  // height class and no overflow class. What it does have is `scroll-cue`,
  // the utility in `src/styles.css` that shows there is more to scroll to
  // in a window too short for the whole list.
  //
  // A scene can only see that the view asked for the classes. Where the
  // list opens, and what the cue looks like, were checked in headless
  // Chrome. The scene ends by choosing a tuning, as the scene above does,
  // because that closes the list: a scene may not end with a Command or a
  // Mount left unanswered.
  test('the open list is given no height of its own, and says when it scrolls', () => {
    scene(
      { update, view },
      given(listening()),
      click(tuningPicker),
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
      expect(role('listbox')).not.toHaveClass('max-h-64'),
      expect(role('listbox')).not.toHaveClass('overflow-y-auto'),
      expect(role('listbox')).toHaveClass('scroll-cue'),
      click(role('option', { name: 'Guitar - Standard' })),
      Command.resolveAllExact(
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [SavePreferences, Message.SucceededSavePreferences()],
      ),
      Mount.expectEnded(Listbox.AnchorListbox, Listbox.PortalListboxBackdrop),
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
      expect(title('82.78 Hz')).toHaveAccessibleName('E2'),
      click(settingsMenu),
      Command.resolveAllExact([
        Popover.FocusButton,
        Popover.Message.CompletedFocusButton(),
      ]),
      settingsMenuGone(),
      expect(settingsMenu).toHaveAttr('aria-expanded', 'false'),
      expect(label('A4 (Hz)')).toBeAbsent(),
      // The new pitch outlives the menu.
      expect(title('82.78 Hz')).toHaveAccessibleName('E2'),
    )
  })
})
