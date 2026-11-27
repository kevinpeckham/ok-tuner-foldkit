# Screen readers and keyboard: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). The six items of the backlog's "Screen readers and keyboard" section, a keyboard pass and an automated scan, in one pull request. Version 0.8.0.

Nobody could listen to this with a screen reader while it was built. Everything here is worked out from the ARIA and HTML specifications, from the accessibility tree that Chrome computes, and from how `@foldkit/ui` wires its own components. `FINDINGS.md` lists what a person with a real screen reader should check first.

## Intent

A blind musician can use the tuner: they hear which note is sounding and which way to turn the peg, can tell the strings apart, and can reach and name every control from the keyboard. A sighted player who has the tuner switched off can still read which tuning is chosen.

## Goals

1. **Sharp, flat and in tune are spoken,** with the note, and without flooding (given: on a change of state, never the cents; the same rule for "in tune" as the display; no chatter at a boundary; one live region, in the page from the start).
2. **The tuning picker's name says what it is and what is chosen,** and contains the text on it.
3. **Each string chip has a name that tells it from the others,** by octave, with only the letter shown.
4. **Opening the settings menu puts focus in the A4 field,** and closing it returns focus to the settings button.
5. **The chosen tuning can be read while the tuner is off:** the picker's text at 4.5:1 or better, the chips' letters at 3:1 or better, both still looking inactive.
6. **The failure line is at 4.5:1 or better** at every point of the pedal it can sit on.
7. **Every control can be reached, used and left with the keyboard,** and shows where focus is.
8. **An automated scan (axe-core) of every page finds nothing that falls inside this work.**

## Not goals

- No change to what is enabled when: the picker and the settings menu stay disabled while the tuner is off (given; recorded in the backlog as a question for Kevin).
- No change a sighted player can see from the announcement itself (given).
- Speaking the cents, or anything at the rate of the readings.
- axe-core in the project's dependencies or tests (given; a backlog item says what it would take).
- The other backlog items.

## Approaches

### 1. Announcing sharp, flat and in tune

Given: what is spoken is the note and one of three states ("E2, flat", "E2, in tune", "E2, sharp"); it changes only when the note-and-state on the screen has held steady for a short while; the memory that needs lives in the Model, inside `Listening`, kept by `update`.

**Where the rule for "in tune" lives.** The rule was in `src/view.ts` (`toDisplay`), and `AGENTS.md` forbids a second comparison with `IN_TUNE_CENTS`. `update` now needs the same answer, and `src/main.ts` cannot import the view (the view imports it). Weighed:

1. **A second copy of the rule in `main.ts`.** This is how the number and the word came apart before 0.7.2.
2. **Have the view compute the announcement and hand it to `update` in a Message.** A view sends Messages on events, not on render.
3. **Move the rule to a module both import (chosen).** `src/intonation.ts` holds `IN_TUNE_CENTS`, `wholeCents`, the green zone's edge, and one function, `intonationOf(shownCents)`, that answers `Flat`, `InTune` or `Sharp`. The view's `isInTune`, its word, and `update`'s announcement all come from that one function. "One rule, in one place" stays true: the place moved.

**What is remembered.** An `Announcer`, a field of `Listening`:

- `maybeSpoken`: the note-and-state the live region says now, if any.
- `maybeCandidate`: the note-and-state on the screen at the last reading, if any.
- `heldReadings`: how many readings in a row have shown that candidate.

Each reading, after `update` has worked out the next reading and needle, it works out what the screen now shows (the note from the reading's frequency and A4, the state from the needle rounded to a whole cent: exactly what `toDisplay` derives) and steps the announcer:

- The screen shows nothing: everything is cleared.
- The screen shows the candidate again: count one more. At `ANNOUNCEMENT_HOLD_READINGS` the candidate becomes what is spoken.
- The screen shows something else: it becomes the candidate, with a count of one. What is spoken stays.

**The hold: 7 readings.** A reading comes every 50 ms, so a note-and-state is spoken on the seventh reading in a row that shows it: 0.3 seconds after it first showed, 0.35 after the last reading that showed something else. Why that number: a string hovering at the edge of in tune flips from one reading to the next or over a few readings, well inside 0.3 seconds, so a flutter never counts to seven; the first readings after a pluck are unsteady (the attack is sharp, and the needle is smoothed towards the note), and the hold lets them pass unspoken; and it is short enough that someone turning a peg hears "in tune" while they are still close to where they stopped. It also bounds the rate: the text cannot change more often than once every 0.35 seconds, and in practice changes when the player does something.

**Silence** (decided here). The screen holds the last note for 0.6 seconds of quiet and then clears. The announcer follows the screen: while the note is held it is still what is shown, so nothing changes, and when the screen clears the region is emptied. A screen reader does not speak a region that has been emptied (text removed is not among the changes a live region announces by default), so silence says nothing. And because the region is empty, the next note is a change even when it is the same note in the same state as before, so it is spoken again after its hold.

**The region.** One `<div aria-live="polite" aria-atomic="true">`, off screen (`sr-only`), a child of the tuner's `<section>`, drawn in every state and empty unless listening has something to say. It is in the prerendered HTML, empty, for the reason the waiting line's region is (`FINDINGS.md`, "The tuner says what it is waiting for, by the clock"). The big note loses its `aria-live` and `aria-atomic`: it and the detail line stay ordinary text, which a screen reader's user can move to and read (the cents are there), and which are never announced on their own. Weighed and left:

- **`role="status"` on the new region.** Same politeness. Left out because the waiting line already is the page's `status`, and two of them would make "the status region" ambiguous for the tests and for a screen reader's list of regions. `aria-live="polite"` is what the note's region used.
- **Keeping the note live and adding the word to it.** The visible note cannot hold the word without a change sighted players would see.
- **Hiding the visible note and detail line from assistive technology (`aria-hidden`).** It would take the cents away from a blind player who wants them.

Sighted players see no change: the region is off screen, and nothing else in the screen's markup changes but two attributes.

The waiting line's `status` region and the failure line's `alert` are separate, unchanged, and never speak while the tuner is listening.

### 2. The picker's name

`@foldkit/ui`'s Listbox names its button with `ariaLabel` or `ariaLabelledBy` (the first wins; `resolveButtonLabel` in `listbox/shared.ts`), and with neither the name comes from `buttonContent`. It always points the open list at the button with `aria-labelledby`.

1. **`ariaLabelledBy` naming two elements** ("Tuning" and the value). Works, and replaces the name the content gives, which is the thing the house rule says to avoid.
2. **No label attribute, and the word in the button's content, off screen (chosen).** The button's content becomes `<span class="sr-only">Tuning: </span>` followed by the visible label, so the name a browser computes is "Tuning: Guitar - Standard": what it is, what is chosen, and the visible text whole and in order.

The open list would then be named after the button, value included ("Tuning: Guitar - Standard"). `itemsAttributes` are spread after the Listbox's own attributes, and a later attribute replaces an earlier one, so the list is given `aria-label="Tuning"`... which loses to `aria-labelledby`. So instead the off-screen word gets an id, and the list's `aria-labelledby` is pointed at it: the list is named "Tuning". If a later Foldkit stops letting the later attribute win, a Scene test fails.

The options are named by their content, the tuning's label.

### 3. The chips' names

The chips are list items, not controls, so they are read as text. `aria-label` on a plain list item is not reliably read, so the octave goes inside the chip as off-screen text after the letter: "E" shown, "E2" read. The list keeps `role="list"` and its label "Strings". The lit chip keeps `aria-current="true"`, which is a global ARIA state: Chrome exposes it on the list item, and a screen reader says "current" when its user moves to that chip. It is not announced when it changes (it is not a live region), and need not be: the announcement names the note with its octave.

### 4. Focus in the settings menu

Read from `popover/index.ts` and `anchor/anchor.ts`: `focusSelector` is a view input. The panel's Mount positions the panel, then on the next animation frame focuses `document.querySelector(focusSelector)` in place of the panel. On closing by Escape, by the button or by a click outside, `update` returns `FocusButton`, which puts focus back on the settings button. When focus leaves the panel (Tab), the menu closes and focus stays where the person moved it. So `focusSelector: '#a4-input'` is the whole change. The field already has a visible `<label for>`, "A4 (Hz)", which is its accessible name.

### 5. The tuning while the tuner is off

The picker's text and the chips' letters get an opacity that measures at or above the targets and is still clearly dimmer than the live state; the numbers are in "Changes during the build". The caret and the three dots stay faint: they are the parts that say "this cannot be opened now", and an inactive control's icon has no contrast requirement.

### 6. The failure line

The pedal is darkest at its foot, and the darkest text there is cannot be much red: the numbers decide, and are in "Changes during the build".

## Testing

- **Story:** the announcer through `update`: steady in tune, steady flat, a note change, a flutter faster than the hold, a flutter that settles, silence and return.
- **Scene:** the picker's name and the list's, each chip's name on guitar and banjo, the lit chip, the one polite region and its text for a given Model, the A4 field's name, the `focusSelector` handed to the Popover's Mount.
- **Server entry:** the region is in the prerendered tuner page, and empty.
- **Headless Chrome on the build:** the computed names; a tone at the edge of in tune with every change of the region's text recorded for five seconds; focus on opening and closing the menu; contrast measured from screenshots; a keyboard walk; axe-core on every page.

## Left to the builder

The exact opacities and colours, from measurement. What the keyboard walk and the scan turn up: fix what is small, record the rest.

## Changes during the build

(Filled in as the work is done.)
