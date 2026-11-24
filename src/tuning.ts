// tuning.ts: the list of tunings, and which string a note is nearest to.
//
// What this file is. Plain data and three small pure functions. There is no
// Foldkit in it and nothing here can fail.
//
// Where it sits in the app.
//   - The Model (`src/main.ts`) does not hold a tuning. It holds only
//     `tuningId`, a string. `src/view.ts` looks the tuning up with
//     `tuningById` each time it draws, so the Model stays small and holds
//     nothing that can be worked out from it.
//   - `TUNINGS` is the list of items the view gives to the tuning picker (a
//     Listbox from `@foldkit/ui`). `main.ts` imports the `Tuning` type to say
//     what kind of item that Listbox holds: `Listbox.create<Tuning>()`.
//   - `nearestString` tells the view which string to light up for the note
//     being heard.
//   - `isTuningId` and `DEFAULT_TUNING_ID` are used by `src/preferences.ts`
//     to check a saved tuning id.
//
// Notes are MIDI note numbers throughout: see `src/pitch.ts` for what those
// are and how they become names and frequencies. Read this file after
// `pitch.ts` and before `src/preferences.ts`.

// Effect's own `Array`, `Option` and `Order` modules, and `pipe`. Inside this
// file the name `Array` is Effect's module, not JavaScript's global: its
// functions take the array as an argument (`Array.findFirst(items, test)`)
// and return an `Option` where a native method would return undefined.
// `Option` is a value that may be absent: `Option.some(x)` or
// `Option.none()`. `Order` holds comparison functions.
import { Array, Option, Order, pipe } from 'effect'

// One tuning.
//   - `id`: what is stored in the Model and saved in the browser's storage.
//     It must stay the same once people have it saved.
//   - `label`: the text shown in the picker.
//   - `notes`: the open strings as MIDI note numbers, in the order they are
//     drawn. An empty list means "no strings to show".
// A plain TypeScript type, not a Schema: a Tuning is never a field of the
// Model or of a Message, only its id is.
export type Tuning = Readonly<{
  id: string
  label: string
  notes: ReadonlyArray<number>
}>

// Standard guitar tuning, E2 A2 D3 G3 B3 E4. It is a constant of its own
// because it is used three times: in the list, as the default, and as the
// fallback for an id that is not on the list.
const STANDARD: Tuning = {
  id: 'standard',
  label: 'Guitar - Standard',
  notes: [40, 45, 50, 55, 59, 64],
}

// The nine tunings of the Stem Shovel tuner this app is a port of (the tuner
// design, "Source being ported"). Reading one: standard guitar is 40 45 50
// 55 59 64, which is E2 A2 D3 G3 B3 E4. Strings are listed in string order,
// which for the ukulele (G4 C4 E4 A4) is not lowest note first.
// Chromatic has no strings: the view then draws no row of strings, and
// `nearestString` below returns none.
/** The tunings on offer, low string first, as MIDI notes (E2 = 40, A4 = 69).
 *  Chromatic lists no strings and suits any instrument. */
export const TUNINGS: ReadonlyArray<Tuning> = [
  { id: 'chromatic', label: 'Chromatic: Any Instrument', notes: [] },
  STANDARD,
  { id: 'drop-d', label: 'Guitar - Drop D', notes: [38, 45, 50, 55, 59, 64] },
  {
    id: 'half-down',
    label: 'Guitar - 1/2 Step Down',
    notes: [39, 44, 49, 54, 58, 63],
  },
  { id: 'dadgad', label: 'Guitar - DADGAD', notes: [38, 45, 50, 55, 57, 62] },
  { id: 'open-g', label: 'Guitar - Open G', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'bass', label: 'Bass - Standard', notes: [28, 33, 38, 43] },
  { id: 'bass-5', label: 'Bass - 5-string', notes: [23, 28, 33, 38, 43] },
  { id: 'ukulele', label: 'Ukulele - Standard', notes: [67, 60, 64, 69] },
]

// The tuning a first visit starts with, and the one a missing or unknown
// saved id falls back to (the tuner design, "Preferences").
export const DEFAULT_TUNING_ID = STANDARD.id

// Looks a tuning up by id. `Array.findFirst` is Effect's version of
// `Array.prototype.find`: it returns `Option.some(tuning)` when one matches
// and `Option.none()` when none does, so the "not found" case is in the type
// and cannot be forgotten. The two exported functions below each settle it
// in their own way.
const findTuning = (id: string): Option.Option<Tuning> =>
  Array.findFirst(TUNINGS, tuning => tuning.id === id)

// Whether an id is on the list. `src/preferences.ts` uses it to refuse a
// saved id that is not, before it reaches the Model.
export const isTuningId = (id: string): boolean => Option.isSome(findTuning(id))

// The view calls this with `model.tuningId`. `tuningId` is a plain string in
// the Model (`Schema.String`), so the type system cannot promise it names a
// tuning. `Option.getOrElse` unwraps the Option and supplies the fallback, so
// the view always has a tuning to draw.
/** The tuning with this id, or the standard guitar tuning for an id that is
 *  not on the list. */
export const tuningById = (id: string): Tuning =>
  Option.getOrElse(findTuning(id), () => STANDARD)

// Which string to light. The view passes the tuning and the note it is
// hearing (`note.midi` from `noteFromFrequency` in `src/pitch.ts`), and gets
// back the MIDI number of the string closest to it. For a tuning that has
// strings there is always an answer, however far the note is from every
// string.
//
// `Array.match` treats the empty and the non-empty array as separate cases.
// Inside `onNonEmpty`, `notes` has a non-empty array type, which is what
// `Array.min` requires: there is no smallest element of nothing, and this
// way the types rule that call out.
//
// `Array.min(notes, order)` returns the smallest element by an ordering.
// `Order.mapInput(Order.Number, f)` builds the ordering: compare two notes by
// comparing `f(note)` as numbers. Here `f` is the distance in semitones from
// the note heard, so the "smallest" string is the nearest one.
/** The string of the tuning closest to a note; the earlier string wins a
 *  tie. None for a tuning with no strings. */
export const nearestString = (
  tuning: Tuning,
  midi: number,
): Option.Option<number> =>
  pipe(
    tuning.notes,
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: notes =>
        Option.some(
          Array.min(
            notes,
            Order.mapInput(Order.Number, (note: number) =>
              Math.abs(note - midi),
            ),
          ),
        ),
    }),
  )
