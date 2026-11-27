// intonation.ts: the one rule for "in tune", and what the tuner says aloud.
//
// What this file is. Plain values and pure functions, in two parts:
//
//   IN TUNE        the rule that sorts a needle into flat, in tune or sharp
//   ANNOUNCEMENT   what a screen reader is told, and the small piece of
//                  memory that keeps it from being told too often
//
// Where it sits in the app. Two files need the rule, and neither can take
// it from the other:
//
//   src/view.ts   draws the word in the detail line, the needle's colour,
//                 the lit chip's colour and the green zone of the bar
//   src/main.ts   keeps, inside the `Listening` state, what the live region
//                 says (the `announcer` field), stepping it in `update` each
//                 time a reading arrives
//
// The view imports main.ts, so main.ts cannot import the view. The rule is
// here, below both, and each of them calls `intonationOf`. That is the
// whole point of the file: what is spoken and what is shown come from one
// function, so they cannot disagree.
//
// The only Foldkit in this file is the idea that state lives in the Model.
// `Announcer` is a Schema, as every field of the Model must be (FOLDKIT.md,
// "Project Conventions"), and `stepAnnouncer` is a pure function from the
// old value to the new one, which is what lets `update` stay pure and lets
// the tests step it with no clock: time is counted in readings.
//
// Read `src/pitch.ts` first, for what a cent and a MIDI note are. The design
// is docs/superpowers/specs/2026-11-26-screen-readers-design.md.

// `Option` is Effect's "maybe a value", used in place of null. `Schema`
// describes a shape at runtime and gives the TypeScript type as well: see
// MODEL in src/main.ts.
import { Option, Schema } from 'effect'

// "E2", "F sharp 3": a note's name as it should be spoken.
import { spokenNoteLabel } from './pitch'

// IN TUNE
//
// One rule, in one place: the needle, rounded to a whole cent, is in tune
// when it is within `IN_TUNE_CENTS` of the note. It goes by the number as
// shown, on purpose. The detail line prints a whole number of cents and a
// word beside it, and the two must never disagree. Until 0.7.2 the word
// came from the needle before rounding, so a needle at 5.4 read "+5 cents ·
// sharp" while one at 5.0 read "+5 cents · in tune".
//
// Five things say "in tune": the word in the detail line, the needle
// marker's colour, the lit string chip's colour, the green zone of the
// needle bar, and the announcement for a screen reader. The first three and
// the last come from `intonationOf`, and the zone is drawn from
// `IN_TUNE_EDGE_CENTS`. Nothing else in the app compares cents with
// `IN_TUNE_CENTS`. Keep it so: a second comparison written somewhere else
// is how the number and the word came apart.

// A cent is a hundredth of a semitone. A needle within this many cents of
// the note, once rounded, counts as in tune. The value is that of the Stem
// Shovel tuner this app is a port of.
export const IN_TUNE_CENTS = 5

// The same rule as a place on the needle bar. A needle rounds to
// `IN_TUNE_CENTS` or less until it reaches half a cent beyond it, so that
// is how far either side of the middle the green zone goes (`needleView`
// in src/view.ts).
export const IN_TUNE_EDGE_CENTS = IN_TUNE_CENTS + 0.5

// The needle as the detail line prints it: a whole number of cents. A half
// rounds away from zero on both sides (5.5 is 6 and -5.5 is -6), so sharp
// and flat are treated alike. `Math.round` alone rounds a half upwards,
// which would make -5.5 into -5, hence the detour through the magnitude.
//
// A needle that rounds to nothing gives plain zero, never negative zero.
// JavaScript has both, and `(-0.4).toFixed(0)` is the text "-0", which is
// what the detail line used to print for a needle a hair flat.
/** The needle rounded to a whole cent, halves away from zero. */
export const wholeCents = (needleCents: number): number => {
  const magnitude = Math.round(Math.abs(needleCents))

  return needleCents < 0 && magnitude > 0 ? -magnitude : magnitude
}

// The three answers of the rule. `Schema.Literals` makes a Schema whose
// values are exactly these strings, and the type below is the union of the
// three. It is a Schema, not a bare TypeScript union, because an
// `Intonation` ends up inside the Model (in `Announcement`, below).
export const Intonation = Schema.Literals(['Flat', 'InTune', 'Sharp'])
export type Intonation = typeof Intonation.Type

// The rule itself, on the whole number from `wholeCents`. "In tune" wins.
// Otherwise the sign decides: above the note is sharp, below it is flat.
/** Whether a whole number of cents is flat, in tune or sharp. */
export const intonationOf = (shownCents: number): Intonation => {
  if (Math.abs(shownCents) <= IN_TUNE_CENTS) {
    return 'InTune'
  } else if (shownCents > 0) {
    return 'Sharp'
  } else {
    return 'Flat'
  }
}

// The word for each answer. The detail line prints it and the announcement
// speaks it, so the two use the same three words. A record with one entry
// for each member of the union: leave one out and this does not compile.
const INTONATION_WORDS: Readonly<Record<Intonation, string>> = {
  Flat: 'flat',
  InTune: 'in tune',
  Sharp: 'sharp',
}

/** "flat", "in tune" or "sharp". */
export const intonationWord = (intonation: Intonation): string =>
  INTONATION_WORDS[intonation]

// ANNOUNCEMENT
//
// A player who cannot see the screen needs two things from a tuner: which
// note is sounding, and which way to turn the peg. The page says both
// through a live region, an element whose changes of text a screen reader
// reads out (`announcementView` in src/view.ts). The difficulty is the
// rate. A reading arrives twenty times a second, and a region that changed
// that often would bury its listener. So:
//
//   - What is spoken is a note and one of the three states, such as
//     "E2, flat". Never the cents, which change with every reading.
//   - It changes only when what the screen shows has held steady for a
//     short while. A string hovering at the edge of in tune flips state
//     several times a second, and none of those flips is spoken.
//
// "Held steady for a while" needs memory, and in a Foldkit app memory is a
// field of the Model. The `Announcer` below is that field. `update` steps
// it once for each reading (`stepAnnouncer`), so time is counted in
// readings and no clock is involved.

// What the tuner would say: which note, and how it stands. The note is a
// MIDI number, which holds the octave as well as the name. It is a Schema
// because the announcer below holds two of them.
export const Announcement = Schema.Struct({
  midi: Schema.Number,
  intonation: Intonation,
})
export type Announcement = typeof Announcement.Type

// The words for an announcement: "E2, flat", "F sharp 3, in tune". The
// comma gives a speech synthesiser a short pause between the note and the
// word. A sharp note is spelt out, because a screen reader may pass over
// the sign "♯" in silence, and "F3" for an F sharp is the wrong note.
/** An announcement as text for a screen reader. */
export const announcementText = ({ midi, intonation }: Announcement): string =>
  `${spokenNoteLabel(midi)}, ${intonationWord(intonation)}`

// How many readings in a row must show the same note and state before it
// is spoken. A reading comes every 50 ms (`READING_INTERVAL` in
// src/main.ts), so seven is 0.3 seconds from the first of them to the
// last, and 0.35 from the last reading that showed something else. Why
// seven:
//   - A string at the edge of in tune flips from one reading to the next,
//     or over a few. No flutter of that kind lasts seven readings.
//   - The first readings after a pluck are unsteady: the attack is sharp,
//     and the needle is smoothed towards the note. The hold lets them pass.
//   - It is still short enough that someone turning a peg hears "in tune"
//     while they are close to where they stopped.
// It also sets the most that can be said: the text changes at most once
// every 0.35 seconds, however the readings behave.
export const ANNOUNCEMENT_HOLD_READINGS = 7

// The memory. A field of the `Listening` state in src/main.ts.
//   maybeSpoken     what the live region says now, if anything. The view
//                   draws this and nothing else from the announcer.
//   maybeCandidate  what the screen showed at the last reading, if it
//                   showed a note.
//   heldReadings    how many readings in a row have shown that candidate.
//                   It stops counting at the hold.
export const Announcer = Schema.Struct({
  maybeSpoken: Schema.Option(Announcement),
  maybeCandidate: Schema.Option(Announcement),
  heldReadings: Schema.Number,
})
export type Announcer = typeof Announcer.Type

// The announcer of a tuner that has just begun to listen, or that hears
// nothing: nothing said, nothing waiting.
export const SILENT_ANNOUNCER: Announcer = {
  maybeSpoken: Option.none(),
  maybeCandidate: Option.none(),
  heldReadings: 0,
}

// Two announcements are the same when the note and the state both are.
const isSameAnnouncement = (first: Announcement, second: Announcement) =>
  first.midi === second.midi && first.intonation === second.intonation

// One reading's worth of the announcer. `maybeShown` is what the screen
// shows after that reading: a note and its state, or nothing.
//
//   - Nothing shown: everything is forgotten. The live region empties,
//     which a screen reader does not read out, so silence says nothing.
//     And because the region is then empty, the next note is a change even
//     if it is the same note in the same state as before, so it is spoken
//     again once it has held.
//   - The candidate again: one more reading counted, up to the hold. On
//     the reading that completes the hold the candidate becomes what is
//     spoken. If it already is what is spoken, nothing changes, and a
//     screen reader hears nothing: a live region is read when its text
//     changes.
//   - Something else: it is the new candidate, with a count of one. What
//     is spoken stays as it was, which is what makes a flutter silent.
//
// `Option.match` reads an Option: one function for "nothing", one for
// "something". `Option.exists(option, test)` is true only when there is a
// value and it passes the test.
/** The announcer after one more reading, given what the screen now shows. */
export const stepAnnouncer = (
  announcer: Announcer,
  maybeShown: Option.Option<Announcement>,
): Announcer =>
  Option.match(maybeShown, {
    onNone: () => SILENT_ANNOUNCER,
    onSome: shown => {
      const isCandidateAgain = Option.exists(
        announcer.maybeCandidate,
        candidate => isSameAnnouncement(candidate, shown),
      )
      const heldReadings = isCandidateAgain
        ? Math.min(announcer.heldReadings + 1, ANNOUNCEMENT_HOLD_READINGS)
        : 1

      return {
        maybeSpoken:
          heldReadings >= ANNOUNCEMENT_HOLD_READINGS
            ? Option.some(shown)
            : announcer.maybeSpoken,
        maybeCandidate: Option.some(shown),
        heldReadings,
      }
    },
  })
