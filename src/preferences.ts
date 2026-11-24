import { Option, Schema, pipe } from 'effect'

import { DEFAULT_TUNING_ID, isTuningId } from './tuning'

export const Preferences = Schema.Struct({
  tuningId: Schema.String,
  a4: Schema.Number,
})
export type Preferences = typeof Preferences.Type

export const STORAGE_KEY = 'oktuner.tuner'

export const A4_MIN = 400
export const A4_MAX = 480
export const A4_DEFAULT = 440

export const DEFAULT_PREFERENCES: Preferences = {
  tuningId: DEFAULT_TUNING_ID,
  a4: A4_DEFAULT,
}

const isA4InRange = (a4: number): boolean =>
  Number.isFinite(a4) && a4 >= A4_MIN && a4 <= A4_MAX

/** The A4 a person typed, when it is a number from 400 to 480 Hz. */
export const parseA4 = (text: string): Option.Option<number> =>
  pipe(
    text.trim(),
    Option.liftPredicate(trimmed => trimmed !== ''),
    Option.map(Number),
    Option.filter(isA4InRange),
  )

const SavedFields = Schema.Struct({
  tuningId: Schema.optional(Schema.Unknown),
  a4: Schema.optional(Schema.Unknown),
})

const decodeSavedFields = Schema.decodeUnknownOption(
  Schema.fromJsonString(SavedFields),
)
const decodeString = Schema.decodeUnknownOption(Schema.String)
const decodeNumber = Schema.decodeUnknownOption(Schema.Number)

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

const encodePreferences = Schema.encodeSync(Schema.fromJsonString(Preferences))

export const preferencesToJson = (preferences: Preferences): string =>
  encodePreferences(preferences)
