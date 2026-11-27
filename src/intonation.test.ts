// INTONATION TESTS: the one rule for "in tune", and what the tuner says aloud
//
// Exercises `src/intonation.ts`: plain functions, tested with plain Vitest.
// Nothing in this file is Foldkit, and the only Effect in it is `Option`.
//
// Two things are pinned here. The first is the rule itself: a needle is
// rounded to a whole cent, and that whole number is flat, in tune or sharp.
// The second is the announcer, the small piece of memory that decides when
// a screen reader is told something new. `story.test.ts` drives the same
// announcer through `update`, reading by reading, and `scene.test.ts` shows
// what the page makes of it.

// `Option` is Effect's type for a value that may be missing. The announcer
// is given `Option.some(announcement)` when the screen shows a note and
// `Option.none()` when it shows none.
import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  ANNOUNCEMENT_HOLD_READINGS,
  type Announcement,
  type Announcer,
  IN_TUNE_CENTS,
  IN_TUNE_EDGE_CENTS,
  SILENT_ANNOUNCER,
  announcementText,
  intonationOf,
  intonationWord,
  stepAnnouncer,
  wholeCents,
} from './intonation'

describe('wholeCents', () => {
  // A half rounds away from zero on both sides, so sharp and flat are
  // treated alike, and nothing rounds to negative zero.
  test.each([
    [4.4, 4],
    [4.5, 5],
    [5.4, 5],
    [5.5, 6],
    [-4.5, -5],
    [-5.4, -5],
    [-5.5, -6],
    [0.4, 0],
    [-0.4, 0],
  ])('%d is shown as %d', (needleCents, shown) => {
    expect(Object.is(wholeCents(needleCents), shown)).toBe(true)
  })
})

describe('intonationOf', () => {
  test('the number in the rule is 5, and the green zone ends half a cent past it', () => {
    expect(IN_TUNE_CENTS).toBe(5)
    expect(IN_TUNE_EDGE_CENTS).toBe(5.5)
  })

  // The rule goes by the whole number: within 5 either side is in tune,
  // and outside that the sign decides.
  test.each([
    [0, 'InTune'],
    [5, 'InTune'],
    [-5, 'InTune'],
    [6, 'Sharp'],
    [50, 'Sharp'],
    [-6, 'Flat'],
    [-50, 'Flat'],
  ] as const)('%d cents is %s', (shownCents, intonation) => {
    expect(intonationOf(shownCents)).toBe(intonation)
  })

  // The words are the ones the detail line prints, so what is spoken and
  // what is shown use the same three.
  test('each state has its word', () => {
    expect(intonationWord('Flat')).toBe('flat')
    expect(intonationWord('InTune')).toBe('in tune')
    expect(intonationWord('Sharp')).toBe('sharp')
  })
})

describe('announcementText', () => {
  // The note with its octave, a comma, and the word. A sharp is spelt out,
  // because a screen reader may pass over the sign "♯" in silence, and
  // "F2" for an F sharp would be the wrong note.
  test.each([
    [40, 'Flat', 'E2, flat'],
    [40, 'InTune', 'E2, in tune'],
    [64, 'Sharp', 'E4, sharp'],
    [54, 'InTune', 'F sharp 3, in tune'],
    [54, 'Sharp', 'F sharp 3, sharp'],
  ] as const)('note %d, %s, is "%s"', (midi, intonation, text) => {
    expect(announcementText({ midi, intonation })).toBe(text)
  })
})

// Three things a screen could show, to step the announcer with.
const e2Flat: Announcement = { midi: 40, intonation: 'Flat' }
const e2InTune: Announcement = { midi: 40, intonation: 'InTune' }
const a2InTune: Announcement = { midi: 45, intonation: 'InTune' }

// Steps the announcer once for each thing shown, in order, and returns it.
const after = (
  start: Announcer,
  shown: ReadonlyArray<Option.Option<Announcement>>,
): Announcer => shown.reduce(stepAnnouncer, start)

// `count` readings in a row that show the same thing.
const readings = (
  count: number,
  announcement: Announcement,
): ReadonlyArray<Option.Option<Announcement>> =>
  Array.from({ length: count }, () => Option.some(announcement))

describe('stepAnnouncer', () => {
  test('the hold is seven readings, about a third of a second', () => {
    expect(ANNOUNCEMENT_HOLD_READINGS).toBe(7)
  })

  test('a silent announcer says nothing and is waiting for nothing', () => {
    expect(SILENT_ANNOUNCER).toEqual({
      maybeSpoken: Option.none(),
      maybeCandidate: Option.none(),
      heldReadings: 0,
    })
  })

  test('one reading short of the hold, nothing is spoken yet', () => {
    const announcer = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS - 1, e2Flat),
    )

    expect(announcer.maybeSpoken).toEqual(Option.none())
    expect(announcer.maybeCandidate).toEqual(Option.some(e2Flat))
    expect(announcer.heldReadings).toBe(ANNOUNCEMENT_HOLD_READINGS - 1)
  })

  test('on the reading that completes the hold, it is spoken', () => {
    const announcer = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2Flat),
    )

    expect(announcer.maybeSpoken).toEqual(Option.some(e2Flat))
  })

  // The count stops at the hold: past it there is nothing left to wait
  // for, and a string that rings for a minute would otherwise count to
  // twelve hundred.
  test('once spoken, further readings of the same thing change nothing', () => {
    const spoken = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2Flat),
    )

    expect(after(spoken, readings(40, e2Flat))).toEqual(spoken)
  })

  test('a change of state is spoken after its own hold, not before', () => {
    const flat = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2Flat),
    )
    const almost = after(
      flat,
      readings(ANNOUNCEMENT_HOLD_READINGS - 1, e2InTune),
    )

    expect(almost.maybeSpoken).toEqual(Option.some(e2Flat))
    expect(stepAnnouncer(almost, Option.some(e2InTune)).maybeSpoken).toEqual(
      Option.some(e2InTune),
    )
  })

  test('a change of note counts as a change, whatever the state', () => {
    const e2 = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2InTune),
    )

    expect(
      after(e2, readings(ANNOUNCEMENT_HOLD_READINGS, a2InTune)).maybeSpoken,
    ).toEqual(Option.some(a2InTune))
  })

  // A string at the edge of in tune: the state flips every few readings
  // and never holds for seven. What was spoken stays as it was.
  test('a flutter faster than the hold speaks nothing new', () => {
    const flat = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2Flat),
    )
    const flutter = Array.from({ length: 20 }, () => [
      ...readings(3, e2InTune),
      ...readings(3, e2Flat),
    ]).flat()

    expect(after(flat, flutter).maybeSpoken).toEqual(Option.some(e2Flat))
  })

  test('nothing on the screen empties everything, at once', () => {
    const flat = after(
      SILENT_ANNOUNCER,
      readings(ANNOUNCEMENT_HOLD_READINGS, e2Flat),
    )

    expect(stepAnnouncer(flat, Option.none())).toEqual(SILENT_ANNOUNCER)
  })
})
