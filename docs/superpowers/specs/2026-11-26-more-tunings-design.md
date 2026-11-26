# More tunings: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). Two items from the backlog's "Model and code" section: "Mandolin and banjo tunings" and "String chips are keyed by MIDI note". They go together because the second is a bug that the first kind of change can set off.

## Intent

The picker offers guitar, bass and ukulele. A mandolin or banjo player has to use Chromatic, which names the note and lights no string. Give those two instruments a tuning each. And before the list grows further, make the string chips' keys safe for a tuning that has two strings on one note.

## Goals

- "Mandolin - Standard" and "Banjo - Open G" in the picker, after the nine there are.
- Choosing one shows its strings as chips, lights the nearest one, and is remembered across a reload like any other tuning.
- A row of chips never has two with the same key, whatever tuning is added later.
- Every place that names the tunings in words is brought up to date.

## Not goals

- Other tunings for either instrument (a banjo in double C, a tenor banjo, an octave mandolin).
- "Tuning id as a plain string" and the dead `max-h-64` classes, both in the backlog (given).
- Any change to the tuning list's size or scrolling. What the longer list does in the browser is measured and recorded, not redesigned (given).
- Telling the two G chips or the two D chips of the banjo apart by name. That is the backlog item "The two E strings read the same", which now has more cases.

## The notes

Both checked on 2026-11-26 against the English Wikipedia articles, and the MIDI numbers worked out by hand (a note's number is 12 for each octave plus its place in the octave, with C4 at 60 and A4 at 69).

- **Mandolin, standard (given):** G3 D4 A4 E5, which is MIDI 55, 62, 69, 76. "Mandolin": "By far the most common tuning is the same as violin tuning, in scientific pitch notation G3–D4–A4–E5", with 196.00, 293.66, 440.00 and 659.25 Hz at A = 440, and "courses of 2 adjacent strings are tuned in unison".
- **Five-string banjo, open G (given):** G4 D3 G3 B3 D4, which is MIDI 67, 50, 55, 59, 62. "Banjo": "Probably the most common, particularly in bluegrass, is the Open-G tuning G4 D3 G3 B3 D4", and of the short fifth string, "the fifth string is highest".

## Decisions

### Four chips for a mandolin's eight strings (given)

A mandolin's strings are in four pairs, and both strings of a pair are tuned to the same note. The tuning lists each pair once. The tuner hears a note and cannot tell which string of a pair made it, and a player tunes the two one at a time against the same target, so eight chips would be four chips drawn twice. It is said in the comment on `TUNINGS`, where someone reading the code will ask why a mandolin has four notes.

### The banjo's short string comes first (given)

The fifth string is the highest and sits where a guitar's lowest would. The list follows the instrument as a player reads it, as the ukulele's already does with its high G. `nearestString` picks the nearest note wherever it is in the list, so nothing else changes. The doc comment on `TUNINGS` said "low string first", which was already untrue of the ukulele: it now says the strings are in the order they sit on the instrument.

### Labels and ids

Labels follow the pattern there is (given): "Mandolin - Standard", "Banjo - Open G".

The ids are `mandolin` and `banjo`. The existing style: guitar tunings are named for the tuning (`standard`, `drop-d`, `open-g`), and the other instruments for the instrument, with a suffix for a variant (`bass`, `bass-5`, `ukulele`). `banjo-open-g` was the alternative. It was not chosen because it breaks that style, and a second banjo tuning can take a suffix as `bass-5` did. An id is saved in people's browsers and cannot be changed later without sending them back to standard, so this is the one decision here that is hard to undo.

The two go on the end of the list. The order of the list is the order of the picker, and nobody's picker should move under them.

### The key of a string chip

The chips are a mapped list of keyed `<li>` elements. The key was the string's MIDI note. That is unique in all eleven tunings, and would not be in a tuning with two strings on one note. Foldkit's differ finds an earlier element by its key, and with two alike it "can patch the wrong element" (its own warning, shown in development only: `repos/foldkit/packages/foldkit/src/snabbdom/init.ts`).

FOLDKIT.md, "View": key each row by a stable identifier, never by array position, and never derive a key from displayed data. The note is displayed data, so the old key broke the rule before it broke anything else.

1. **The tuning's id and the string's place in the tuning (chosen),** such as `banjo-0`. A string has no id of its own. What identifies it is which tuning it belongs to and which string of that tuning it is. The tuning's id is the identifier the Model holds. The place is stable because a tuning is a constant: its strings are never added, removed or reordered while the app runs, which is the case the rule against positions exists for. Unique whatever the notes are.
2. **The place alone.** Unique within a row, but it is array position alone, which the rule forbids, and with reason: the first string of a guitar and the first string of a bass would share a key, and the runtime would treat one as the other when the tuning changes.
3. **The note and a count of earlier strings on the same note** (`55-0`, `55-1`). Unique, and still made from displayed data.
4. **An id written on every string in the data** (`{ id: 'g3', midi: 55 }`). The most literal reading of the rule. It turns each tuning from a list of numbers into a list of records, for ids that nothing else would use, and a duplicate id would still have to be caught by a test.

What option 1 changes for a visitor: nothing to see. On a change of tuning every chip is now a new element, where before a chip whose note was in both tunings was kept. The chips hold no state and have no transition, so the two are indistinguishable.

Two strings on one note would both be lit, since `nearestString` answers with a note. That is right for a pair in unison, and no listed tuning has one.

### Where the key is made, and its test

`stringKey(tuning, position)` is a pure function in `src/tuning.ts`, and `stringsView` passes its result to `stringView`. The view cannot be handed a made-up tuning (it looks the tuning up from the id in the Model), so the test with two strings on one note is a unit test of that function: a made-up tuning with notes 55, 55, 62, 62 must give four different keys. The same check runs over every listed tuning, so a tuning added later is held to it. A Scene test pins that the chips carry those keys, so the function and the view cannot drift apart.

### Words

- The how-to page's first tip names the tunings: "…ukulele, mandolin or five-string banjo." A new test fails when the list has an instrument the page does not name.
- The home page's intro and its description say "For guitar, bass, ukulele and other stringed instruments". Still true, so left as they are (given). The link-preview picture shows that sentence and does not need retaking.

### Preferences

No change. The saved preference is a tuning id, and `preferencesFromJson` keeps an id only if `isTuningId` knows it, so the two new ids are kept and an unknown one still falls back to standard. One test used `banjo` as its example of an unknown id: it now uses an instrument that is not on the list.

### The detector

No change. Its test already runs every string of every listed tuning at the app's window length, and passes for the new ones. The highest, the mandolin's E5 at 659 Hz, is well under the 1500 Hz ceiling.

## Calls made for Kevin

- **The ids `mandolin` and `banjo`.** If a naming scheme with the tuning in the id is wanted later, these two stay as they are or everyone who saved one goes back to standard.
- **The key includes the tuning's id.** If wrong, the cost is nothing a visitor can see: one more or one fewer DOM element replaced on a change of tuning.
- **Nothing on the how-to page about a mandolin's pairs.** A mandolin player knows the pairs are in unison. If it does confuse, one more tip fixes it.
- **"five-string banjo" in the tip,** where the picker says "Banjo - Open G". A four-string banjo is tuned differently, and the tip is where there is room to say which one this is.

## Left to the builder

The names, the wording of the comments, and the browser check.

## Changes during the build

Recorded on 2026-11-26, after the build.

- **The open list scrolls in a short window.** With eleven options the list is 396 px tall. In headless Chrome at 1280 by 900 and on a 375 by 667 phone it shows whole (on the phone it opens upwards). At 1366 by 768 it has 270 px, shows seven options and scrolls for the other four, the two new tunings among them, with nothing drawn to say it scrolls where the system hides scrollbars. The wheel and the End key both reach the last option. By the same arithmetic it scrolled with nine as well: that list was 326 px tall (`FINDINGS.md`, "A Listbox's open list sizes itself"). Left as it is, and in `docs/backlog.md`.
- **Seen in headless Chrome:** on a change of tuning none of the old chips is kept, as the key says.
- **A test that ties the how-to tip to the list** was not in the plan. Without it, the next tuning for a new instrument would leave the page out of date with nothing to say so.
