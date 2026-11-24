import { Array, Option, Order, pipe } from 'effect'

export type Tuning = Readonly<{
  id: string
  label: string
  notes: ReadonlyArray<number>
}>

const STANDARD: Tuning = {
  id: 'standard',
  label: 'Guitar - Standard',
  notes: [40, 45, 50, 55, 59, 64],
}

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

export const DEFAULT_TUNING_ID = STANDARD.id

const findTuning = (id: string): Option.Option<Tuning> =>
  Array.findFirst(TUNINGS, tuning => tuning.id === id)

export const isTuningId = (id: string): boolean => Option.isSome(findTuning(id))

/** The tuning with this id, or the standard guitar tuning for an id that is
 *  not on the list. */
export const tuningById = (id: string): Tuning =>
  Option.getOrElse(findTuning(id), () => STANDARD)

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
