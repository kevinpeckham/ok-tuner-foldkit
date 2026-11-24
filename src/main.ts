// main.ts: the application itself, as pure definitions.
//
// Foldkit is a front-end framework built on Effect and shaped like the Elm
// architecture. A Foldkit app is not a tree of components that each keep
// their own state. It is a handful of declarations that the Foldkit runtime
// drives, and this file holds all of them except the view:
//
//   Model             one immutable value holding all of the app's state
//   Message           every fact that can happen to the app, as a tagged union
//   Flags, init       the data read at start-up, and the first Model built
//                     from it
//   update            (Model, Message) -> next Model + Commands. The only
//                     place state changes, and a pure function
//   Commands          one-shot side effects, described here and run by the
//                     runtime (save the preferences, report a problem)
//   managedResources  the microphone, which exists only while the Model says
//                     the tuner is starting or listening
//   subscriptions     the stream of readings, which runs only while the Model
//                     says the tuner is listening
//
// The loop, as this app goes round it:
//
//   1. At start-up the runtime runs the `flags` Effect and calls `init` with
//      the result, which gives the first Model.
//   2. The runtime renders the Model with `view` (src/view.ts).
//   3. Something happens, and is recorded as a Message. A click on the power
//      button is ClickedPower; the microphone opening is
//      SucceededAcquireMicrophone; a reading is MeasuredInput; a finished
//      Command is SucceededSavePreferences.
//   4. The runtime calls `update` with the current Model and the Message.
//      `update` returns the next Model and, sometimes, Commands to run.
//   5. The runtime takes it from there. It renders the new Model, runs the
//      Commands, and asks the managed resource and the subscription what they
//      need under the new Model: it opens or closes the microphone, and
//      starts or stops the readings, to match.
//   6. Whatever those produce comes back as more Messages. Go to 3.
//
// So nothing in this file calls anything. `update` never opens a microphone
// and never writes to storage. It returns a Model that says the tuner is on,
// or a Command that describes the write, and the runtime does the rest. That
// is what lets src/story.test.ts test the tuner's behaviour with no
// microphone, no browser storage and no runtime.
//
// This file never starts the runtime either. FOLDKIT.md ("File Organization")
// keeps `Runtime.run` in src/entry.ts, so tests can import these definitions
// without booting an app.
//
// Reading order: FOLDKIT.md for the conventions, then src/entry.ts to see how
// the exports below are handed to the runtime, then this file, then
// src/view.ts. src/microphone.ts, src/pitch.ts and src/preferences.ts are the
// plain modules this file calls into. The design behind it all is
// docs/superpowers/specs/2026-11-24-tuner-design.md, and FINDINGS.md records
// the reasons and the gotchas.
//
// The imports, by origin. `effect` is the library Foldkit is built on.
// `foldkit` exports one namespace per concept (Command, ManagedResource,
// Subscription, Update, Runtime), and single helpers from subpaths such as
// `foldkit/message`. `@foldkit/ui` is Foldkit's set of headless, accessible
// components. The two used here, Listbox and Popover, each have their own
// Model, Message and update, and are embedded in this app as child
// components. Foldkit calls such a child a Submodel.
//
// The capitalised comments (CONSTANT, MODEL, MESSAGE, ...) are Foldkit's
// convention for finding your way round a file. A comment that starts
// "NOTE:" marks behaviour that would mislead a careful reader.

import { Duration, Effect, Option, Schema, Stream } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  Command,
  ManagedResource,
  type Runtime,
  Subscription,
  Update,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { BrowserKeyValueStore } from '@effect/platform-browser'
import { Listbox, Popover } from '@foldkit/ui'

import {
  Microphone,
  MicrophoneFailure,
  type MicrophoneService,
  WINDOW,
  acquireMicrophone,
  microphoneFailure,
  readMeasurement,
  releaseMicrophone,
} from './microphone'
import { Pitch, noteFromFrequency } from './pitch'
import {
  DEFAULT_PREFERENCES,
  Preferences,
  STORAGE_KEY,
  parseA4,
  preferencesFromJson,
  preferencesToJson,
} from './preferences'
import { reportMicrophoneProblem } from './sentry'
import { type Tuning } from './tuning'

// CONSTANT

// The numbers that set how the tuner behaves. They are the values of the
// Stem Shovel tuner this app is a port of (the tuner design, "Update: the
// tuner's behaviour").

// A cent is a hundredth of a semitone. A needle within this many cents of the
// note counts as in tune. It is exported for the view, which decides what to
// show as "in tune". `update` never reads it.
export const IN_TUNE_CENTS = 5

// A reading more than this many cents from where the needle is counts as a
// new note, and the needle jumps straight to it. See `moveNeedle`.
const NEEDLE_SNAP_CENTS = 30

// Otherwise the needle moves this fraction of the way towards each reading,
// which smooths out the small differences between one reading and the next.
const NEEDLE_SETTLE_RATIO = 0.35

// How many readings in a row may find no pitch before the display is
// cleared. At one reading every 50 ms that is about 0.6 seconds. Until then
// the display holds the last note. See `hearNothing`.
const QUIET_TICKS_HELD = 12

// How often the subscription reads the microphone: twenty times a second.
// `Duration` is Effect's type for a span of time. It is used in place of a
// bare number so that the unit cannot be mistaken.
const READING_INTERVAL = Duration.millis(50)

// MODEL

// The Model is all of the app's state in one immutable value. In Foldkit it
// is declared as an Effect Schema, not as a TypeScript type. A Schema is a
// description of a shape that exists at runtime, and the TypeScript type is
// derived from it (the `typeof X.Type` lines below), so the compiler and the
// running app share one definition. Foldkit needs the runtime half: in
// development it encodes the Model before a reload and decodes it afterwards,
// to carry the state across. FOLDKIT.md requires every field of the Model to
// be a Schema.

// The tuner's power state, and the app's state machine.
//
// `defineTaggedUnion` (from `foldkit/schema`) declares a discriminated union
// in one object. Each key is the tag of a variant, and its value lists that
// variant's fields as Schemas. What comes back is three things in one:
//   - a Schema for the whole union, which can be a field of the Model;
//   - a constructor for each variant. `TunerState.Off()` gives
//     `{ _tag: 'Off' }`, and `TunerState.Failed({ failure })` gives
//     `{ _tag: 'Failed', failure }`;
//   - `TunerState.match(value, { Off, Starting, Listening, Failed })`, which
//     calls the handler for the variant the value is. Every variant must have
//     a handler, so adding a fifth state is a compile error at every `match`
//     until it is handled.
//
// The four states:
//   Off        the tuner is off and the microphone is closed
//   Starting   the button was pressed, and the permission prompt or the
//              start of the audio is pending
//   Listening  the microphone is open and readings are arriving
//   Failed     the microphone could not be opened; carries the reason
//
// The transitions. `update` below makes every one of them, and nothing else
// can:
//   Off, Failed  --ClickedPower-->                Starting
//   Starting     --SucceededAcquireMicrophone-->  Listening
//   Starting     --FailedAcquireMicrophone-->     Failed
//   Listening    --MeasuredInput-->               Listening (new values)
//   Listening    --ClickedPower-->                Off
//   Listening    --FailedAcquireMicrophone-->     Failed (see `update`)
//
// It is one union and not a set of booleans such as `isOn` and `isStarting`,
// so that a state which makes no sense (starting and failed at once) cannot
// be written at all (FOLDKIT.md, "Code Style").
export const TunerState = defineTaggedUnion({
  Off: {},
  Starting: {},
  Listening: {
    // How loud the input is, from 0 to 1. The view draws it as the level bar.
    level: Schema.Number,
    // The latest pitch heard, if there is one. `Schema.Option(Pitch)` is the
    // Schema of an Effect `Option`: a value that is either
    // `Option.some(pitch)` or `Option.none()`, used in place of null. By
    // Foldkit's convention the name of such a value starts with `maybe`.
    maybeReading: Schema.Option(Pitch),
    // Where the needle is drawn, in cents from the nearest note. It is a
    // smoothed value, not the latest reading: see `moveNeedle`.
    needleCents: Schema.Number,
    // How many readings in a row have found no pitch. See `hearNothing`.
    quietTicks: Schema.Number,
  },
  // `MicrophoneFailure` is itself a tagged union, declared in
  // src/microphone.ts: Refused, Unsupported or Unexpected.
  Failed: { failure: MicrophoneFailure },
})
// The same name is declared twice on purpose: above as a value (the Schema,
// with its constructors and `match`) and here as a type (the shape of one
// state). TypeScript keeps values and types apart, and Foldkit code pairs
// them like this everywhere.
export type TunerState = typeof TunerState.Type

// The type of the Listening variant alone, for the helpers that take one.
type Listening = typeof TunerState.Listening.Type

// The tuning picker is a Listbox from `@foldkit/ui`. `Listbox.create<Tuning>()`
// returns that component's `view` and `update`, both bound to the type of the
// items it lists, so the two cannot disagree about it. It is created once,
// here. `update` below uses `TuningListbox.update`, and src/view.ts uses
// `TuningListbox.view`.
export const TuningListbox = Listbox.create<Tuning>()

// The Model: these six fields are all the state the app has.
//
// What is not here matters as much. The note's name, its octave, the cents
// label, "in tune" and the nearest string are not stored. The view works them
// out from these fields on every render (the tuner design, "Model"), so they
// can never disagree with them.
export const Model = Schema.Struct({
  // The power state above.
  tuner: TunerState,
  // The id of the chosen tuning, such as 'standard' (src/tuning.ts).
  tuningId: Schema.String,
  // The frequency of the note A4 in Hz, which every other note is measured
  // from. 440 unless the person changes it.
  a4: Schema.Number,
  // The text in the A4 field, exactly as typed. It is kept apart from `a4`
  // because a half-typed or out-of-range value ("44", "500") has to stay on
  // screen without being applied. Foldkit has no two-way binding: the view
  // sets the field's value from this on every render, and typing sends an
  // UpdatedA4Input Message that changes it.
  a4Input: Schema.String,
  // The Models of the two child components. Each holds only the component's
  // own interaction state, such as whether it is open. What is selected
  // belongs to this app: it is `tuningId` above.
  tuningListbox: Listbox.Model,
  a4Popover: Popover.Model,
})
export type Model = typeof Model.Type

// MESSAGE

// A Message is a fact: something that has happened, never an instruction.
// ClickedPower says the button was clicked. It is `update` that decides
// whether that turns the tuner on or off. Every change to the Model starts as
// one of these.
//
// `defineMessageUnion` (from `foldkit/message`) is written like
// `defineTaggedUnion` above: one object, one key per variant, the fields as
// Schemas. It returns a Schema for the union, a constructor for each variant
// (`Message.ClickedPower()`, `Message.UpdatedA4Input({ value })`) and an
// exhaustive `Message.match`. A constructor is always called through
// `Message.` and never pulled out on its own, so the call shows which union
// the name belongs to.
//
// The names follow Foldkit's convention (FOLDKIT.md, "Message Layout"): a
// verb in the past tense comes first, and it says where the fact came from.
//   Clicked*, Updated*    the person did something in the view
//   Succeeded*, Failed*   the two outcomes of work that can go wrong
//   Completed*            the result of a Command with nothing more to say
//                         than that it ran
//   Got*Message           a Message from a child component, wrapped so that
//                         it can pass through this app's `update`. The
//                         DevTools use this name to filter by component.
// The result of a Command is named after the Command: SavePreferences ends
// in SucceededSavePreferences or FailedSavePreferences, and ReportProblem in
// CompletedReportProblem.
//
// There is no "NoOp" Message, and FOLDKIT.md forbids one. Four of the
// Messages below change nothing in the Model (ReleasedMicrophone, the two
// results of SavePreferences, CompletedReportProblem). Each still says what
// happened, so the Message history in the Foldkit DevTools reads as a record
// of events.
export const Message = defineMessageUnion({
  // From the view: the power button was clicked.
  ClickedPower: {},
  // The next three come from the managed resource (see MANAGED RESOURCE).
  // The microphone opened.
  SucceededAcquireMicrophone: {},
  // The microphone could not be opened. `failure` says why.
  FailedAcquireMicrophone: { failure: MicrophoneFailure },
  // The microphone was closed again.
  ReleasedMicrophone: {},
  // From the subscription (see SUBSCRIPTION), twenty times a second while
  // listening: how loud the input is, and its pitch if one was found.
  MeasuredInput: { level: Schema.Number, maybePitch: Schema.Option(Pitch) },
  // From the two child components. Each wraps one of the child's own
  // Messages, whose Schema is the type of the `message` field.
  GotTuningListboxMessage: { message: Listbox.Message },
  GotA4PopoverMessage: { message: Popover.Message },
  // From the view: the text in the A4 field changed.
  UpdatedA4Input: { value: Schema.String },
  // From the SavePreferences Command: the write worked, or it did not.
  SucceededSavePreferences: {},
  FailedSavePreferences: {},
  // From the ReportProblem Command: it ran.
  CompletedReportProblem: {},
})
export type Message = typeof Message.Type

// INIT

// Flags are Foldkit's name for data handed to the app at start-up, before
// there is a Model. Here they are the saved preferences. They come in two
// parts:
//   - `Flags`, a Schema for their shape. Passing it to
//     `Runtime.makeApplication` (src/entry.ts) is what makes `init` take the
//     flags as its argument.
//   - `flags`, an Effect that produces a value of that shape. It is passed
//     to `Runtime.run`, and the runtime runs it before it calls `init`.
// Reading localStorage is a side effect, and `init` is a pure function like
// `update`, so the read cannot happen there. Flags are where a side effect
// at start-up belongs.

// NOTE: with site data blocked, reading `localStorage` throws while the
// storage layer is being built, outside the typed error channel. Both the
// flags and SavePreferences therefore provide the layer first and catch the
// whole cause after it, so blocked storage means default preferences and an
// unsaved choice, never a crash.
export const Flags = Schema.Struct({ preferences: Preferences })
export type Flags = typeof Flags.Type

// An `Effect.Effect<A>` is a description of a computation that produces an
// `A` when it is run. Nothing below runs when this module is loaded: `flags`
// is a value, and the runtime runs it. The annotation `Effect.Effect<Flags>`
// leaves the type's other two slots, for errors and for requirements, at
// their default of `never`: this Effect cannot fail, and needs nothing
// supplied to it. The two steps of the `.pipe(...)` are what make that true.
//
// `Effect.gen(function* () { ... })` writes an Effect in the style of
// async/await. `yield*` runs another Effect and gives back its result.
//   - `yield* KeyValueStore.KeyValueStore` asks for a service. This is
//     Effect's dependency injection: the code says "whichever key-value store
//     has been provided" and does not name localStorage.
//   - `store.get(key)` is an Effect that gives the stored string, or
//     undefined. `Option.fromNullishOr` turns that into an `Option`.
//   - `preferencesFromJson` (src/preferences.ts) checks what it is given and
//     falls back to the default for anything missing or damaged.
//
// `x.pipe(a, b)` passes `x` through `a`, then the result through `b`.
//   - `Effect.provide(layer)` supplies the service asked for above. A Layer
//     is a recipe for building a service. This one builds a KeyValueStore on
//     the browser's localStorage.
//   - `Effect.catchCause` recovers from anything that went wrong in the
//     steps before it. A "cause" covers typed failures (the store's own
//     error) and also defects (something threw), which `Effect.catch` would
//     not see. Whatever happened, the app starts with the defaults.
// The order of the two steps matters, for the reason in the NOTE above.
export const flags: Effect.Effect<Flags> = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  const maybeJson = Option.fromNullishOr(yield* store.get(STORAGE_KEY))

  return { preferences: preferencesFromJson(maybeJson) }
}).pipe(
  Effect.provide(BrowserKeyValueStore.layerLocalStorage),
  Effect.catchCause(() => Effect.succeed({ preferences: DEFAULT_PREFERENCES })),
)

// The text shown in the A4 field for an applied value.
const a4ToInput = (a4: number): string => `${a4}`

// `init` builds the first Model. Its type, `Runtime.ApplicationInit<Model,
// Message, Flags>`, is a function from the Flags to the same kind of record
// that `update` returns: `{ model }`, with `commands` beside it if anything
// should run at start-up. Nothing needs to here. The tuner starts Off, and
// the microphone opens only when the person asks for it.
//
// `Listbox.init` and `Popover.init` build the first Models of the two child
// components. The `id` is the component's own: it builds the ids of its
// elements from it, and src/view.ts places the component by it.
//
// In development `init` may not run after a reload, because Foldkit restores
// the Model it saved instead. See the NOTE under SUBSCRIPTION.
export const init: Runtime.ApplicationInit<Model, Message, Flags> = ({
  preferences,
}) => ({
  model: {
    tuner: TunerState.Off(),
    tuningId: preferences.tuningId,
    a4: preferences.a4,
    a4Input: a4ToInput(preferences.a4),
    tuningListbox: Listbox.init({ id: 'tuning' }),
    a4Popover: Popover.init({ id: 'a4' }),
  },
})

// COMMAND

// A Command is a side effect described as data. `update` is pure, so it
// cannot write to storage or call Sentry. It returns a Command instead, and
// the runtime runs it and sends the result back into `update` as a Message.
// In a Foldkit app, side effects live only in what the runtime runs: here
// the Commands, the flags, the managed resource and the subscription. That
// rule is what keeps `update` testable: a test checks which Commands came
// back, and does not have to run them.
//
// `Command.define(name, { args, messages, execute })` defines one:
//   - the name is what the Foldkit DevTools, tests and traces show;
//   - `args` declares, as Schemas, the inputs that differ from one use to the
//     next (leave it out for a Command that takes none);
//   - `messages` lists every Message the Command may end with, and the
//     compiler holds `execute` to that list;
//   - `execute` receives the args and returns the Effect that does the work
//     and succeeds with one of those Messages.
// What `define` returns is a function. Calling it, as in
// `SavePreferences({ tuningId, a4 })`, runs nothing. It returns a small
// record (the name, the args and the Effect) for `update` to put in its
// `commands` list. Foldkit does not even evaluate the body of `execute`
// until the runtime runs the Command.
//
// A Command must not fail. The types insist on part of it: `update` may only
// return Commands whose Effect has no typed failure left in it. A defect
// that still escaped would count as a crash, and the runtime would replace
// the page with its crash screen. So each `execute` ends by catching
// everything and turning it into a Message.

// Writes the chosen tuning and A4 to localStorage, so that the next visit
// starts with them. The args are the two values to save, which `update`
// takes from the Model. In the `messages` list,
// `Message.SucceededSavePreferences` has no call brackets: each constructor
// is also the Schema of its variant, and it is the Schema that is listed.
//
// The body mirrors `flags` above. Ask for the store, write, and say that it
// worked; then provide the localStorage layer; then catch everything. A
// write that fails (storage blocked or full) becomes FailedSavePreferences,
// which `update` ignores: the choice still holds for this visit.
export const SavePreferences = Command.define('SavePreferences', {
  args: { tuningId: Schema.String, a4: Schema.Number },
  messages: [Message.SucceededSavePreferences, Message.FailedSavePreferences],
  execute: preferences =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set(STORAGE_KEY, preferencesToJson(preferences))

      return Message.SucceededSavePreferences()
    }).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage),
      Effect.catchCause(() => Effect.succeed(Message.FailedSavePreferences())),
    ),
})

// Sends a microphone fault to Sentry. It is a Command, and not a call made
// where the error is caught, so that the decision to report is `update`'s,
// shows in the DevTools history and is tested like any other Command
// (FINDINGS.md, "A caught failure is reported by a Command, not where it is
// caught").
//
// `Effect.sync` wraps a synchronous function that has a side effect.
// `Effect.as` replaces its result with the Message. There is one result
// Message and not a Succeeded and Failed pair, because the app would do
// nothing different if the report failed. Hence the `Completed` name, and
// the same Message again from the `catchCause`.
export const ReportProblem = Command.define('ReportProblem', {
  args: { name: Schema.String, detail: Schema.String },
  messages: [Message.CompletedReportProblem],
  execute: problem =>
    Effect.sync(() => reportMicrophoneProblem(problem)).pipe(
      Effect.as(Message.CompletedReportProblem()),
      Effect.catchCause(() => Effect.succeed(Message.CompletedReportProblem())),
    ),
})

// UPDATE

// Everything from here down to `update` is a helper for it. All of them are
// pure: they take values and return new ones.

// The Listening state as the tuner enters it: silent, nothing heard, the
// needle in the centre.
const freshListening = (): TunerState =>
  TunerState.Listening({
    level: 0,
    maybeReading: Option.none(),
    needleCents: 0,
    quietTicks: 0,
  })

// Needle smoothing. `needleCents` is where the needle is now, and `cents` is
// where the newest reading puts it.
//   - More than NEEDLE_SNAP_CENTS apart: a new note has been played, so the
//     needle jumps straight to it.
//   - Otherwise it is the same note settling, and the needle moves
//     NEEDLE_SETTLE_RATIO (35%) of the remaining distance. Repeated twenty
//     times a second, that closes in on a held note quickly and damps the
//     small differences between readings.
const moveNeedle = (needleCents: number, cents: number): number =>
  Math.abs(cents - needleCents) > NEEDLE_SNAP_CENTS
    ? cents
    : needleCents + (cents - needleCents) * NEEDLE_SETTLE_RATIO

// A reading that found a pitch, while Listening. It returns the next
// Listening state: the new level and pitch, the needle moved towards the new
// reading, and the count of quiet readings back at zero.
//
// `noteFromFrequency(frequency, a4).cents` (src/pitch.ts) is how far the
// pitch is from the nearest note, from -50 to 50 cents, with A4 at the
// frequency the person chose. Only the needle is stored. The view works the
// note's name out again from `maybeReading`.
const hearPitch = (
  listening: Listening,
  a4: number,
  level: number,
  pitch: Pitch,
): TunerState =>
  TunerState.Listening({
    level,
    maybeReading: Option.some(pitch),
    needleCents: moveNeedle(
      listening.needleCents,
      noteFromFrequency(pitch.frequency, a4).cents,
    ),
    quietTicks: 0,
  })

// A reading that found no pitch, while Listening: silence, or sound with no
// clear note in it. The display does not go blank the moment a note fades.
// The last note and the needle are held until more than QUIET_TICKS_HELD
// readings in a row (about 0.6 seconds) have been quiet. Then the reading is
// cleared and the needle goes back to the centre. The level is updated
// either way, so the level bar keeps moving.
const hearNothing = (listening: Listening, level: number): TunerState => {
  const quietTicks = listening.quietTicks + 1

  return quietTicks > QUIET_TICKS_HELD
    ? TunerState.Listening({
        level,
        maybeReading: Option.none(),
        needleCents: 0,
        quietTicks,
      })
    : TunerState.Listening({
        level,
        maybeReading: listening.maybeReading,
        needleCents: listening.needleCents,
        quietTicks,
      })
}

// Returns a copy of the Model with a new power state.
//
// `modifyFields` (from `foldkit/struct`) is how Foldkit code changes a
// Model. It takes a record and, for each field to change, a function from
// the old value to the new one. It returns a new record with the other
// fields carried over. The Model is never mutated, and FOLDKIT.md rules out
// object spread for this. (In development Foldkit freezes the Model, so a
// mutation by accident throws.) Here the function ignores the old value.
const withTuner = (model: Model, tuner: TunerState): Model =>
  modifyFields(model, { tuner: () => tuner })

// Moves the tuner to Failed, and decides whether the failure is reported.
//
// `Update.Return<Model, Message>` is the type of what `update` returns: a
// record with the next `model` and, optionally, `commands`, the list of
// Commands for the runtime to run. `commands` is left out where there are
// never any. Here the list is worked out, and may be empty.
//
// `MicrophoneFailure` is a tagged union, so its `match` has one branch for
// each kind of failure. Only the unexpected kind returns a Command.
//
// NOTE: a refusal and an unsupported browser are the person's own situation,
// so they are not reported. Anything else means something is broken.
const failWith = (
  model: Model,
  failure: MicrophoneFailure,
): Update.Return<Model, Message> => ({
  model: withTuner(model, TunerState.Failed({ failure })),
  commands: MicrophoneFailure.match(failure, {
    Refused: () => [],
    Unsupported: () => [],
    Unexpected: ({ name, detail }) => [ReportProblem({ name, detail })],
  }),
})

// The next four declarations wire the two child components into `update`.
//
// A child component in Foldkit (a Submodel) has its own Model, Message and
// update. The parent's part is always the same three things. It keeps the
// child's Model as a field of its own (`tuningListbox`). It wraps the child's
// Messages in a Message of its own (`GotTuningListboxMessage`). And when
// such a Message arrives, it hands the inner Message to the child's update
// and stores the result. `Update.foldChild` writes that last step.
//
// A child cannot change the parent's Model. When something happens that the
// parent should know of, the child's update returns an OutMessage beside its
// Model and Commands: a fact for the parent, such as the Listbox's
// `Selected({ value })`. The parent decides what the fact means.

// What this app does with the Listbox's OutMessages.
//
// `Listbox.OutMessage.match`, given only the handlers, returns a function
// from an OutMessage to whatever the handlers return. The type argument says
// that is an `Update.Step<Model, Message>`: a function from a Model to an
// `Update.Return`. So each handler has two arrows. The first receives the
// OutMessage. The second receives the parent Model, with the child's new
// Model already stored in it, and returns the next Model and Commands.
//
// The Listbox has one OutMessage, `Selected`: the person picked an item.
// `value` is the id of the tuning. The Listbox does not remember what is
// selected. This app does, in `tuningId`, and saves it.
const foldTuningListboxOutMessage = Listbox.OutMessage.match<
  Update.Step<Model, Message>
>({
  Selected:
    ({ value }) =>
    model => ({
      model: modifyFields(model, { tuningId: () => value }),
      commands: [SavePreferences({ tuningId: value, a4: model.a4 })],
    }),
})

// `Update.foldChild` takes the facts about one child and returns a function,
// `foldTuningListbox(model, childMessage)`, that does the whole delegation
// and returns an `Update.Return` for the parent.
//   - `read` finds the child's Model in the parent's. It returns an Option
//     because some children are not always there (a page behind a route, for
//     one). This child always is, hence `Option.some`.
//   - `update` is the child's own update. foldChild runs it on that Model
//     and the child's Message.
//   - `write` stores the child's next Model back in the parent's.
//   - `toParentMessage` wraps a child Message as a parent one. The child's
//     update may return Commands of its own (the Listbox moves focus, for
//     example), and their result Messages are the child's. foldChild wraps
//     each with this, so they come back through `update` below.
//   - `foldOutMessage` is called when the child's update returned an
//     OutMessage. Its Step runs last, and its Commands follow the child's.
const foldTuningListbox = Update.foldChild({
  update: TuningListbox.update,
  read: (model: Model) => Option.some(model.tuningListbox),
  write: (model, nextTuningListbox) =>
    modifyFields(model, { tuningListbox: () => nextTuningListbox }),
  toParentMessage: message => Message.GotTuningListboxMessage({ message }),
  foldOutMessage: foldTuningListboxOutMessage,
})

// The same again for the A4 popover, which reports `Opened` and `Closed`.
// Opening needs nothing from this app, but `match` is exhaustive, so it has
// a handler that returns the Model as it is. Closing puts the applied A4
// back in the field, which discards anything typed that was not valid (the
// tuner design, "Controls").
const foldA4PopoverOutMessage = Popover.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, { a4Input: () => a4ToInput(model.a4) }),
  }),
})

// `Popover.update` is used directly. Unlike the Listbox, the Popover lists
// no items, so there is no item type to bind it to with a `create`.
const foldA4Popover = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.a4Popover),
  write: (model, nextA4Popover) =>
    modifyFields(model, { a4Popover: () => nextA4Popover }),
  toParentMessage: message => Message.GotA4PopoverMessage({ message }),
  foldOutMessage: foldA4PopoverOutMessage,
})

// The return type of `update`, given a name because `applyA4Input` shares it
// (FOLDKIT.md, "Update").
//
// The third type argument lists the services that Commands may need from the
// runtime. `MicrophoneService` stands for the Microphone managed resource.
// No Command in this file asks for it, but `Runtime.makeApplication` takes
// the app's set of services from this type and holds the subscription to the
// same set. Leave the argument out and src/entry.ts stops compiling, because
// the subscription below does need the Microphone.
type UpdateReturn = Update.Return<Model, Message, MicrophoneService>

// The text in the A4 field changed.
//   1. The text is stored as typed (`typed`), valid or not, so that the
//      field shows what the person wrote.
//   2. `parseA4` (src/preferences.ts) gives `Option.some(number)` for a
//      number from 400 to 480, and `Option.none()` for anything else.
//      `Option.filter` then drops a value equal to the A4 already applied,
//      so nothing is saved when nothing changed.
//   3. `Option.match` handles the two cases: nothing to apply, or a new A4
//      to store and to save.
const applyA4Input = (model: Model, value: string): UpdateReturn => {
  const typed = modifyFields(model, { a4Input: () => value })
  const maybeNextA4 = Option.filter(parseA4(value), a4 => a4 !== model.a4)

  return Option.match(maybeNextA4, {
    onNone: () => ({ model: typed }),
    onSome: nextA4 => ({
      model: modifyFields(typed, { a4: () => nextA4 }),
      commands: [SavePreferences({ tuningId: model.tuningId, a4: nextA4 })],
    }),
  })
}

// `update` is the heart of the app: the one function that decides what each
// Message means. The runtime calls it with the current Model and a Message,
// one Message at a time, and takes back the next Model and any Commands. It
// is pure: the same inputs give the same result, and nothing else is touched.
//
// `Message.match<UpdateReturn>(message, { ... })` calls the handler named
// after the Message's tag and passes it the Message, so a handler can
// destructure the payload (`({ level, maybePitch }) => ...`). Every variant
// must have a handler, and the type argument makes every handler return an
// UpdateReturn. Add a Message to the union and this stops compiling until it
// is handled here. FOLDKIT.md asks for `match` and never `switch`.
//
// A handler that returns `{ model }` with the Model it was given is saying
// that the fact is noted and nothing changes. The runtime compares the Model
// it gets back with the one it passed in, by identity, and when they are the
// same object it does not render again.
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    // The power button. What a click means depends on the state the tuner is
    // in, so this is a `match` inside a `match`. Note what is absent: nothing
    // here opens or closes a microphone. Moving to Starting is enough,
    // because the managed resource below requires the microphone in that
    // state and the runtime opens it. Moving to Off is what closes it.
    ClickedPower: () => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: () => TunerState.Starting(),
          // Already starting, so a second click changes nothing. The view
          // also disables the button in this state.
          Starting: starting => starting,
          Listening: () => TunerState.Off(),
          // Try again after a failure.
          Failed: () => TunerState.Starting(),
        }),
      ),
    }),

    // The managed resource says the microphone is open. A tuner that is
    // Starting moves on to a fresh Listening state. In every other state the
    // Message changes nothing, though `match` still needs a handler for
    // each. Already Listening is the development case described in the NOTE
    // under SUBSCRIPTION.
    SucceededAcquireMicrophone: () => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: off => off,
          // The handler is `freshListening` itself, which takes no notice
          // of the value it is passed.
          Starting: freshListening,
          Listening: listening => listening,
          Failed: failed => failed,
        }),
      ),
    }),

    // The managed resource says the microphone could not be opened. While
    // Starting this is the expected way to fail: move to Failed, and report
    // it if it is a fault (`failWith`). Listening is possible for the same
    // development reason as above. While Off or already Failed the Message
    // is ignored. These handlers return a whole UpdateReturn and not just a
    // TunerState, because two of them may carry a Command.
    FailedAcquireMicrophone: ({ failure }) =>
      TunerState.match(model.tuner, {
        Off: () => ({ model }),
        Starting: () => failWith(model, failure),
        Listening: () => failWith(model, failure),
        Failed: () => ({ model }),
      }),

    // The managed resource says the microphone was closed. The release is a
    // consequence of the Model changing, not a cause of it, so there is
    // nothing left to change. The Message exists all the same: a managed
    // resource must name a Message for this, and it records the fact.
    ReleasedMicrophone: () => ({ model }),

    // A reading from the subscription. It matters only while Listening,
    // where `Option.match` sends it one of two ways: no pitch was found, or
    // one was. In every other state the tuner is returned as it was.
    // `model.a4` is passed in because the same frequency is a different
    // number of cents from the note when A4 is moved.
    MeasuredInput: ({ level, maybePitch }) => ({
      model: withTuner(
        model,
        TunerState.match(model.tuner, {
          Off: off => off,
          Starting: starting => starting,
          Listening: listening =>
            Option.match(maybePitch, {
              onNone: () => hearNothing(listening, level),
              onSome: pitch => hearPitch(listening, model.a4, level, pitch),
            }),
          Failed: failed => failed,
        }),
      ),
    }),

    // A Message from a child component. Unwrap it and let the fold defined
    // above run the child's update. `update` never looks inside `message`:
    // what it means is the child's business.
    GotTuningListboxMessage: ({ message }) => foldTuningListbox(model, message),

    GotA4PopoverMessage: ({ message }) => foldA4Popover(model, message),

    // The A4 field changed: see `applyA4Input`.
    UpdatedA4Input: ({ value }) => applyA4Input(model, value),

    // The results of the two Commands. None of them changes the Model. A
    // failed save is not reported to Sentry, on purpose: blocked storage is
    // the person's own choice, and the app cannot tell it from any other
    // storage fault (the Sentry design, "Caught failures: the microphone").
    SucceededSavePreferences: () => ({ model }),

    FailedSavePreferences: () => ({ model }),

    CompletedReportProblem: () => ({ model }),
  })

// MANAGED RESOURCE

// A managed resource is a live handle whose lifetime follows the Model. Here
// it is the open microphone: its stream, its audio context and its analyser.
// The app never opens or closes it. It declares when the Model requires it
// and how to open and close it, and the runtime does both at the right
// moments. The tuner design lists "a microphone that stays open while the
// tuner reads as off" as something that must not happen. This is what rules
// it out: the only thing that opens the microphone is the Model saying
// Starting or Listening, and the Model saying anything else closes it.
//
// `ManagedResource.make<Model, Message>()` is called twice. The first call
// takes only the two types. The second takes a function that receives
// `entry` and returns a record of named resources. (Splitting the call lets
// TypeScript be told two types and infer the rest.) The record is passed to
// `Runtime.makeApplication` in src/entry.ts.
//
// A failed `acquire` is not a crash. The runtime sends the `onAcquireError`
// Message and goes on watching the Model.
export const managedResources = ManagedResource.make<Model, Message>()(
  entry => ({
    // The first argument of `entry` is the Schema of the resource's
    // requirements: the parameters needed to open it. The runtime also uses
    // this Schema to compare the requirements before and after each change
    // of Model. This microphone takes no parameters, so its requirements
    // are either `Option.some(null)` (wanted) or `Option.none()` (not
    // wanted), the shape Foldkit suggests for a resource without any.
    microphone: entry(Schema.Option(Schema.Null), {
      // The identity of the resource, made with `ManagedResource.tag` in
      // src/microphone.ts. It names the resource and gives its value a type,
      // and it is how the subscription below reaches the open microphone
      // (`Microphone.get`).
      resource: Microphone,
      // Called by the runtime with every new Model. When the answer goes
      // from none to some, the runtime acquires. From some to none, it
      // releases. When the answer is unchanged, nothing happens. So the
      // microphone is wanted in Starting, which is what opens it, and in
      // Listening, which keeps it open, and not in Off or Failed.
      // src/story.test.ts checks this by calling the function directly.
      modelToMaybeRequirements: model =>
        TunerState.match(model.tuner, {
          Off: () => Option.none(),
          Starting: () => Option.some(null),
          Listening: () => Option.some(null),
          Failed: () => Option.none(),
        }),
      // How to open it: an Effect that succeeds with the handle, or fails.
      // The function receives the requirements, which are null here and so
      // unused. The work is in src/microphone.ts. This is the moment the
      // browser asks the person for permission.
      acquire: () => acquireMicrophone,
      // How to close it, given the handle that `acquire` produced.
      release: releaseMicrophone,
      // The Messages by which the runtime tells `update` what happened.
      // `onAcquired` is offered the handle and does not take it. The handle
      // stays with the runtime, and code reaches it through `Microphone.get`.
      onAcquired: () => Message.SucceededAcquireMicrophone(),
      onReleased: () => Message.ReleasedMicrophone(),
      // `error` is whatever `acquire` failed with, typed `unknown`.
      // `microphoneFailure` (src/microphone.ts) sorts it into Refused,
      // Unsupported or Unexpected, so the Message carries a value that
      // `update` can match on.
      onAcquireError: error =>
        Message.FailedAcquireMicrophone({
          failure: microphoneFailure(error),
        }),
    }),
  }),
)

// SUBSCRIPTION

// A subscription is ongoing work that produces Messages, and that runs only
// while the Model says it should. Here it is a reading every 50 ms while the
// tuner is Listening. Like the managed resource it is declared and not
// started: the runtime starts and stops it as the Model changes. A Command
// does one thing and ends with one Message. A subscription is a `Stream`,
// Effect's type for a sequence of values over time, and may emit any number
// of Messages.
//
// The microphone is a managed resource and the readings are a subscription
// because the first is a handle and the second is a flow of events that uses
// it (FINDINGS.md, "The microphone is a managed resource and the readings a
// subscription", and the tuner design, "Approaches").

// One reading.
//
// `Microphone.get` is an Effect that succeeds with the handle of the open
// microphone, or fails with `ResourceNotAvailable` when the runtime is not
// holding one. `Stream.fromEffect` makes it a stream of one value, and
// `Stream.map` turns that value into a Message. `readMeasurement`
// (src/microphone.ts) copies the analyser's current samples into `buffer`
// and returns `{ level, maybePitch }`. That is exactly the payload of
// MeasuredInput, so it goes straight to the constructor. Pitch detection,
// the expensive part, therefore runs here in the stream and not in `update`.
//
// `Stream.catchTag` handles one kind of failure, picked out by its `_tag`,
// and replaces the failed stream with an empty one. (`ResourceNotAvailable`
// is a class Foldkit makes with Effect's `Data.TaggedError`, which is what
// gives an error a `_tag` to be picked out by.) A subscription's stream is
// not allowed to fail, and with this its failure type is `never`.
//
// NOTE: the Microphone is looked up on every tick, not once per stream. In
// development Vite restores the Model after a reload without running init, so
// the page can start already Listening before the Microphone is acquired
// again. A tick that finds no Microphone emits nothing.
const measureInput = (buffer: Float32Array<ArrayBuffer>) =>
  Stream.fromEffect(Microphone.get).pipe(
    Stream.map(microphone =>
      Message.MeasuredInput(readMeasurement(microphone, buffer)),
    ),
    Stream.catchTag('ResourceNotAvailable', () => Stream.empty),
  )

// All the readings: a tick every READING_INTERVAL, each replaced by the one
// Message of `measureInput`, or by none. `Stream.tick` emits once straight
// away and then once per interval, so the first reading is immediate.
//
// `Stream.suspend` puts off building the stream until it is run, and builds
// it afresh on each run. So each time the tuner starts listening it gets its
// own buffer for the samples, and within one run every tick reuses that
// buffer and does not allocate 4096 numbers twenty times a second.
const readings = Stream.suspend(() => {
  const buffer = new Float32Array(WINDOW)

  return Stream.tick(READING_INTERVAL).pipe(
    Stream.flatMap(() => measureInput(buffer)),
  )
})

// `Subscription.make<Model, Message, MicrophoneService>()` has the same
// two-call shape as `ManagedResource.make`. The third type argument lists
// the services the streams may ask the runtime for: the Microphone. The
// record it returns is passed to `Runtime.makeApplication` in src/entry.ts.
//
// `entry(fields, callbacks)`:
//   - The first argument declares the subscription's dependencies: the part
//     of the Model that decides whether, and how, the stream runs. It is
//     written like the fields of a `Schema.Struct`.
//   - `modelToDependencies` works them out. The runtime calls it with every
//     new Model and compares the answer with the last one, by value. Twenty
//     Models a second go by while listening, and `isListening` is `true` in
//     all of them, so the stream is left alone.
//   - `dependenciesToStream` builds the stream for one set of dependencies.
//     The runtime calls it at start-up, and again whenever the dependencies
//     change, after stopping the stream it had. `Stream.when` runs
//     `readings` if its condition is true and is an empty stream if not, so
//     "not listening" is a stream that does nothing.
// Every Message the stream emits is sent to `update`.
//
// The dependency is the one boolean and not the whole tuner state, on
// purpose. The level and the needle change with every reading, and a stream
// that depended on them would be restarted by its own readings.
export const subscriptions = Subscription.make<
  Model,
  Message,
  MicrophoneService
>()(entry => ({
  readings: entry(
    { isListening: Schema.Boolean },
    {
      // Every value of a tagged union carries the name of its variant in
      // `_tag`, which is enough here: no `match` is needed for a yes or no.
      modelToDependencies: model => ({
        isListening: model.tuner._tag === 'Listening',
      }),
      dependenciesToStream: ({ isListening }) =>
        Stream.when(
          readings,
          Effect.sync(() => isListening),
        ),
    },
  ),
}))
