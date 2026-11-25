// STORY TESTS: `update`, one Message at a time
//
// A Foldkit app keeps all of its state in one value, the Model, and changes
// it in one place: `update(model, message)`, a pure function that returns the
// next Model and, optionally, a list of Commands. A Command describes a side
// effect for the Foldkit runtime to perform later. A Story test drives that
// function directly. It starts from a Model, sends Messages, and looks at the
// Model and the Commands that come back. No view is rendered, no runtime is
// started and no side effect happens, so these tests are fast and give the
// same answer every time.
//
// This file exercises `update`, `init` and the `managedResources` record in
// `src/main.ts`.
//
// HOW A STORY READS
//
//   story(update, given(model), message(...), model(...), Command.x(...))
//
// `story` takes the update function and then any number of steps. It runs the
// steps in the order written and carries two things from one step to the
// next: the current Model and the list of pending Commands. `story` returns
// nothing. A step that is not satisfied throws, and the thrown error is what
// fails the Vitest test around it.
//
//   given(model)        Sets the Model the story starts from.
//   message(m)          Calls `update(currentModel, m)`. The Model it returns
//                       becomes the current Model, and any Commands it
//                       returns join the pending list.
//   model(fn)           Calls `fn(currentModel)`. Ordinary Vitest `expect`
//                       calls go inside `fn`.
//   Command.expect...   Check the pending list without changing it.
//   Command.resolve...  Say "this Command finished, with this result": take
//                       the Command off the pending list and send its result
//                       Message through `update`.
//
// Each step is explained in full where it first appears below.
//
// TWO RULES STORY ENFORCES
//
// 1. Every Command that `update` returns must be resolved. `message` throws
//    if a Command from an earlier step is still pending, and `story` throws
//    at the end if any is left. (Foldkit exempts interruptible Commands from
//    the first half of that; this app defines none.)
// 2. A Command is only data here. Story never runs the Effect inside it, so
//    nothing is written to storage and nothing is sent to Sentry. What the
//    app's two Commands really do is tested in `storage.test.ts` and
//    `sentry.test.ts`.
//
// WHAT A STORY CANNOT SEE
//
// - The page. Whether a person can reach a state by clicking, and what they
//   then see, is tested in `scene.test.ts`.
// - The runtime's side of things: opening and closing the microphone (a
//   managed resource) and the stream of readings (a Subscription). Story has
//   no steps for either. A test here plays the runtime's part by sending the
//   Message the runtime would have sent, and one group near the end calls the
//   managed resource's functions directly (FINDINGS.md, "Story has no
//   managed-resource steps; Scene does").

// `Array` and `Option` are Effect's modules, not JavaScript's built-ins, so
// in this file the name `Array` means Effect's (`Array.makeBy`, further
// down). `Option` is how Effect, and so this app's Model, says "a value that
// may be missing": `Option.some(value)` or `Option.none()`, where plain
// TypeScript would use `null` or `undefined`.
import { Array, Option } from 'effect'
// The Story steps. `Command` here is Story's group of steps for pending
// Commands (`Command.resolve`, `Command.expectExact` and so on). It is not
// the `Command` module from `foldkit` that `main.ts` uses to define Commands.
import { UrlRequest } from 'foldkit/navigation'
import { Command, given, message, model, story } from 'foldkit/story'
// `modifyFields(struct, { field: old => next })` returns a copy of a struct
// with the named fields replaced. It is how this project changes a Model
// without mutating it, in tests as in `update`.
import { modifyFields } from 'foldkit/struct'
// A `Url` is plain data, so a test builds one from a string with
// `fromString`.
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

// The two Foldkit UI components the app embeds: the tuning picker is a
// Listbox and the A4 menu is a Popover. Each brings its own Model, Messages
// and Commands, which the last two groups of tests need.
import { Listbox, Popover } from '@foldkit/ui'

// Everything under test comes from `main.ts`. `Message` and `TunerState` are
// tagged unions: `Message.ClickedPower()` builds one Message and
// `TunerState.Off()` one state of the tuner. `SavePreferences` and
// `ReportProblem` are Command definitions: calling one with arguments builds
// a Command.
import {
  FocusPageHeading,
  LoadExternal,
  LoadPreferences,
  Message,
  type Model,
  NavigateInternal,
  ReportProblem,
  SavePreferences,
  TunerState,
  init,
  managedResources,
  update,
} from './main'
import { MicrophoneFailure } from './microphone'
import { DEFAULT_PREFERENCES } from './preferences'
import { AppRoute } from './route'

// FIXTURES
//
// A story needs a Model to start from. These build one for each state of the
// tuner, so a test can begin in the middle of things without replaying the
// Messages that lead there.

// The Model the app really starts with. `init` returns the same shape as
// `update` does, `{ model, commands? }`, so `.model` picks the Model out.
// Building every fixture from the real `init` keeps them in step with the
// app.
//
// An app with routing is started at an address, so `init` takes one as its
// argument. `urlOf` builds it: `fromString` returns
// an Option, since a string may not be an address at all, and every string
// in this file is one.
const urlOf = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Not an address: ${raw}`),
  )

const tunerUrl = urlOf('http://localhost/')
const howToUrl = urlOf('http://localhost/how-to')

// The very first Model, as `init` builds it: the page has been drawn but
// the app is not running yet, so the tuner is `Booting`.
const firstModel: Model = init(tunerUrl).model

// The Model a moment later, once the saved preferences have been read. That
// is the Message which says the app is running, so the tuner is `Off`. Every
// other fixture starts from here, because it is the state a person meets.
// The Model is taken from a real call to `update`, to keep it in step with
// the app.
const offModel: Model = update(
  firstModel,
  Message.CompletedLoadPreferences({ preferences: DEFAULT_PREFERENCES }),
).model

// The off Model with its `tuner` field swapped for another state.
const withTuner = (tuner: TunerState): Model =>
  modifyFields(offModel, { tuner: () => tuner })

// The fields of the `Listening` state, each optional, without the `_tag`
// that names the variant. `typeof TunerState.Listening.Type` is the
// TypeScript type of that one variant of the union.
type ListeningFields = Partial<Omit<typeof TunerState.Listening.Type, '_tag'>>

// A Model that is listening. With no argument it has heard nothing yet. Pass
// fields to override the defaults: `listening({ needleCents: 12 })`.
const listening = (fields: ListeningFields = {}): Model =>
  withTuner(
    TunerState.Listening({
      level: 0,
      maybeReading: Option.none(),
      needleCents: 0,
      quietTicks: 0,
      ...fields,
    }),
  )

// The button has been pressed and the microphone is not open yet.
const startingModel = withTuner(TunerState.Starting())
// A microphone failure of the kind that is a fault, not the person's choice.
const unexpected = (detail: string): MicrophoneFailure =>
  MicrophoneFailure.Unexpected({ name: 'AbortError', detail })

// A Model whose last attempt to open the microphone failed.
const failedModel = withTuner(
  TunerState.Failed({ failure: unexpected('earlier') }),
)

// `MeasuredInput` is the Message the readings Subscription sends while the
// tuner is listening, about twenty times a second: how loud the input is,
// and the pitch found in it, if any. `heard` is a reading with a clear
// pitch and `silence` a reading with none. A story has no Subscription, so
// the tests send these by hand.
const heard = (frequency: number, level = 0.5) =>
  Message.MeasuredInput({
    level,
    maybePitch: Option.some({ frequency, clarity: 0.95 }),
  })

const silence = Message.MeasuredInput({ level: 0, maybePitch: Option.none() })

// Two readers for the assertions below. `TunerState.match` is the union's
// own exhaustive matcher: it takes one handler per variant, and leaving one
// out is a type error. Outside `Listening` there is no needle, so `needleOf`
// gives NaN, and an assertion on it fails instead of passing by accident.
const needleOf = (next: Model): number =>
  TunerState.match(next.tuner, {
    Booting: () => Number.NaN,
    Off: () => Number.NaN,
    Starting: () => Number.NaN,
    Listening: ({ needleCents }) => needleCents,
    Failed: () => Number.NaN,
  })

// The frequency of the current reading, if there is one. `Option.map`
// changes the value inside a `Some` and leaves a `None` as it is.
const readingOf = (next: Model): Option.Option<number> =>
  TunerState.match(next.tuner, {
    Booting: () => Option.none(),
    Off: () => Option.none(),
    Starting: () => Option.none(),
    Listening: ({ maybeReading }) =>
      Option.map(maybeReading, ({ frequency }) => frequency),
    Failed: () => Option.none(),
  })

// `init` builds the first Model from the address the app was opened at. It
// is called directly. No Message has been sent yet, so there is nothing for
// a story to drive.
describe('init', () => {
  // The first Model is the same for every visitor, and the same in the build
  // that prerenders the page as in the browser: the defaults. `a4Input` is
  // the text in the A4 field. It is kept apart from the number `a4` so the
  // field can hold text that is not a valid pitch while the person is
  // typing. Union values are plain data, so `toEqual` against a freshly
  // built `TunerState.Off()` compares them by structure.
  test('it starts booting, on standard tuning, with A4 at 440', () => {
    expect(firstModel.tuner).toEqual(TunerState.Booting())
    expect(firstModel.tuningId).toBe('standard')
    expect(firstModel.a4).toBe(440)
    expect(firstModel.a4Input).toBe('440')
  })

  // The build draws the page from this Model, and a browser shows that
  // drawing before the script has run. A button pressed then would do
  // nothing, so the tuner starts in a state of its own, `Booting`, in which
  // the view draws the On / Off button disabled (FINDINGS.md, "A
  // prerendered page looks ready before it is"). The button sends no
  // Message while disabled. This pins what `update` would do with one all
  // the same: nothing.
  test('pressing power while booting does nothing', () => {
    story(
      update,
      given(firstModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next).toEqual(firstModel)
      }),
      Command.expectNone(),
    )
  })

  // What a returning visitor saved is read afterwards, by a Command that
  // `init` returns: `init` gives back `{ model, commands }`, as `update`
  // does. `toEqual` compares the list with one built here, so this pins that
  // LoadPreferences is the only Command.
  test('it asks for the saved preferences, and nothing else', () => {
    expect(init(tunerUrl).commands).toEqual([LoadPreferences()])
  })
})

// The saved tuning and A4 arrive after start-up, as the result of the
// LoadPreferences Command (FINDINGS.md, "A prerendered page cannot start
// from what the browser has saved"). What the Command itself does with
// `localStorage` is tested for real in storage.test.ts.
describe('saved preferences', () => {
  // A returning visitor gets their tuning and A4 back. The tuner stays off:
  // the microphone is never asked for without a press.
  test('the saved tuning and A4 replace the defaults', () => {
    story(
      update,
      given(firstModel),
      message(
        Message.CompletedLoadPreferences({
          preferences: { tuningId: 'bass', a4: 442 },
        }),
      ),
      model(next => {
        expect(next.tuningId).toBe('bass')
        expect(next.a4).toBe(442)
        expect(next.a4Input).toBe('442')
        expect(next.tuner).toEqual(TunerState.Off())
      }),
      Command.expectNone(),
    )
  })

  // The same Message is the sign that the app is running: it can only
  // arrive once the runtime has taken the page over and run a Command. The
  // tuner leaves `Booting` for `Off`, and from here the On / Off button
  // works.
  test('the tuner is ready once the preferences have been read', () => {
    story(
      update,
      given(firstModel),
      message(
        Message.CompletedLoadPreferences({
          preferences: { tuningId: 'bass', a4: 442 },
        }),
      ),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Off())
      }),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
    )
  })

  // A first visit: nothing is saved, the Command answers with the defaults,
  // and the only change is that the tuner is now ready.
  test("with nothing saved, only the tuner's state changes", () => {
    story(
      update,
      given(firstModel),
      message(
        Message.CompletedLoadPreferences({ preferences: DEFAULT_PREFERENCES }),
      ),
      model(next => {
        expect(next).toEqual(
          modifyFields(firstModel, { tuner: () => TunerState.Off() }),
        )
      }),
      Command.expectNone(),
    )
  })
})

// The On / Off button sends one Message, `ClickedPower`. What it does depends
// on the state the tuner is in, so there is one test for each state. (The
// first state, `Booting`, has its test under 'init' above.)
describe('power', () => {
  // The first story, taken one step at a time.
  test('pressing power when off starts the tuner', () => {
    story(
      // The function under test. Every `message` step below calls it.
      update,
      // Start from the off Model.
      given(offModel),
      // Send one Message: this runs `update(offModel, ClickedPower)`.
      message(Message.ClickedPower()),
      // Look at the Model that came back. It is `Starting`, not `Listening`:
      // pressing the button only asks for the microphone. In the running app
      // the runtime then sees that the Model wants the microphone and opens
      // it, and the tuner listens once `SucceededAcquireMicrophone` arrives
      // (the next group). `update` returned no Commands, so there is nothing
      // to resolve before the story ends.
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
    )
  })

  // After a failure the same button is the way to try again.
  test('pressing power after a failure starts again', () => {
    story(
      update,
      given(failedModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
    )
  })

  // Turning off drops the whole `Listening` state, reading and needle
  // included (the fixture's needle is at 12 to show that it goes). In the
  // running app, leaving `Listening` is also what makes the runtime close the
  // microphone: see the "microphone requirement" group.
  test('pressing power while listening turns the tuner off', () => {
    story(
      update,
      given(listening({ needleCents: 12 })),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Off())
      }),
    )
  })

  // A second press while the microphone is still being opened is ignored: the
  // whole Model is unchanged, not only `tuner`. The page disables the button
  // in this state and Scene refuses to click a disabled element, so only a
  // story can show what `update` does with this Message.
  test('pressing power while starting changes nothing', () => {
    story(
      update,
      given(startingModel),
      message(Message.ClickedPower()),
      model(next => {
        expect(next).toEqual(startingModel)
      }),
    )
  })
})

// The microphone is a managed resource. The runtime opens it when the Model
// starts to want it and closes it when the Model stops wanting it, and it
// tells `update` how each of those went by sending a Message:
// `SucceededAcquireMicrophone`, `FailedAcquireMicrophone` or
// `ReleasedMicrophone`. Story has no steps for that lifecycle, so the tests
// in this group send those three Messages themselves, as the runtime would.
describe('microphone', () => {
  // The microphone opened. Listening begins with no reading, a centred needle
  // and a quiet count of zero.
  test('acquiring while starting begins listening from a clean state', () => {
    story(
      update,
      given(startingModel),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.none(),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })

  // In every other state the same Message is ignored. `Listening` is on the
  // list because of development: after a reload Vite can restore a Model that
  // is already listening, the microphone is then acquired again, and that
  // must not wipe what is on the screen (FINDINGS.md, 'In development the
  // page can boot already "listening"').
  test.each([
    ['listening', listening({ needleCents: 12, level: 0.3 })],
    ['off', offModel],
    ['failed', failedModel],
  ])('acquiring while %s changes nothing', (_name, start) => {
    story(
      update,
      given(start),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  // A fault (anything other than the person's own refusal or an unsupported
  // browser) does two things. The tuner moves to `Failed`, carrying the
  // failure for the page to show, and `update` returns a `ReportProblem`
  // Command so the fault reaches Sentry. These are the first tests in the
  // file where `update` returns a Command.
  test.each([
    ['starting', startingModel],
    ['listening', listening({ needleCents: 12 })],
  ])(
    'an unexpected failure while %s shows its reason and is reported',
    (_name, start) => {
      story(
        update,
        given(start),
        message(
          Message.FailedAcquireMicrophone({
            failure: unexpected('No microphone'),
          }),
        ),
        model(next => {
          expect(next.tuner).toEqual(
            TunerState.Failed({ failure: unexpected('No microphone') }),
          )
        }),
        // `Command.expectExact(...)` passes only if the pending Commands are
        // exactly the ones listed: none missing and none extra, in any
        // order. What is listed here is a Command built with its arguments,
        // so both the name and the arguments must match. Listing the bare
        // definition, `ReportProblem`, would match on the name alone.
        Command.expectExact(
          ReportProblem({ name: 'AbortError', detail: 'No microphone' }),
        ),
        // `Command.resolve(definition, resultMessage)` stands in for the
        // runtime finishing the Command. It takes the one pending
        // `ReportProblem` off the list and sends `CompletedReportProblem`
        // through `update`. Nothing is reported: the Command's Effect never
        // runs. The step fails if no `ReportProblem` is pending, or if more
        // than one is. It cannot be left out, because `expectExact` only
        // looks, and a story with a Command still pending fails at its end.
        Command.resolve(ReportProblem, Message.CompletedReportProblem()),
        // The result Message changed nothing: the failure is still showing.
        model(next => {
          expect(next.tuner).toEqual(
            TunerState.Failed({ failure: unexpected('No microphone') }),
          )
        }),
      )
    },
  )

  // A refusal, or a browser that cannot open a microphone at all, is the
  // person's own situation and not a fault. It is shown and never reported
  // (AGENTS.md, "Error reporting"). `Command.expectNone()` passes only when
  // no Command is pending.
  test.each([
    ['refused', MicrophoneFailure.Refused()],
    ['unsupported', MicrophoneFailure.Unsupported()],
  ])('a %s microphone is not reported', (_name, failure) => {
    story(
      update,
      given(startingModel),
      message(Message.FailedAcquireMicrophone({ failure })),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Failed({ failure }))
      }),
      Command.expectNone(),
    )
  })

  // A failure that arrives when the tuner was not waiting for the microphone
  // is ignored. Above all it sends no report: even a fault is not reported
  // from a state that did not ask for the microphone.
  test.each([
    ['off', offModel],
    ['failed', failedModel],
  ])(
    'a failure while %s changes nothing and reports nothing',
    (_name, start) => {
      story(
        update,
        given(start),
        message(
          Message.FailedAcquireMicrophone({
            failure: unexpected('No microphone'),
          }),
        ),
        model(next => {
          expect(next).toEqual(start)
        }),
        Command.expectNone(),
      )
    },
  )

  // `ReleasedMicrophone` is what the runtime sends once it has closed the
  // microphone. By then the Model has already changed (that change is what
  // made the runtime close it), so `update` has nothing left to do, whatever
  // state it is in.
  test.each([
    ['off', offModel],
    ['starting', startingModel],
    ['listening', listening({ needleCents: 12 })],
    ['failed', failedModel],
  ])('releasing while %s changes nothing', (_name, start) => {
    story(
      update,
      given(start),
      message(Message.ReleasedMicrophone()),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  // A longer story: several Messages in a row, with a look at the Model
  // between them. It follows a person who refuses the microphone, sees why
  // the tuner is not on, and presses the button again after allowing it. The
  // retry must end in the same clean `Listening` state as a first start, with
  // nothing left over from the failure.
  test('a refusal shows its reason, and pressing power again retries cleanly', () => {
    story(
      update,
      given(offModel),
      message(Message.ClickedPower()),
      message(
        Message.FailedAcquireMicrophone({
          failure: MicrophoneFailure.Refused(),
        }),
      ),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Failed({ failure: MicrophoneFailure.Refused() }),
        )
      }),
      message(Message.ClickedPower()),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Starting())
      }),
      message(Message.SucceededAcquireMicrophone()),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.none(),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })
})

// `MeasuredInput` is one reading from the microphone. While the tuner is
// listening, the readings Subscription sends one every 50 ms. `update` turns
// that stream into what the person sees: a needle that settles, and a note
// that stays up through short silences. The numbers these tests pin (35%,
// 30 cents, 12 ticks) are constants at the top of `main.ts`.
describe('readings', () => {
  // Outside `Listening` a reading is ignored and the Model is unchanged.
  test.each([
    ['off', offModel],
    ['starting', startingModel],
    ['failed', failedModel],
  ])('a reading that arrives while %s is ignored', (_name, start) => {
    story(
      update,
      given(start),
      message(heard(440)),
      model(next => {
        expect(next).toEqual(start)
      }),
    )
  })

  // 440 Hz is exactly A4, so the needle stays at 0. The quiet count, 7 in
  // the fixture, goes back to 0: the string is sounding again.
  test('a reading with a pitch sets the level, keeps the reading and resets the quiet count', () => {
    story(
      update,
      given(listening({ quietTicks: 7 })),
      message(heard(440, 0.42)),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0.42,
            maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
            needleCents: 0,
            quietTicks: 0,
          }),
        )
      }),
    )
  })

  // 446.4 Hz is 25 cents sharp of A4. The needle does not jump there. On
  // each reading it moves 35% of the remaining distance (from 0 to 8.75
  // here), which is what makes it settle on a note and not jitter.
  test('the first reading of a nearby pitch settles 35% of the way', () => {
    story(
      update,
      given(listening({ needleCents: 0 })),
      message(heard(446.4)),
      model(next => {
        expect(needleOf(next)).toBeCloseTo(8.75, 1)
      }),
    )
  })

  // From -40 to +25 is 65 cents. More than 30 is taken as a new note, so the
  // needle goes straight to it. Without the snap, the needle would creep
  // across the dial each time a different string was played.
  test('a jump of more than 30 cents snaps', () => {
    story(
      update,
      given(listening({ needleCents: -40 })),
      message(heard(446.4)),
      model(next => {
        expect(needleOf(next)).toBeCloseTo(25, 1)
      }),
    )
  })

  // A reading with no pitch in it (silence, or noise) leaves the last note
  // and the needle on the screen and counts one quiet tick. Only the level
  // follows the input.
  test('a reading without a pitch sets the level and counts a quiet tick', () => {
    story(
      update,
      given(
        listening({
          level: 0.5,
          maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
          needleCents: 8,
        }),
      ),
      message(silence),
      model(next => {
        expect(next.tuner).toEqual(
          TunerState.Listening({
            level: 0,
            maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
            needleCents: 8,
            quietTicks: 1,
          }),
        )
      }),
    )
  })

  // Twelve quiet readings are about 0.6 seconds, and for that long the
  // display holds the last note. One more and the reading is cleared and the
  // needle centred.
  test('twelve quiet ticks hold the note; the thirteenth clears it', () => {
    const holding = listening({
      maybeReading: Option.some({ frequency: 440, clarity: 0.95 }),
      needleCents: 8,
    })

    story(
      update,
      given(holding),
      // Steps are ordinary values, so they can be built in code. Effect's
      // `Array.makeBy(12, f)` makes an array of twelve `message(silence)`
      // steps, and `...` spreads them into the story as twelve steps.
      ...Array.makeBy(12, () => message(silence)),
      model(next => {
        expect(readingOf(next)).toEqual(Option.some(440))
        expect(needleOf(next)).toBe(8)
      }),
      message(silence),
      model(next => {
        expect(readingOf(next)).toEqual(Option.none())
        expect(needleOf(next)).toBe(0)
      }),
    )
  })

  // The cents are measured against the Model's A4, not a fixed 440. A band
  // tuned to 442 must read 0 at 442 Hz.
  test('A4 moves the grid: 442 Hz reads 0 cents when A4 is 442', () => {
    story(
      update,
      given(modifyFields(listening(), { a4: () => 442 })),
      message(heard(442)),
      model(next => {
        expect(needleOf(next)).toBe(0)
      }),
    )
  })
})

// Story has no managed-resource steps (Scene has), so this group does not use
// `story` at all. It calls the functions of the `microphone` entry in
// `managedResources` directly: the same functions the runtime calls
// (FINDINGS.md, "Story has no managed-resource steps; Scene does").
//
// `modelToMaybeRequirements` is how the app tells the runtime when it wants
// the microphone. The runtime calls it after every change to the Model.
// `Option.some(...)` means "have it open" and `Option.none()` means "have it
// closed", and the runtime acquires or releases the resource when the answer
// changes from one to the other. What goes inside the `Some` is the
// parameters for opening the resource. This microphone takes none, so it is
// `Option.some(null)`.
describe('microphone requirement', () => {
  // These two tests are the whole switch for the hardware. Wrong here, and
  // the microphone would stay open after Off, or never be opened at all.
  // `Starting` must want it, because that is the state the tuner waits in
  // while the browser asks for permission.
  test.each([
    ['starting', startingModel],
    ['listening', listening()],
  ])('the microphone is required while %s', (_name, start) => {
    expect(managedResources.microphone.modelToMaybeRequirements(start)).toEqual(
      Option.some(null),
    )
  })

  test.each([
    ['booting', firstModel],
    ['off', offModel],
    ['failed', failedModel],
  ])('the microphone is not required while %s', (_name, start) => {
    expect(managedResources.microphone.modelToMaybeRequirements(start)).toEqual(
      Option.none(),
    )
  })

  // The three callbacks that turn a lifecycle outcome into a Message for
  // `update`. `onAcquireError` receives whatever was thrown and sorts it into
  // a kind of failure. A plain `Error` is a fault, and it is named "Error"
  // because that is what its `name` property holds.
  test('acquiring, failing and releasing each report their Message', () => {
    expect(managedResources.microphone.onAcquired()).toEqual(
      Message.SucceededAcquireMicrophone(),
    )
    expect(managedResources.microphone.onReleased()).toEqual(
      Message.ReleasedMicrophone(),
    )
    expect(
      managedResources.microphone.onAcquireError(
        new Error('The device is busy'),
      ),
    ).toEqual(
      Message.FailedAcquireMicrophone({
        failure: MicrophoneFailure.Unexpected({
          name: 'Error',
          detail: 'The device is busy',
        }),
      }),
    )
  })
})

// The A4 field in the settings menu sends `UpdatedA4Input`, carrying the
// field's whole text, each time the text changes. A valid value (a number
// from 400 to 480) is applied and saved at once. Anything else stays in the
// field and is otherwise ignored.
describe('A4', () => {
  // `SavePreferences` carries both preferences, the unchanged tuning and the
  // new A4, because the two are saved together under one storage key.
  test('a valid A4 applies and saves', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '442' })),
      model(next => {
        expect(next.a4).toBe(442)
        expect(next.a4Input).toBe('442')
      }),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
    )
  })

  // `a4Input` keeps what was typed, so the field goes on showing it (the view
  // marks it invalid). `a4`, the pitch in use, does not move, and nothing is
  // saved. "399" and "481" are numbers just outside the range. The two
  // checks can come in either order: neither changes anything.
  test.each(['', 'abc', '399', '481'])(
    'junk in the A4 field ("%s") changes nothing and saves nothing',
    value => {
      story(
        update,
        given(listening()),
        message(Message.UpdatedA4Input({ value })),
        Command.expectNone(),
        model(next => {
          expect(next.a4).toBe(440)
          expect(next.a4Input).toBe(value)
        }),
      )
    },
  )

  // Typing 442 arrives as "4", then "44", then "442". The first two are out
  // of range, so only the third applies and there is exactly one save. The
  // `Command.expectNone()` steps say so in the open. Rule 1 in the header
  // would catch a stray save too: the next `message` would refuse to run
  // with a Command still pending.
  test('a valid value after junk still applies, and saves once', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '4' })),
      Command.expectNone(),
      message(Message.UpdatedA4Input({ value: '44' })),
      Command.expectNone(),
      message(Message.UpdatedA4Input({ value: '442' })),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
      model(next => {
        expect(next.a4).toBe(442)
      }),
    )
  })

  // A valid value equal to the A4 already in use is not a change, so it is
  // not written to storage again.
  test('retyping the applied value does not save again', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '440' })),
      Command.expectNone(),
      model(next => {
        expect(next.a4).toBe(440)
      }),
    )
  })

  // `SavePreferences` declares two result Messages, and the test chooses
  // which one happened. Here the save failed, as it does when site storage is
  // blocked. The new A4 still applies for this visit: it is just not
  // remembered. There is no `expectExact` before the `resolve` because
  // `resolve` is itself the check that a save was asked for: it fails when no
  // `SavePreferences` is pending.
  test('a failed save leaves the choice in place for the page', () => {
    story(
      update,
      given(listening()),
      message(Message.UpdatedA4Input({ value: '442' })),
      Command.resolve(SavePreferences, Message.FailedSavePreferences()),
      model(next => {
        expect(next.a4).toBe(442)
        expect(next.a4Input).toBe('442')
      }),
    )
  })

  // This test crosses into a component. The A4 menu is a Foldkit UI Popover
  // with its own Model, Messages and update. Its Messages reach the app's
  // `update` wrapped in a parent Message: `GotA4PopoverMessage({ message })`
  // carries the Popover's own `RequestedClose`. `update` hands the inner
  // Message to the Popover's update, and the Popover answers with an
  // OutMessage, `Closed`. An OutMessage is how a component tells its parent
  // that something happened. `main.ts` reacts to `Closed` by putting the
  // applied A4 back in the field, so junk left there ("39") is gone the next
  // time the menu opens.
  test('closing the A4 menu puts the applied value back in the field', () => {
    // `Popover.open(model)` returns the same shape as an update, so `.model`
    // is the Popover's Model in its open state. The fixture needs it open:
    // asking a closed Popover to close does nothing.
    const opened = Popover.open(offModel.a4Popover)
    const withOpenMenu = modifyFields(listening(), {
      a4Popover: () => opened.model,
      a4Input: () => '39',
    })

    story(
      update,
      given(withOpenMenu),
      message(
        Message.GotA4PopoverMessage({
          message: Popover.Message.RequestedClose(),
        }),
      ),
      model(next => {
        expect(next.a4Input).toBe('440')
        expect(next.a4).toBe(440)
      }),
      // Closing this Popover returns a Command of the Popover's own,
      // `FocusButton`, which moves the keyboard focus back to its button.
      // Rule 1 in the header says it must be resolved. `Command.resolveAll`
      // takes `[definition, resultMessage]` pairs, and each pair resolves
      // one pending Command that it matches. Two things to know:
      //
      // 1. The result Message is the Popover's own
      //    (`Popover.Message.CompletedFocusButton()`), not wrapped in
      //    `GotA4PopoverMessage`. The Command remembers the wrapping its
      //    parent gave it, and Story applies that wrapping when it resolves.
      // 2. A pair that matches nothing is not an error. Only `FocusButton` is
      //    pending here. `UnlockScroll` and `RestoreInert` are returned only
      //    by a modal Popover, and this one is created without `isModal`
      //    (`init` in `main.ts`), so their pairs go unused. When the list
      //    should also be a claim about what `update` returned, put
      //    `Command.expectExact` before it or use `Command.resolveAllExact`,
      //    which fails on an unused pair.
      Command.resolveAll(
        [Popover.FocusButton, Popover.Message.CompletedFocusButton()],
        [Popover.UnlockScroll, Popover.Message.CompletedUnlockScroll()],
        [Popover.RestoreInert, Popover.Message.CompletedRestoreInert()],
      ),
    )
  })
})

// The tuning picker is a Foldkit UI Listbox, wired in the same way as the
// Popover above. Choosing an item arrives as the Listbox's `SelectedItem`
// Message, wrapped in `GotTuningListboxMessage`. The Listbox answers with a
// `Selected` OutMessage, and `main.ts` reacts to that by storing the tuning
// and returning a `SavePreferences` Command.
describe('tuning', () => {
  test('choosing a tuning from the picker applies it and saves', () => {
    story(
      update,
      given(listening()),
      message(
        Message.GotTuningListboxMessage({
          message: Listbox.Message.SelectedItem({ item: 'bass' }),
        }),
      ),
      model(next => {
        expect(next.tuningId).toBe('bass')
      }),
      // `Command.expectHas(...)` passes if the listed Command is among the
      // pending ones. Unlike `expectExact` it allows others beside it, which
      // leaves room for the Commands a Listbox returns when it closes.
      Command.expectHas(SavePreferences({ tuningId: 'bass', a4: 440 })),
      // The first pair resolves the save. The other three name the Listbox's
      // closing Commands, each with the Listbox's own result Message. In
      // this story the Listbox starts closed (the Model comes from `init`),
      // so it has nothing to close: the save is the only pending Command and
      // those three pairs go unused, which `resolveAll` allows. In the
      // browser a person chooses from an open list, and closing it returns
      // `FocusButton` as well.
      Command.resolveAll(
        [SavePreferences, Message.SucceededSavePreferences()],
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [Listbox.UnlockScroll, Listbox.Message.CompletedUnlockScroll()],
        [Listbox.RestoreInert, Listbox.Message.CompletedRestoreInert()],
      ),
    )
  })

  // The save carries the A4 from the Model (442 here), not the default.
  // Choosing a tuning must not reset the other preference.
  test('the chosen tuning is saved with the current A4', () => {
    story(
      update,
      given(modifyFields(listening(), { a4: () => 442 })),
      message(
        Message.GotTuningListboxMessage({
          message: Listbox.Message.SelectedItem({ item: 'drop-d' }),
        }),
      ),
      Command.expectHas(SavePreferences({ tuningId: 'drop-d', a4: 442 })),
      Command.resolveAll(
        [SavePreferences, Message.SucceededSavePreferences()],
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [Listbox.UnlockScroll, Listbox.Message.CompletedUnlockScroll()],
        [Listbox.RestoreInert, Listbox.Message.CompletedRestoreInert()],
      ),
    )
  })
})

// Routing: which page is showing. The route is a field of the Model, and two
// Messages from the runtime move it (src/main.ts, ROUTING in the header):
//   - `ClickedLink`, when a link in the page is clicked. `update` answers
//     with a Command that changes the address. The route does not change yet.
//   - `ChangedUrl`, when the address has changed, for any reason: that
//     Command, or the browser's back and forward buttons. This is the one
//     place the route is set.
// A story has no browser and no address bar, so each half is tested on its
// own, and the tests send `ChangedUrl` by hand.
describe('routing', () => {
  // `init` reads the address the app was opened at, so a visitor who opens
  // the how-to page directly lands on it.
  test('the app starts on the page its address names', () => {
    expect(init(tunerUrl).model.route).toEqual(AppRoute.Tuner())
    expect(init(howToUrl).model.route).toEqual(AppRoute.HowTo())
    expect(init(urlOf('http://localhost/nope')).model.route).toEqual(
      AppRoute.NotFound({ path: '/nope' }),
    )
  })

  // An internal link is one to an address of this app. The runtime has
  // already stopped the browser from loading it, and `update` asks for the
  // address to change without a page load. `expectExact` says this is the
  // only Command.
  test('clicking a link to one of our pages changes the address, and nothing else', () => {
    story(
      update,
      given(offModel),
      message(
        Message.ClickedLink({
          request: UrlRequest.Internal({ url: howToUrl }),
        }),
      ),
      model(next => {
        expect(next).toEqual(offModel)
      }),
      // The address is written out, not printed with the function `update`
      // uses, so the test would catch that function printing it wrongly.
      Command.expectExact(NavigateInternal({ url: 'http://localhost/how-to' })),
      Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
    )
  })

  // An external link goes to another site, which only a full page load can
  // reach. The app has no such link today. The case is handled because the
  // runtime reports every link click, and `UrlRequest` has two variants.
  test('clicking a link to another site loads it', () => {
    story(
      update,
      given(offModel),
      message(
        Message.ClickedLink({
          request: UrlRequest.External({ href: 'https://example.org/' }),
        }),
      ),
      model(next => {
        expect(next).toEqual(offModel)
      }),
      Command.expectExact(LoadExternal({ href: 'https://example.org/' })),
      Command.resolve(LoadExternal, Message.CompletedLoadExternal()),
    )
  })

  // Leaving the tuner's page switches the tuner off, whatever it was doing,
  // and wherever the address went: the how-to page, or an address the app
  // does not have. `Off` is what makes the runtime release the microphone
  // (the managed resource, tested above under 'microphone requirement'), so
  // no microphone stays open on a page that shows no tuner. A failure
  // message is cleared the same way.
  //
  // The one Command is `FocusPageHeading`: see the next test.
  describe.each([
    ['the how-to page', howToUrl, AppRoute.HowTo()],
    [
      'the built-with page',
      urlOf('http://localhost/built-with'),
      AppRoute.BuiltWith(),
    ],
    ['the privacy page', urlOf('http://localhost/privacy'), AppRoute.Privacy()],
    [
      'an unknown address',
      urlOf('http://localhost/nope'),
      AppRoute.NotFound({ path: '/nope' }),
    ],
  ])('leaving the tuner page for %s', (_, url, route) => {
    test.each([
      ['starting', startingModel],
      ['listening', listening({ level: 0.4 })],
      ['failed', failedModel],
      ['off', offModel],
    ])('while %s switches the tuner off', (_, start) => {
      story(
        update,
        given(start),
        message(Message.ChangedUrl({ url })),
        model(next => {
          expect(next.route).toEqual(route)
          expect(next.tuner).toEqual(TunerState.Off())
        }),
        Command.resolve(FocusPageHeading, Message.CompletedFocusPageHeading()),
      )
    })
  })

  // A page change without a page load leaves the browser where it was:
  // scrolled wherever the last page was, with focus on nothing, since the
  // link that had it is gone. A screen reader would say nothing at all. So
  // each change of page returns one Command, which scrolls to the top and
  // moves focus to the new page's heading, and a screen reader reads that
  // heading out. `expectExact` says it is the only Command.
  test.each([
    ['the tuner to the how-to page', offModel, howToUrl],
    [
      'the how-to page to the tuner',
      modifyFields(offModel, { route: () => AppRoute.HowTo() }),
      tunerUrl,
    ],
    ['the tuner to an unknown address', offModel, urlOf('http://localhost/x')],
  ])('going from %s moves focus to the new page', (_, start, url) => {
    story(
      update,
      given(start),
      message(Message.ChangedUrl({ url })),
      Command.expectExact(FocusPageHeading()),
      Command.resolve(FocusPageHeading, Message.CompletedFocusPageHeading()),
    )
  })

  // An address change that stays on the same page, such as a fragment added
  // to the address, leaves the tuner alone and moves nothing.
  test('an address change that stays on the tuner page keeps it listening', () => {
    const start = listening({ level: 0.4 })

    story(
      update,
      given(start),
      message(Message.ChangedUrl({ url: urlOf('http://localhost/#top') })),
      model(next => {
        expect(next).toEqual(start)
      }),
      Command.expectNone(),
    )
  })

  // The back button is a `ChangedUrl` with no `ClickedLink` before it. The
  // tuner comes back off: nothing switches it on but the power button.
  test('coming back to the tuner page shows it, switched off', () => {
    story(
      update,
      given(listening()),
      message(Message.ChangedUrl({ url: howToUrl })),
      Command.resolve(FocusPageHeading, Message.CompletedFocusPageHeading()),
      message(Message.ChangedUrl({ url: tunerUrl })),
      model(next => {
        expect(next.route).toEqual(AppRoute.Tuner())
        expect(next.tuner).toEqual(TunerState.Off())
      }),
      Command.resolve(FocusPageHeading, Message.CompletedFocusPageHeading()),
    )
  })

  // The three routing Commands report back when they have run. There is
  // nothing to do with the news.
  test.each([
    ['CompletedNavigateInternal', Message.CompletedNavigateInternal()],
    ['CompletedLoadExternal', Message.CompletedLoadExternal()],
    ['CompletedFocusPageHeading', Message.CompletedFocusPageHeading()],
  ])('%s changes nothing', (_, completed) => {
    story(
      update,
      given(listening()),
      message(completed),
      model(next => {
        expect(next).toEqual(listening())
      }),
      Command.expectNone(),
    )
  })
})

// A microphone that is missing, busy, or lost while the tuner is listening.
// None of the three is a fault in the app, so each gets a plain sentence and
// none is reported to Sentry (FINDINGS.md, "A missing, busy or lost
// microphone is not a fault").
describe('a missing, busy or lost microphone', () => {
  test.each([
    ['missing', MicrophoneFailure.NotFound()],
    ['busy', MicrophoneFailure.Busy()],
  ])('a %s microphone fails the start and is not reported', (_, failure) => {
    story(
      update,
      given(startingModel),
      message(Message.FailedAcquireMicrophone({ failure })),
      model(next => {
        expect(next.tuner).toEqual(TunerState.Failed({ failure }))
      }),
      Command.expectNone(),
    )
  })

  // `LostMicrophone` comes from the readings Subscription, which notices
  // that the microphone's track has ended. The tuner stops with a failure
  // that says so. `Failed` is also a state in which the microphone is not
  // required, so the runtime closes what is left of it.
  test('losing the microphone while listening stops the tuner and says why', () => {
    const lost = TunerState.Failed({ failure: MicrophoneFailure.Lost() })

    story(
      update,
      given(listening({ level: 0.4 })),
      message(Message.LostMicrophone()),
      model(next => {
        expect(next.tuner).toEqual(lost)
        expect(
          managedResources.microphone.modelToMaybeRequirements(next),
        ).toEqual(Option.none())
      }),
      Command.expectNone(),
    )
  })

  // The Message can only matter while listening. Anywhere else the tuner is
  // left as it is.
  test.each([
    ['off', offModel],
    ['starting', startingModel],
    ['failed', failedModel],
  ])('losing the microphone while %s changes nothing', (_, start) => {
    story(
      update,
      given(start),
      message(Message.LostMicrophone()),
      model(next => {
        expect(next).toEqual(start)
      }),
      Command.expectNone(),
    )
  })
})

// Leaving the tuner's page with the settings menu open. The menu is closed
// on the way out, through the Popover's own `close`, so that it ends the
// way it does when the person closes it, and the half-typed A4 is dropped.
// Before this, the menu came back open on a tuner that was switched off.
describe('leaving with the settings menu open', () => {
  test('the menu is closed and the A4 text is put back', () => {
    const opened = Popover.open(offModel.a4Popover)
    const withOpenMenu = modifyFields(listening(), {
      a4Popover: () => opened.model,
      a4Input: () => '39',
    })

    story(
      update,
      given(withOpenMenu),
      message(Message.ChangedUrl({ url: howToUrl })),
      model(next => {
        expect(next.route).toEqual(AppRoute.HowTo())
        expect(next.tuner).toEqual(TunerState.Off())
        expect(next.a4Popover.isOpen).toBe(false)
        expect(next.a4Input).toBe('440')
      }),
      Command.expectHas(FocusPageHeading()),
      // `resolveAllExact` fails if a Command listed here was not returned,
      // or if one was returned that is not listed. Closing this menu
      // returns one Command of the Popover's own, which hands focus back
      // to the menu's button. The button is gone by the time it runs, so it
      // finds nothing, and the page heading keeps the focus.
      Command.resolveAllExact(
        [FocusPageHeading, Message.CompletedFocusPageHeading()],
        [Popover.FocusButton, Popover.Message.CompletedFocusButton()],
      ),
    )
  })

  // With the menu closed there is nothing to close, and the page change
  // returns its one Command as before.
  test('a closed menu adds nothing', () => {
    story(
      update,
      given(listening()),
      message(Message.ChangedUrl({ url: howToUrl })),
      Command.expectExact(FocusPageHeading()),
      Command.resolve(FocusPageHeading, Message.CompletedFocusPageHeading()),
    )
  })
})
