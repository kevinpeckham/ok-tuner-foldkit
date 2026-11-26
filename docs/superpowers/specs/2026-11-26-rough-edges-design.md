# Visible rough edges: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). Six small items from the backlog that a visitor can see, taken in one pull request. Version 0.7.2.

## Intent

Each of these is a place where the page says or does something slightly wrong: a list that hides four of its options, a page that jumps when a line appears, a microphone left on under a screen that says the tuner has stopped, a number and a word that disagree, an empty alert. None needs a new feature. All need the page to be true to what it shows.

## Goals

1. **The open tuning list shows all eleven tunings** in a window 768 px tall or more, and says that it scrolls where it still has to.
2. **The page does not move** when the "waiting for the microphone" line or the failure line appears or goes (given).
3. **A crash closes every microphone the app opened** (given).
4. **The number and the word in the detail line always agree,** and so does everything else that says "in tune": the needle's colour, the lit chip's colour, the green zone of the bar. Zero is written "0 cents" (given).
5. **A microphone error whose message is only white space** shows the plain sentence, not an empty alert (given).
6. **The title is left alone** (given): "tracker-free" would claim too much now that visits are counted, and the footer and the Privacy page already say "ad-free". The backlog item is closed with no change.

## Not goals

- No new state in the Model for the list (given). No new Message anywhere.
- No change to `reportCrash` (given), and nothing new leaves the browser.
- No new wording. The sentences in `src/microphone.ts` stay as they are.
- The other backlog items about the list, the microphone and the screen readers.

## Approaches

### 1. The tuning list

What was found first. The backlog says `max-h-64` on the list does nothing, because the Listbox sets `max-height` inline. That is half true. The Listbox positions the list with Floating UI: `flip` (open on the other side if the list overflows the window), then `shift`, then `size`, which writes the room left as an inline `max-height` (`anchorSetup` in `repos/foldkit/packages/ui/src/anchor/anchor.ts`). On the first pass there is no inline value yet, so the class holds the list to 256 px. In a window 1366 by 768 there are 270 px under the button: 256 fits, `flip` sees no overflow and keeps the list below, and `size` then lets it grow to 270. There were 436 px above the button all along. So the class did nothing for the list's final height and was the reason the list opened on the wrong side.

1. **Remove the class and let `flip` do its work (chosen; the brief's first preference).** The list is measured at its full 396 px, overflows below, and opens upwards where it fits. Nothing new is passed to the Listbox: `anchor: { placement, gap, padding }` is its documented way to place the list, and flipping is what it does with it.
2. **A shorter row** (smaller padding per option). Seven of eleven at 270 px means a row of about 24 px to fit all: too small a target for a finger.
3. **A cue only** (the brief's second preference): keep the list where it is and show that it scrolls. Needed anyway for a window too short on both sides, so it is added as well, see below.

The cue, for a window where the list cannot fit above or below (a phone held sideways is 375 px tall, less than the list). Weighed: a scrollbar styled to stay visible, and scroll shadows. Whether a styled scrollbar stays visible is up to the system that draws it, and the systems in question (macOS, phones) are the ones that cannot be tried from this VM. Scroll shadows do not use the scrollbar at all. They are drawn with background gradients in the stylesheet, need no script and no state, and can be seen in headless Chrome: a soft edge at the top or bottom of the list wherever more options lie beyond it, and none at an end that has been reached. Chosen. It is a utility in `src/styles.css`, so the Content Security Policy (`style-src 'self'`) allows it.

### 2. The line under the On / Off button

Measured on `main` in headless Chrome: the pedal is 398.5 px tall with no line; 450.5 with the waiting line at 1280 px and 470.5 at 375 px; with the longest failure sentence (`BUSY`, 117 characters) 450.5 at 1280 px and 490.5 at 375 px, four lines.

1. **Beside the button where the pedal is wide enough, reserved under it where it is not (chosen; the brief's suggestion).** At 640 px and up the button and the line share one row. The row is two lines of text tall, which is the button's own height, so the pedal keeps its height to within a pixel. On a narrower pedal the line stays under the button, in a block that is always three lines tall. That makes the pedal about 68 px taller on a phone, all the time.
2. **Reserve under the button at every width.** Simplest, and a blank band 40 px tall on the desktop for nothing.
3. **Show both lines on the tuner's screen,** where the note goes: the screen is empty whenever either line shows, so nothing would need reserving at any width. Not chosen: it moves where the tuner speaks, changes the look of the screen and of the two messages, and a long message from the browser would have to be cut to fit. It is the way to get the phone's 68 px back, and is noted in the backlog.

### 3. The microphone after a crash

How a crash goes (`crashWith` in `repos/foldkit/packages/foldkit/src/runtime/renderer.ts`, `renderCrashView` in `crashUI.ts`): the runtime sets a flag that makes it drop every later Message, calls `crash.report`, calls `crash.view` and patches the result in. It does not close its scope, and a managed resource is released only when the Model stops asking for it or the scope closes (`managedResourceFibers.ts`). The Model never changes again, so `release` never runs. The crash hooks are given the error, the Model and the Message: not the microphone.

1. **`src/microphone.ts` remembers the streams it has open, and the crash hook stops them (chosen; given as the fallback, and the only way found).** A module-level set: a stream is added when `getUserMedia` answers and removed where its tracks are stopped. `closeOpenMicrophones` stops what is in the set. This is state outside the Model, on purpose, and the comments say so: the Model cannot hold a `MediaStream`, and the runtime that holds the handle does not give it up after a crash.
2. **Close the runtime's scope from the hook.** Nothing public reaches it.
3. **Reload the page on a crash.** Ends the stream, and throws away the crash screen that was just designed.

The hook. `crash.report` is the first thing the runtime calls. `reportThenClose(report, close)` in `src/crash.ts` builds the hook: it calls `report`, and calls `close` in a `finally`, so the microphone is closed even if reporting throws, and reporting has already run by the time closing could throw. `reportCrash` is passed in untouched. The function is generic and imports nothing, so `src/crash.ts` still does not depend on the code that may have crashed.

### 4. In tune

Today `isInTune` is `|needle| <= 5` on the unrounded needle, and the number is the needle rounded: 5.4 prints "+5 cents · sharp".

One rule (given): the needle rounded to a whole cent is in tune when it is within `IN_TUNE_CENTS`. It is computed once, in `toDisplay` in `src/view.ts`, which already makes the `Heard` record that the detail line, the needle marker and the string chips read. `Heard` gains the rounded number (`shownCents`), and `isInTune` is derived from it. The word's sharp or flat comes from the sign of the same number. Rounding is half away from zero on both sides, as `toFixed` did, so 5.5 is "+6 · sharp" and -5.5 is "-6 · flat". A rounded value of zero is plain `0`, never `-0`.

The green zone of the needle bar was 5 cents either side. With the rule on the rounded number a needle is in tune up to 5.5, so the zone is drawn 5.5 either side, from the same constant, or a green needle would sit just outside it.

### 5. The empty alert

`failureSentence` shows an unexpected error's own message when it has one. "Has one" becomes "has one after trimming". Nothing else.

## Design

- **View.** `tuningPickerView` loses `max-h-64` and `overflow-y-auto` and gains `scroll-cue`. `tunerView` draws one `powerRowView` in place of the button, the hint and the failure line: a row holding the button and a message block that reserves its room. The status region stays in the page from the first render, empty (FINDINGS.md says why). `toDisplay` computes `shownCents` and `isInTune`.
- **Stylesheet.** One `@utility scroll-cue`.
- **Microphone.** The set of open streams, `closeOpenMicrophones`, and the trimmed test in `failureSentence`.
- **Crash.** `reportThenClose` in `src/crash.ts`, wired in `src/entry.ts`.
- **Model, Messages, update.** Unchanged.
- **Privacy.** Nothing new leaves the browser.
- **Tests.** Scene: the list's classes; the message block holds both lines; the boundary needles (4.4, 4.5, 5.4, 5.5, -0.4, 0.4, -5.4, -5.5, -5.6) with the number, the word, the marker's colour and the chip's colour checked together. Unit: `closeOpenMicrophones`, the white-space message. Runtime: `reportThenClose` in a crashing runtime (order, and each half when the other throws), and the real app crashed while listening, which fails if the track is not stopped. Headless Chrome: the list at three window sizes, the pedal's height and the link's position in three states at two widths, the track's state after a forced crash.
- **Version** 0.7.2.

## Calls made for Kevin

- **Scroll shadows as well as the flip.** The flip answers the item for windows 768 px tall and more. The shadows are for the windows it cannot help.
- **A phone's pedal is about 68 px taller, always.** The cost of "the page must not shift" where there is no room beside the button.
- **The reserved room fits the app's own sentences** at 375 px and up. A longer message from the browser, or the longest sentence on a 320 px phone, still makes the pedal grow.
- **The button sits 12 px higher on the desktop,** so that two lines beside it clear the badge in the corner.
- **Only the streams are remembered, not the audio contexts.** Stopping the tracks is what turns the microphone and the browser's indicator off. The context is left to end with the page.
- **A microphone that opens after the crash is not closed.** If the app crashes while the browser is still asking for permission and the person then allows it, that stream stays open. Closing it would need a second piece of state. In the backlog.
- **The green zone is one cent wider.**

## Left to the builder

Nothing: the builder wrote this.

## Changes during the build

Recorded on 2026-11-26, after the build. Where this section and the text above disagree, this section is what was built.

- **The row beside the button starts at `mt-5`, not `mt-8`,** at every width. That, with `pb-3` under it, is what lets two full-width lines clear the badge without making the desktop pedal taller. The button is 11.5 px higher than it was.
- **`closeOpenMicrophones` is called in `afterEach`** by the two test files that open a microphone. The set of open streams belongs to the module, so it outlives a test.
- **An item was added to the backlog for the phone's taller pedal** and for the two cases that still outgrow the kept room, and one for a microphone that opens after a crash.

## Checking it

In headless Chrome, on the built pages served with the site's headers.

- **The list.** Whole at 1366 by 768 (opens upwards, 396 of 396 px), at 1280 by 900 (downwards) and at 375 by 667 (upwards). On the build of `main` it showed 270 of 396 px at 1366 by 768. At 667 by 375 it scrolls, shows the cue, and End, Home, the arrows and Enter work.
- **The pedal.** 399.5 px tall and the link at 606.5 px, with no line, with the waiting line and with the longest failure sentence, at 1280 px. 466.5 and 697.5 in all three at 375 px. On `main`: 398.5, 450.5, 450.5 at 1280 px, and 398.5, 470.5, 490.5 at 375 px.
- **The crash.** After a forced crash the stream's track read `live` on the build of `main` and `ended` on this one.
- **In tune.** A tone 5.3 cents sharp settled on "+5 cents · in tune" with a green needle and chip, and one 0.3 cents flat on "0 cents · in tune". On `main`: "+5 cents · sharp", and "-0 cents".
- **Not checked:** a real phone, a Mac, a screen reader, Firefox, Safari.
