// preferences.ts: the two things the tuner remembers between visits.
//
// What this file is. The saved preferences (which tuning, and what frequency
// A4 is), their limits and defaults, and the pure functions that turn them
// into JSON text and back. It does not touch `localStorage`. Reading and
// writing storage are side effects, and in a Foldkit app side effects are
// kept out of plain functions: they live in `src/main.ts`, as an Effect for
// the startup read and a Command for each write.
//
// Where it sits in the app.
//   - Startup. `flags` in `main.ts` is an Effect that the runtime runs before
//     `init`. It reads the text stored under STORAGE_KEY and gives it to
//     `preferencesFromJson`. The result is the app's Flags: the runtime
//     passes it to `init`, which builds the first Model from it. Flags are
//     Foldkit's way of getting outside values into `init` while keeping
//     `init` a pure function.
//   - Saving. When the person picks a tuning or types a usable A4, `update`
//     returns the `SavePreferences` Command, which writes
//     `preferencesToJson(...)` back under the same key.
//   - Typing. `parseA4` decides whether the text in the A4 field is a usable
//     value. `update` uses it to apply the value, and `src/view.ts` uses it
//     to mark the field as invalid.
//
// The rule this file follows: what comes out of storage is not trusted. It
// may be missing, damaged, written by an older version, or edited by hand.
// `preferencesFromJson` therefore never fails. Whatever it is given, it
// returns a complete, valid `Preferences`.
//
// Read `src/tuning.ts` before this file, and the INIT and COMMAND sections of
// `src/main.ts` after it.

// `Option` (a value that may be absent), `Schema` (types that also exist at
// runtime, and can check and convert data) and `pipe` (passes a value through
// a list of functions, first to last), all from Effect.
import { Option, Schema, pipe } from 'effect'

import { DEFAULT_TUNING_ID, isTuningId } from './tuning'

// The saved preferences, as an Effect Schema. This one declaration is used
// three ways:
//   - `Flags` in `main.ts` is `Schema.Struct({ preferences: Preferences })`,
//     and `entry.ts` gives that Schema to `Runtime.makeApplication`, so
//     Foldkit knows the shape of what `flags` produces.
//   - `encodePreferences` at the bottom of this file is built from it.
//   - The `type` on the line after is read off it with `.Type`, so the
//     TypeScript type and the Schema cannot drift apart. The `const` and the
//     `type` share a name on purpose, as throughout Foldkit code.
// `tuningId` is one of the ids in `src/tuning.ts`. `a4` is the frequency of
// A4 in Hz.
export const Preferences = Schema.Struct({
  tuningId: Schema.String,
  a4: Schema.Number,
})
export type Preferences = typeof Preferences.Type

// The `localStorage` key both preferences are saved under, as one JSON
// object: `{"tuningId":"drop-d","a4":442}`.
export const STORAGE_KEY = 'oktuner.tuner'

// The range allowed for A4, in Hz, and the value used when none is saved:
// 440 Hz is modern concert pitch. The range is the original tuner's (the
// tuner design, "Preferences"). `isA4InRange` below enforces it, and the view
// also sets A4_MIN and A4_MAX as the `min` and `max` of the number field.
export const A4_MIN = 400
export const A4_MAX = 480
export const A4_DEFAULT = 440

// What a first visit gets. `flags` in `main.ts` also falls back to this when
// storage cannot be read at all (FINDINGS.md, "Blocked site storage throws
// while the storage layer is built, outside the typed error channel").
export const DEFAULT_PREFERENCES: Preferences = {
  tuningId: DEFAULT_TUNING_ID,
  a4: A4_DEFAULT,
}

// One test, shared by typed input and saved input. `Number.isFinite` turns
// away NaN and Infinity: NaN is what `Number('abc')` gives, and a comparison
// with NaN is always false, but saying so outright is clearer. `Number` here
// is JavaScript's global.
const isA4InRange = (a4: number): boolean =>
  Number.isFinite(a4) && a4 >= A4_MIN && a4 <= A4_MAX

// The text of the A4 field, turned into a number when it is one the tuner
// can use. Each step of the pipe passes an Option on, and once it is `None`
// it stays `None`:
//   1. `text.trim()`: spaces around the text do not count.
//   2. `Option.liftPredicate(test)`: wrap the value in `Some` if it passes
//      the test, otherwise give `None`. Here it turns away an empty field,
//      which `Number('')` would otherwise read as 0.
//   3. `Option.map(Number)`: convert the text inside a `Some`. Text that is
//      not a number becomes NaN.
//   4. `Option.filter(isA4InRange)`: keep the number only if it is finite
//      and from 400 to 480.
// `update` in `main.ts` applies and saves the value when this gives `Some`.
// When it gives `None`, the text stays in the field and the A4 in use is
// left alone, so a half-typed number never reaches the tuner. Decimals such
// as 442.5 and forms such as "4e2" pass: see docs/backlog.md, "A4 field
// accepts decimals".
/** The A4 a person typed, when it is a number from 400 to 480 Hz. */
export const parseA4 = (text: string): Option.Option<number> =>
  pipe(
    text.trim(),
    Option.liftPredicate(trimmed => trimmed !== ''),
    Option.map(Number),
    Option.filter(isA4InRange),
  )

// READING WHAT WAS SAVED

// The shape expected of the saved JSON, kept loose on purpose: two fields
// that may each be missing (`Schema.optional`) and may hold anything at all
// (`Schema.Unknown`). Decoding with this Schema says nothing about whether
// the values are good. Each field is checked on its own in
// `preferencesFromJson`. Decoding straight to `Preferences` would be all or
// nothing: one bad field would throw away the good one beside it.
const SavedFields = Schema.Struct({
  tuningId: Schema.optional(Schema.Unknown),
  a4: Schema.optional(Schema.Unknown),
})

// Three decoders, built once when the module loads.
//
// `Schema.fromJsonString(schema)` wraps a Schema so that its input is JSON
// text: decoding first parses the text, then checks the parsed value against
// the inner Schema.
//
// `Schema.decodeUnknownOption(schema)` turns a Schema into a function from
// any value to an `Option`: `Some(decoded)` when the value fits the Schema,
// `None` when it does not. No exception, and no error detail, which suits a
// caller that only wants to know whether to use the value.
//
// So `decodeSavedFields` takes the stored text and gives `None` for text
// that is not JSON or does not hold an object. `decodeString` and
// `decodeNumber` then test a single field: a number saved as the text "442"
// is not a number, and is turned away.
const decodeSavedFields = Schema.decodeUnknownOption(
  Schema.fromJsonString(SavedFields),
)
const decodeString = Schema.decodeUnknownOption(Schema.String)
const decodeNumber = Schema.decodeUnknownOption(Schema.Number)

// The function `flags` in `main.ts` calls at startup. Its argument is already
// an Option, because the storage key may hold nothing.
//
//   - `Option.flatMap(decodeSavedFields)`: if there is text, decode it. The
//     decoder itself returns an Option, and `flatMap` joins the two, so
//     "nothing saved" and "saved but unreadable" both arrive as `None`.
//   - `Option.match({ onNone, onSome })`: settle both cases. With nothing
//     usable, return the defaults. Otherwise build the preferences one field
//     at a time: decode the field to the right type, keep it only if it is
//     valid (`Option.filter`), and fall back to that field's default
//     (`Option.getOrElse`).
//
// The return type is `Preferences`, not an Option and not an Effect: by the
// end of the pipe nothing is left that could be absent or fail. An unknown
// tuning id falls back to standard guitar, which is a decision recorded in
// the tuner design ("Preferences").
/** The preferences saved as JSON, each field checked on its own so one
 *  damaged field does not discard the other. Never fails: anything missing
 *  or damaged takes its default. */
export const preferencesFromJson = (
  maybeJson: Option.Option<string>,
): Preferences =>
  pipe(
    maybeJson,
    Option.flatMap(decodeSavedFields),
    Option.match({
      onNone: () => DEFAULT_PREFERENCES,
      onSome: saved => ({
        tuningId: pipe(
          decodeString(saved.tuningId),
          Option.filter(isTuningId),
          Option.getOrElse(() => DEFAULT_TUNING_ID),
        ),
        a4: pipe(
          decodeNumber(saved.a4),
          Option.filter(isA4InRange),
          Option.getOrElse(() => A4_DEFAULT),
        ),
      }),
    }),
  )

// WRITING

// The other direction. A Schema converts both ways, so the same
// `Schema.fromJsonString(Preferences)` that could decode JSON text can also
// encode a `Preferences` value to it. `Schema.encodeSync` gives a plain
// function that returns the text at once, and would throw if the value did
// not fit the Schema. The parameter of `preferencesToJson` is typed
// `Preferences`, so a value that reaches it already fits.
const encodePreferences = Schema.encodeSync(Schema.fromJsonString(Preferences))

// What the `SavePreferences` Command in `main.ts` writes to storage. The
// Command's arguments are `{ tuningId, a4 }`, which is exactly a
// `Preferences`, so it passes them straight in.
export const preferencesToJson = (preferences: Preferences): string =>
  encodePreferences(preferences)
