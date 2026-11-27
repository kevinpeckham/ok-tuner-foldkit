# Findings

Gotchas and insights from building OK Tuner: what a tool, a pattern or our own process did that was not obvious, why a choice was made, and what to do about it. Add an entry whenever one surfaces, in the same change that met it. Newest at the top of each section; say where the lesson lives so the code can be found.

Rules to follow belong in [`AGENTS.md`](./AGENTS.md). Planned work belongs in [`docs/backlog.md`](./docs/backlog.md). The designs in `docs/superpowers/specs/` record what was decided before each build; this file records what was learned during and after.

Sections: [Why it is built this way](#why-it-is-built-this-way) · [Foldkit and Effect](#foldkit-and-effect) · [Testing](#testing) · [Sentry](#sentry) · [Varlock and the build](#varlock-and-the-build) · [The page and its assets](#the-page-and-its-assets) · [Vercel and domains](#vercel-and-domains) · [The dev server and the VM](#the-dev-server-and-the-vm) · [Tooling and process](#tooling-and-process)

## Why it is built this way

### What is still unheard (2026-11-27, screen readers)

Version 0.8.0 made the tuner usable without sight, and nobody listened to it: no screen reader was to hand. What was checked is what a screen reader is given (Chrome's accessibility tree, the ARIA and HTML specifications, how `@foldkit/ui` wires its components). What a screen reader says was inferred. A person with VoiceOver (macOS and iOS), NVDA (Windows) or TalkBack (Android) should check these first, in this order:

1. **Is the reading spoken at all, and once?** Switch on, play one string and hold it. Expected: the note and its state once, about a third of a second after the note shows ("A2, in tune"), and nothing more while it rings. Not the note alone, not twice, not the cents.
2. **Turning a peg.** Bring a flat string up to pitch. Expected: "flat" first, then "in tune" as it arrives, each once. Listen for announcements piling up behind the playing: a tone crossing the edge every 0.6 seconds produced seven or eight announcements in five seconds (`docs/backlog.md`).
3. **Silence, then the same string again.** Expected: nothing said when the sound stops, and the same words again on the next pluck. This rests on a screen reader not reading out a region that has been emptied and reading it again when the same text returns, which the specification implies and which was not heard.
4. **How a sharp note is said.** "F sharp 3, in tune" was written in words on purpose. Check that it does not come out as "F sharp three sharp" where the second word could be taken for part of the note, and how "E2" is said ("E two" is what is wanted).
5. **The picker.** Expected on focus: "Tuning: Guitar - Standard", that it is a button that opens a list, and "dimmed" or "unavailable" while the tuner is off. On opening: "Tuning", list box, the chosen tuning, its place among eleven. Check that the chosen tuning is not said twice.
6. **The settings menu.** Expected on opening: focus in the field, "A4 (Hz)", its value, and that it can be edited. Escape, Tab and Shift+Tab should each land on "Tuner settings", collapsed. On a phone there is no Tab key: check that swiping out of the menu leaves it in a sensible state.
7. **The string chips.** Moving through them should read "E2", "A2" and so on, in a list called "Strings", with "current" on the lit one. `aria-current` is in the page on that chip, and Chrome's DevTools protocol does not list it among a node's properties, so that Chrome passes it on was not confirmed from this side.
8. **The open list and menu in reading order.** They sit at the start of the document (`docs/backlog.md`). Check that reading on from the open list does not strand the user above the header.
9. **Braille.** The same text goes to a braille display. "F sharp 3" will be long there.
10. **Voice control.** Saying "click Guitar Standard", or "click Tuning", should reach the picker: its name contains the words on it.

- **Where.** The backlog's "Screen readers and keyboard" section holds the known limits. The design is `docs/superpowers/specs/2026-11-26-screen-readers-design.md`.

### The tuner says the note and which way it is off, a third of a second late (2026-11-27, screen readers)

- **Symptom.** A screen reader's user heard the note's name and nothing about which way to turn the peg. Only the big note was a live region, because the line with "sharp" and "flat" in it changes twenty times a second.
- **Fix.** One polite live region, off screen, says the note and one of three states: "E2, flat", "E2, in tune", "E2, sharp". Never the cents. Its text changes only when the note and state on the screen have been the same for seven readings in a row (Kevin's decisions: on a change of state, by the display's own rule for in tune, without chatter at the edge, one region, in the Model).
- **Why it is in the Model.** "The same for seven readings" is memory, and a view has none. The `Listening` state holds an `announcer`: what is spoken, the candidate, and how many readings the candidate has held. `update` steps it once for each reading (`stepAnnouncer`). Time is counted in readings, so there is no timer and no clock, and a Story test plays any stretch of time by sending readings.
- **Why seven.** A reading comes every 50 ms, so seven is 0.3 seconds from the first to the last and 0.35 from the last reading that showed something else. A string at the edge of in tune flips within a few readings. The first readings after a pluck are unsteady. And it is short enough to hear "in tune" while still near where the peg stopped. It also sets the most the region can say: one change every 0.35 seconds.
- **What was measured,** in headless Chrome with tones 5.5 cents sharp of A2, the edge between "in tune" and "sharp", for five seconds each. Held steady: one announcement, or two when the reading drifted across the edge once. Wobbling across the edge 2.5 times a second: the word on the screen changed 24 or 25 times, the region once. Wobbling 0.8 times a second, so that each state lasts 0.6 seconds: seven or eight announcements, 0.5 to 0.7 seconds apart. The same over several runs.
- **Silence.** The screen holds a note through 0.6 seconds of quiet and then clears. The announcer follows the screen: nothing changes while the note is held, and when the screen clears the region is emptied. Emptying is not read out (removed text is not among the changes a live region announces by default), and because the region is then empty, the next note is spoken even when it is the same note in the same state.
- **Why not `role="status"`.** The waiting line already is the page's status region. `aria-live="polite"` with `aria-atomic="true"` is what the note had, and Chrome exposes both regions as polite and atomic.
- **The note and the detail line are ordinary text now.** They can be moved to and read, cents included, and are never announced on their own.
- **Not heard.** See "What is still unheard", above.
- **Where.** `src/intonation.ts`; `shownAnnouncement`, `hearPitch` and `hearNothing` in `src/main.ts`; `announcementView` in `src/view.ts`; "what is spoken" in `src/story.test.ts`.

### In tune is decided in a file of its own, for the view and for `update` (2026-11-27, tuner)

- **What changed.** The rule of the entry below ("In tune is decided on the number as shown") was in `src/view.ts`. `update` now needs the same answer, for what a screen reader is told, and `src/main.ts` cannot import the view, which imports it. A second copy in `main.ts` is how the number and the word came apart before 0.7.2.
- **Fix.** The rule moved to `src/intonation.ts`: `IN_TUNE_CENTS`, `wholeCents`, the green zone's edge, and `intonationOf`, which answers flat, in tune or sharp. The view's word, its two colours, and the announcement all come from that one function. `IN_TUNE_CENTS` is no longer exported from `main.ts`.
- **The rule to keep** is the same: nothing else compares cents with `IN_TUNE_CENTS`.
- **Where.** `src/intonation.ts` and its test; `toDisplay` in `src/view.ts`.

### A control is named by its content, and the extra word goes off screen (2026-11-27, screen readers)

- **Symptom.** The tuning picker was called "Tuning" and nothing said which tuning. It showed "Guitar - Standard".
- **Cause.** The Listbox was given `ariaLabel: 'Tuning'`, which it writes as `aria-label` on its button. An `aria-label` replaces the name the button's content would give (and so does `aria-labelledby`).
- **Fix.** No label attribute. The button's content starts with the word in a span that is off screen (`sr-only`), then the visible label, so the name Chrome computes is "Tuning: Guitar - Standard": what it is, what is chosen, and the visible words whole and in order, which is what someone using voice control says.
- **The open list** is named by the Listbox after its button, which would say the chosen tuning twice on opening. The word has an id, and the view hands the Listbox an `aria-labelledby` for the list that points at it: the list is "Tuning". This relies on a later attribute replacing the Listbox's own (see "A later attribute replaces the one a component set", below).
- **The settings button** keeps its `aria-label`: it shows only an icon, so there is no content to name it.
- **Where.** `tuningPickerView` in `src/view.ts`; "what a screen reader is told" in `src/scene.test.ts`.

### A string chip shows a letter and is read with its octave, and a sharp is a word (2026-11-27, screen readers)

- **Symptom.** The two E strings of a guitar read the same, and the banjo's row read G D G B D.
- **Fix.** A chip holds two spans: the letter, hidden from assistive technology, and the note with its octave, off screen. Chrome exposes "E2 A2 D3 G3 B3 E4". It is text inside the chip and not an `aria-label`, because a chip is a list item, not a control, and a label on a plain list item is not reliably read.
- **Why the letter is hidden and the whole name repeated,** where the brief asked only for the octave to be added. A tuning a half step down is D♯ G♯ C♯ F♯ A♯ D♯. A screen reader may say the sign "♯", name it some other way, or pass over it in silence, and "D2" for a D sharp is the wrong note. So what is read is written in words, "D sharp 2" (`spokenNoteLabel` in `src/pitch.ts`), and the announcement uses the same. The cost: if every screen reader reads the sign well, the words were not needed.
- **The lit chip** carries `aria-current="true"`, as before.
- **Where.** `stringView` in `src/view.ts`; `spokenNoteLabel` in `src/pitch.ts`.

### The chosen tuning can be read while the tuner is off (2026-11-27, look)

- **Symptom.** While off, the picker's text was at 5% and the chips' letters at 10%, as in the original: 1.07 and 1.09 to 1. The tuner looked as if it had no tuning.
- **Fix.** The picker's text is `text-blue-100/55`, 5.22 to 1 against the button (4.5 asked for; the live state is 10.5). The letters are at `opacity-70`, 3.44 to 1 against the chip (3 asked for; live is 6.1). The caret fades to 30% while the picker cannot be opened, and the three dots stay at 10%: the icons are what says "not now".
- **How it was measured.** Computed colours composited in a canvas in the page, so alpha and opacity are counted, then the WCAG ratio.
- **Not changed.** The picker and the menu are still disabled while off (a question for Kevin, in the backlog).
- **Where.** `tuningPickerView` and `stringView` in `src/view.ts`; the classes are pinned in `src/scene.test.ts`.

### How dark the failure line has to be (2026-11-27, look)

- **Symptom.** The failure line was `text-red-950` on the pedal. The backlog said about 4.1 to 1. Measured: 3.91 against the darkest ground under it, 4.07 against the lightest.
- **Cause.** The pedal is a gradient, darkest at the foot, where the line sits. There the ground is about rgb(108, 126, 152), and black itself only reaches 5.08 to 1. A colour that reads as red cannot reach 4.5.
- **Fix.** A colour of the project's own, `failure` in `src/styles.css`: `oklch(0.15 0.06 26)`, a red that is nearly black. 4.79 to 1 at the darkest ground, at 1280, 375 and 320 px (two, three and four lines of text). For comparison, the waiting line's `slate-950` is 4.87.
- **How it was measured.** The line's text is made transparent, a screenshot is taken, and the darkest pixel in the line's box is the ground. The text colour is opaque, so the ratio is exact.
- **If the pedal changes,** measure again: there is under half a point of room.
- **Where.** `failureView` in `src/view.ts`; `--color-failure` in `src/styles.css`.

### In tune is decided on the number as shown (2026-11-26, tuner)

- **Symptom.** A needle at 5.4 cents read "+5 cents · sharp", and one at 5.0 read "+5 cents · in tune": the same number with two different words. A needle a hair flat read "-0 cents", and one a hair sharp "+0 cents". Read from the code first, then seen in headless Chrome with a tone 5.3 cents sharp and one 0.3 cents flat played as the microphone.
- **Cause.** Two rules. The word, the needle's colour and the lit chip's colour came from the needle as the Model holds it, compared with 5. The number was that needle rounded, by `toFixed(0)`, which also writes negative zero as "-0".
- **Fix.** One rule (Kevin's decision): the needle rounded to a whole cent is in tune when it is within `IN_TUNE_CENTS`. `toDisplay` rounds once (`wholeCents`: a half goes away from zero on both sides, and nothing rounds to negative zero) and derives `isInTune` from the result. The detail line prints that number, takes sharp or flat from its sign, and adds a plus only above zero. The marker and the chip read the same `isInTune`.
- **What it changes for a player.** In tune now reaches to just under 5.5 cents either side, where it stopped at 5.0. The green zone of the needle bar is drawn to match, 5.5 either side, from the same constant: at 5 a green needle would have sat outside it.
- **The rule to keep.** Nothing else in the view compares cents with `IN_TUNE_CENTS`. A second comparison somewhere else is how the number and the word came apart.
- **Where.** IN TUNE in `src/intonation.ts` since 0.8.0 (the entry above), before that in `src/view.ts`; "the colours agree" in `src/scene.test.ts`, which checks the number, the word and both colours in one scene for each boundary.

### A line that comes and goes must have its room kept (2026-11-26, look)

- **Symptom.** The "waiting for the microphone" line and the failure line each took their room only when they appeared. Measured in headless Chrome on `main`: the pedal was 398.5 px tall with no line, 450.5 with either at 1280 px, and at 375 px 470.5 with the waiting line and 490.5 with the longest failure sentence, which ran to four lines. The link under the tuner moved down and back by as much.
- **Fix.** Both lines are drawn in one block that always keeps its room (`messagesView`). From 640 px up the block is beside the On / Off button, two lines of text tall, which is the button's own height: the pedal is 399.5 px in every state, one pixel more than before. Below 640 px it is under the button, three lines tall: the pedal is 466.5 px in every state.
- **The cost.** A phone's pedal is 68 px taller all the time. In the backlog, with the way out that was weighed and left (showing the lines on the tuner's screen).
- **How the two lines clear the badge.** The badge sits in the bottom right corner, out of the flow. The row carries `pb-3`, which with the pedal's own padding ends the last line of text 2 px above the badge's lettering, so a line may run the full width. On `main` the four-line sentence on a phone ran 6 px into the badge. To make that room on the desktop the button sits 11.5 px higher than it did.
- **What still moves the page.** The longest sentence at 320 px (four lines, where three are kept) and a long message from the browser itself. In the backlog.
- **The room is measured for one font.** Three lines and two are what headless Chrome on Linux needs. A system font with wider letters could need a line more.
- **Where.** `powerRowView` and `messagesView` in `src/view.ts`; "the room kept for a line" in `src/scene.test.ts`; the design is `docs/superpowers/specs/2026-11-26-rough-edges-design.md`.

### The title does not say "ad-free" or "tracker-free" (2026-11-26, page content)

- **What was asked.** An early backlog item: say "ad-free and tracker-free" in the page title.
- **Decision.** Kevin's, on 2026-11-26: leave the title alone. The site counts visits since 2026-11-25, so "tracker-free" would claim too much, and Sentry attaches an approximate location to an error report ("Sentry attaches a location even when it stores no IP address", below). "Ad-free" is already said where it can be explained: the footer and the Privacy page.
- **Where.** `pageTitle` in `src/view.ts` is unchanged. The backlog item and its note are gone.

### The crash screen is written for a visitor, and announced as an alert (2026-11-26, crash screen)

- **What it replaces.** Foldkit's default crash screen: a white card headed "Application Crash" with the error's message, a pointer to the browser console and a note on how to customise it. It is written for whoever is building the app.
- **What it says.** That the tuner has stopped, and that reloading the page starts it again. One link reloads, one goes to the repository's issues page. No error text, no stack and no Model: Foldkit still logs the error to the console, and the report still goes to Sentry.
- **What it does not say.** That the problem was reported. A report is sent only from the live hosts, and a visitor's browser may block it, so the screen cannot know (Kevin, 2026-11-26).
- **Why an alert and not focus.** A change of page moves focus to the page's heading with a Command. After a crash no Command runs, a view may not touch the DOM, `autofocus` on an inserted element is honoured only while nothing in the page has been focused (seen in Chrome: it took focus on an untouched page and not after a link had been focused), and the Content Security Policy refuses an inline script. `role="alert"` on the heading and the sentence needs none of those: an alert inserted with its text is announced. Seen in headless Chrome: the alert arrives as a new element, not as an old one given a new role. Not checked with a screen reader.
- **Why the reload control is a link.** A button needs either an inline handler, which the policy refuses, or a form, which works but leaves a `?` on the address and replaces a query string. A link to the page's own address is announced as a link, which is what it is.
- **Why there is no footer.** Each of its links would need the `target` described under "A plain link does nothing after a crash", and none is what someone whose tuner has just stopped is after. The version is shown on its own, for someone who writes to us.
- **Why the frame's classes moved to `src/layout.ts`.** The crash screen must look like the site without calling the app's `view`, which may be what threw, and must not fall behind when the look changes. The page ground, the `<main>` and the column are stated once and read by `view`, the header, the footer and the crash screen.
- **Where.** `src/crash.ts`; `crash` in `src/entry.ts`; `src/layout.ts`; the design is `docs/superpowers/specs/2026-11-26-crash-screen-design.md`.

### A string chip is keyed by its tuning and its place, not by its note (2026-11-26, tunings)

- **What was wrong.** Each chip's key was its MIDI note. That is unique in every tuning on the list, so nothing broke. But a tuning with two strings on one note would have put two chips with one key in the same row, and Foldkit's differ finds an earlier element by its key: with two alike it can patch the wrong one. It warns about a duplicate key in development only (`warnOnDuplicateKeys` in `repos/foldkit/packages/foldkit/src/snabbdom/init.ts`, behind `import.meta.hot`), so a test run and a production build say nothing.
- **The rule it broke first.** FOLDKIT.md, "View": key by a stable identifier, never by array position, and never from displayed data. The note is what the chip displays.
- **Fix.** `stringKey(tuning, position)` gives `banjo-0`: the tuning's id and the string's place in that tuning. A string has no id of its own, and that pair is what identifies it. The place is safe because a tuning is a constant: its strings are never added to, removed or reordered while the app runs, which is what the rule against positions is about. The place alone would not do: the first string of a guitar and the first of a bass would share a key.
- **What it changes.** On a change of tuning every chip is now a new element, where a chip whose note was in both tunings used to be kept (seen in headless Chrome: none of the old chips survives). The chips hold no state and have no transition, so nothing shows.
- **Not chosen.** An id written on every string in the data: each tuning would become a list of records, for ids nothing else uses.
- **The guard.** A made-up tuning with notes 55, 55, 62, 62 must get four different keys, and so must every tuning on the list. The view cannot be handed a made-up tuning, which is why the key is a function of its own with a unit test, and a Scene test pins that the chips carry what it returns.
- **Where.** `stringKey` in `src/tuning.ts`; `stringsView` and `stringView` in `src/view.ts`; "stringKey" in `src/tuning.test.ts`; the design is `docs/superpowers/specs/2026-11-26-more-tunings-design.md`.

### A tuning follows the instrument: four chips for a mandolin, the banjo's high string first (2026-11-26, tunings)

- **The mandolin.** Eight strings in four pairs, each pair tuned to one note: G3 D4 A4 E5. The tuning lists each pair once, so there are four chips. The tuner hears a note and cannot tell which string of a pair made it, and a player tunes the two one at a time against the same target. Kevin's decision.
- **The banjo.** Five strings in open G: G4 D3 G3 B3 D4. The short fifth string is the highest and sits where a guitar's lowest would, so it is listed first, as a player reads the instrument. The ukulele's high G was already listed that way. `nearestString` takes the nearest note wherever it is in the list. Kevin's decision.
- **The ids** are `mandolin` and `banjo`, in the style of `bass` and `ukulele`: an instrument's usual tuning is named for the instrument, and a variant takes a suffix, as `bass-5` does. An id is saved in people's browsers, so it cannot change later.
- **The notes were checked** against the English Wikipedia articles "Mandolin" and "Banjo" on 2026-11-26. The sentences are quoted in the design.
- **Adding one more.** The steps are in `AGENTS.md`, "Tunings".
- **Where.** `TUNINGS` in `src/tuning.ts`.

### The tuner says what it is waiting for, by the clock (2026-11-26, microphone)

- **Symptom.** While the browser's permission prompt was open, the On / Off button said "Starting…" and nothing else. Someone who had not noticed the prompt saw a tuner that seemed stuck.
- **Fix.** A press that starts the tuner returns a Command, `WaitBeforeSlowStartHint`, which sleeps 1.2 seconds and reports with a Message. If the tuner is still `Starting` then, `update` sets `isSlow` inside that state, and the view shows one line under the button: "Waiting for the microphone. If your browser is asking for permission, allow it." Leaving `Starting`, in any direction, removes it.
- **Why the clock and not the Permissions API.** Kevin's decision. `navigator.permissions.query({ name: 'microphone' })` can say that the person has yet to be asked. The reason given was that Firefox does not support that name. That is out of date: MDN's compatibility data lists it in Firefox from version 132 (October 2024), Chrome from 64 and Safari from 16. The clock still has two things the query has not: it works in a browser older than those, and it also speaks up when a start is slow with no prompt open. Using the query to show the line at once, with the clock as the fallback, is a possible later change.
- **Why the attempts are numbered.** A Command runs to its end once returned, so a timer can report after its start is over. In any state but `Starting` the report changes nothing. But switch the tuner on, off and on again inside 1.2 seconds, and the first timer reports during the second start. Unnumbered, that showed the line for 0.2 seconds on a start that then opened (seen in headless Chrome with the comparison taken out). So the Model counts starts (`startCount`), `Starting` carries its `attempt`, the Command and its Message carry the same number, and `update` acts on a report only for the attempt in progress. `@foldkit/ui`'s hover intent numbers its delays the same way.
- **Why the status region is always in the page.** The line is announced through `role="status"`. A screen reader announces a change inside a live region it already knows about, and may say nothing when a region arrives with its text already in it (MDN, "ARIA live regions": include the region in the initial markup). So the region is drawn empty from the first render, prerendered file included, and only the paragraph inside it comes and goes. A `role="alert"`, like the failure line, is the exception browsers make. Not checked with a screen reader.
- **What a visitor sees.** A start that needs no prompt took about 0.11 seconds in headless Chrome, so it never shows the line. The line's contrast against the pedal is 4.9:1 at its lowest. The pedal grew by the height of the line while it showed, until 0.7.2 kept its room ("A line that comes and goes must have its room kept", above).
- **No cancel button.** The browser's prompt has one.
- **Where.** `WaitBeforeSlowStartHint`, `startTuner` and `CompletedWaitBeforeSlowStartHint` in `src/main.ts`; `startHintView` in `src/view.ts`; "waiting for the microphone" in both test files; the design is `docs/superpowers/specs/2026-11-26-microphone-polish-design.md`.

### A missing, busy or lost microphone is not a fault (2026-11-25, microphone)

- **Why.** The alert used to show the browser's own words ("Requested device not found"), and the failure went to Sentry as a fault. No microphone, a microphone another program is using, and a microphone unplugged mid-session are the person's situation: there is nothing in a report for us to fix. Each is now a kind of its own (`NotFound`, `Busy`, `Lost`) with a sentence that says what to do, and none is reported. Kevin left the reporting question open in the backlog; this was my call.
- **What it changes for testing.** The usual way to send a Sentry test report was a browser with no microphone, which is now `NotFound` and sends nothing. To send one, make `getUserMedia` reject with an error the app does not know, for example a `DOMException` named `AbortError`, from an init script in the browser.
- **Where.** `MicrophoneFailure`, `microphoneFailure` and `failureSentence` in `src/microphone.ts`; `failWith` in `src/main.ts`.

### A lost microphone is noticed by the readings, not by an event (2026-11-25, microphone)

- **Symptom.** With the microphone unplugged, or its permission taken back, the tuner stayed switched on and silent: the analyser goes on answering, with silence.
- **Fix.** The readings Subscription already runs twenty times a second. Before each reading it asks whether every track of the stream has ended (`hasEnded`), and if so sends `LostMicrophone` in place of a reading. `update` moves the tuner to `Failed` with the kind `Lost`, and `Failed` does not require the microphone, so the runtime closes what is left.
- **Why not the track's `ended` event.** It would need a listener added when the microphone opens and removed when it closes, and a way to turn it into a Message. The poll costs nothing new and cannot leak.
- **Checked.** In headless Chrome, stopping the stream's tracks from outside the app switched the tuner off with the sentence within half a second, and switching it on again worked.
- **Where.** `hasEnded` in `src/microphone.ts`; `measureInput` and `LostMicrophone` in `src/main.ts`.

### The site is public, and only at one address (2026-11-25, going public)

- **What changed.** The `noindex` tag left the pages, each page gained a canonical address, a description and Open Graph tags, and `robots.txt` and `sitemap.xml` were added.
- **Only `www.oktuner.com` is indexed.** The same build answers at Vercel's own addresses. `vercel.json` adds `X-Robots-Tag: noindex` when the host is not the live one (a `missing` condition on the host), and every page's canonical address names the live site whatever host served it.
- **The 404 page keeps `noindex`** and has no canonical address. That is also how the build tells it apart: `renderDocument` is given the rendered page, not the request, so it reads the route back from the page's canonical address, and a page without one is the not-found page.
- **The description is not in the view.** Foldkit's `Document` carries the title and the canonical address, and the runtime keeps both in step as the page changes. It has no field for a description, so `pageDescription` sits beside `pageTitle` and the build writes the tag. It does not change when the page changes inside the app, which only matters to a crawler, and a crawler loads each address fresh.
- **Where.** `canonicalOf` and `pageDescription` in `src/view.ts`; `pageHead` in `src/entry.server.ts`; `vercel.json`; `public/robots.txt`, `public/sitemap.xml`; `src/site.test.ts`.

### The link-preview picture is taken by a script, not by the build (2026-11-25, going public)

- **Why.** Kevin asked for a screenshot of the home page, taken with Browserless. A build cannot photograph the site it is about to become, and a build that depended on another service's answer could fail for reasons that have nothing to do with the code. So `bun run og:image` takes the picture of the live home page and the file is committed.
- **What it costs.** The picture goes stale when the look changes: retake it after the new look is deployed.
- **Details.** 1200 by 630 pixels. The page is taller than that, so the browser drew a scrollbar down the right edge, which the request hides with a style added for the photograph only. The key is `BROWSERLESS_API_KEY`, optional in `.env.schema` because no build needs it, and the script never prints the request's address, which holds the key.
- **Where.** `scripts/og-image.ts`; `OG_IMAGE_URL` in `src/site.ts`.

### Visits are counted, on the live site only (2026-11-25, analytics)

- **Why.** Kevin asked for Vercel Web Analytics, with a Privacy page that says so. Until now the site sent nothing on a visit where nothing went wrong, and the README said so. It now sends one page view per page.
- **What is sent,** by Vercel's documentation: the page, the referring site, the time, an approximate location, and the kind of device, operating system and browser. No cookie. Visitors are told apart by a hash of the request that is discarded after 24 hours.
- **Where it runs.** On the production hostnames only. The script lives at `/_vercel/insights/script.js`, an address Vercel serves, so the dev server has nothing to load; and a preview is not the site. The package's own guess of "development" would load a debugging script from another site, so the mode is set by hand.
- **Why it is not a Command.** Counting is not part of what the app does and nothing in the Model depends on it. The script reports page changes by itself, by watching the address. So it is one call in `src/entry.ts`, like starting Sentry.
- **Where.** `src/analytics.ts`; `src/page/privacy.ts`; `AGENTS.md`, "Privacy".

### Every page has its own first heading, and the site's name is a brand (2026-11-25, pages)

- **Why.** Each page's `<h1>` was "OK Tuner", with the page's name second. Kevin asked for the page's name to be the `<h1>` and the site's name to be a brand in the header, linked to the home page. A screen reader's list of headings then starts with where you are.
- **The home page's heading is not shown.** It is "Tuner", with Tailwind's `sr-only` class: the tuner needs no title above it. It is still where focus moves when you arrive from another page, so there is no visible sign of focus on arriving there. A screen reader reads it out.
- **Landmarks.** The `<header>` and `<footer>` sit beside the `<main>`, not inside it, so they are the page's banner and contentinfo. Foldkit's Scene follows the same rule: `role('banner')` does not find a header inside `<main>`.
- **"Learn More".** The footer's link reads "Learn More" on screen, and carries " about privacy" off screen, so that it means something in a list of links. The visible words come first, so voice control still finds it by them.
- **Where.** `src/header.ts`, `src/footer.ts`, `view` in `src/view.ts`; 'pages' in `src/scene.test.ts`.

### The footer shows a version, not a commit (2026-11-25, footer)

- **Why.** Stem Shovel's footer shows the version and the commit. A commit hash is a value from the build's environment, and a prerendered page needs every value to be the same in the build and in the browser, so it would have to be compiled into both. The version is already in `package.json`, which both read.
- **How.** `src/site.ts` re-exports `version` from `package.json`. Vite takes one field of a JSON file when it is imported by name, so the built script holds the string and not the file: checked by searching the built script for other fields of `package.json`.
- **What it costs.** The number is raised by hand (`AGENTS.md`, "Version"), and says less than a commit would.
- **Where.** `src/site.ts`; `resolveJsonModule` in `tsconfig.json`.

### The pages are prerendered (2026-11-25, prerender)

- **Why.** The server used to send an empty page and a 497 kB script that drew everything. Now the build writes `/` and `/how-to` as HTML (8 kB and 2.4 kB), so the page shows before the script runs, an unknown address is a real 404, and the site is ready to be crawled when `noindex` comes off.
- **Why not render per request.** The app has no per-visitor data on a server, so a function on every visit would add cost and nothing else. The host stays static.
- **How.** Foldkit's Vite plugin bundles the app twice, for the browser and for Node, then calls `renderPage` in `src/entry.server.ts` once for each path in `prerenderPaths` and writes the result. The browser's script calls `Runtime.hydrate`, which takes the HTML over where `Runtime.run` would draw the page from nothing.
- **What it costs.** Foldkit marks this experimental and says to expect breaking changes: after a Foldkit upgrade, run a build and the browser check before anything else. The app no longer shows Foldkit's Flags. A page added to `src/route.ts` must also be added to `prerenderPaths`, and nothing checks that.
- **A page that looks ready before it is.** See the next entry.
- **The script's name changes on every build.** Every deploy, a docs-only one included, makes a returning visitor download the script again. The random build id compiled into it is one of three causes: see "Three things rename the script on a deploy that did not change it".
- **An old page whose script is gone** shows the tuner with a dead On / Off and no message, where it used to be blank. How often Vercel produces that was not checked.
- **Tried first.** A throwaway spike on a branch answered the open questions before the design was written: the views needed no change, and the saved preferences did (next entry).
- **Where.** `src/entry.server.ts`, `src/entry.ts`, the `ssr` option in `vite.config.ts`, `outputDirectory` in `vercel.json`. The design is `docs/superpowers/specs/2026-11-25-prerender-design.md`.

### A prerendered page looks ready before it is (2026-11-25, prerender)

- **Symptom.** The tuner was drawn before the script had run, and a press on On / Off in that time was lost: nothing replays it. With the script held back three seconds, a click at 0.14 s left the tuner off. Found by the review of the prerender branch.
- **Fix.** The tuner has a fifth state, `Booting`, which is where every visit starts and what the build draws. In it the On / Off button is disabled and dimmed. The first Message the running app sends itself, `CompletedLoadPreferences`, moves the tuner to `Off`, so the button comes alive the moment a press can be heard.
- **Why a state and not a flag.** The first version was a boolean, `isReady`, beside the tuner's state. FOLDKIT.md ("Code Style") asks for a union variant where a flag would allow combinations that mean nothing, such as "not ready" and "listening".
- **What a visitor sees.** On a fast connection the button is alive before the page is first painted. On a slow one it is dimmed until the script has loaded.
- **Where.** `TunerState` and `CompletedLoadPreferences` in `src/main.ts`; `powerButtonView` in `src/view.ts`; "before the app is running" in `src/scene.test.ts`.

### A prerendered page cannot start from what the browser has saved (2026-11-25, prerender)

- **Symptom.** In the spike, with "Bass" saved, the prerendered page came back as "Guitar - Standard". The client-rendered site showed "Bass".
- **Cause.** The saved tuning and A4 were Flags, read from `localStorage` before `init`. In a prerendered app the Flags are written into the HTML by the build, and the browser reads them back from there and computes none of its own. The build has no visitor.
- **Fix.** Flags left the app. `init` starts everyone on the defaults and returns a `LoadPreferences` Command, which the runtime runs in the browser after it has taken the page over. Its result sets the tuning and A4.
- **What it costs.** A returning visitor with a saved tuning can see the default tuner first. Measured in headless Chrome: on a fast connection the saved tuning was in place before first paint; on a simulated 4G connection first paint came at 0.36 s and the saved tuning at 0.64 s. The simulation is rough and probably flatters it.
- **The alternative** was to draw the tuning picker and the strings blank until the preferences were read. Then nobody sees a wrong tuning, and everybody sees an empty tuner.
- **Where.** `init`, `LoadPreferences` and `CompletedLoadPreferences` in `src/main.ts`; `src/storage.test.ts`.

### Leaving the tuner's page switches the tuner off (2026-11-25, routing)

- **Why.** "Nothing is recorded" would ring hollow with a microphone open on a page that shows no tuner. Any address change to a route other than `Tuner` sets the tuner to `Off`, and `Off` is all the runtime needs to release the microphone. A failure message is cleared the same way.
- **What it costs.** Coming back from the how-to page, the tuner has to be switched on again.
- **Checked.** In headless Chrome the microphone track read `live` on the tuner's page and `ended` straight after the link was clicked.
- **Where.** `enterRoute` in `src/main.ts`; "routing" in `src/story.test.ts`.

### The route is set in one place, by the address (2026-11-25, routing)

- **Why.** A link click does not change the route. `update` answers `ClickedLink` with a Command that changes the address, the runtime then sends `ChangedUrl`, and only that sets the route. A click goes round the loop twice, and in return the back and forward buttons, which send `ChangedUrl` alone, need no code of their own.
- **What follows.** A link is a plain `<a href>` with no handler. The runtime catches the click on the document, and leaves alone a modified click, a link whose `target` is another tab or frame, and a download link. A link to anything on the same origin counts as internal, so a link to a file such as `/favicon.svg` would be drawn as "Page not found".
- **Where.** `ClickedLink`, `ChangedUrl` and `NavigateInternal` in `src/main.ts`; the `routing` option in `src/entry.ts`; `src/route.ts`.

### Reports are sent only from a list of our own hosts (2026-11-24, Sentry)

- **Why.** The repository is public and the Sentry address (the DSN) is in the source, as it must be for a browser app. Without a check, a fork on someone else's Vercel account, or `bun run dev` on any machine, would report into our project.
- **What it costs.** `localhost` reports nothing, so a development proof must use `https://ok-tuner.bench.lj.dev/`. Vercel previews report nothing either, since 2026-11-25: see [Previews report nothing](#previews-report-nothing-2026-11-25-sentry). And a new domain reports nothing until it is added: see [A new domain reports nothing until it is listed](#a-new-domain-reports-nothing-until-it-is-listed-2026-11-24-sentry).
- **Where.** `reportsFrom` and `PRODUCTION_HOSTNAMES` in `src/sentry.ts`.

### A caught failure is reported by a Command, not where it is caught (2026-11-24, Sentry)

- **Why.** Three ways were weighed (the Sentry design, "Approaches"). Reporting from inside the microphone module is the least code, but it hides a side effect in a mapping function that `update` never sees. A Command returned by `update` shows in the devtools history and is tested like every other Command.
- **What it needed.** `update` has to tell a refusal from a fault, so a microphone failure is a tagged union (`Refused`, `Unsupported`, `Unexpected`) and not a sentence. The view turns the kind into the sentence.
- **Where.** `MicrophoneFailure` in `src/microphone.ts`; `ReportProblem` and `failWith` in `src/main.ts`.

### The environment tag comes from the hostname (2026-11-24, Sentry)

- **Why.** Nothing under `src` reads an environment variable, so tests, lint, typecheck and a `SKIP_VARLOCK` build need no 1Password access. The hostname is the only thing the browser has to say which deployment it is.
- **What it costs.** A hostname cannot say which build it is serving. While previews reported, the production build reached at a deployment's own address (`ok-tuner-git-main-…` or the hashed one) was tagged `preview`. Since 2026-11-25 there are two tags, `production` and `development`, and those addresses report nothing, so the wrong tag can no longer reach Sentry. Telling builds apart properly means a build-time value in `src`, which reopens what tests and `SKIP_VARLOCK` builds need.
- **Where.** `environmentOf` in `src/sentry.ts`.

### One 1Password environment for every stage (2026-11-24, Varlock)

- **Why.** The only secret is the token that uploads source maps, and it is the same for development, preview and production. Vercel holds `OP_TOKEN` and `OP_ENV_ID` and nothing else.
- **Watch for.** A variable set on the Vercel project overrides 1Password without a word. If a second secret ever differs by stage, this choice is the one to revisit.
- **Where.** `.env.schema`.

### The microphone is a managed resource and the readings a subscription (2026-11-24, tuner)

- **Why.** Kevin picked it over one subscription that owns everything (which hides "starting" and "refused" inside a stream) and over wrapping the original engine in a custom element (which leaves the interesting logic outside Foldkit). It is the shape of Foldkit's `websocket-chat` example.
- **What it costs.** Twenty Messages a second through `update` and the devtools history. The history limit is raised from 100 to 500 so it holds more than five seconds of readings.
- **Where.** `managedResources.microphone` and `subscriptions.readings` in `src/main.ts`; `DEVTOOLS_MAX_ENTRIES` in `src/entry.ts`. The tuner design, "Approaches".

### Pitch detection runs in plain loops (2026-11-24, tuner)

- **Why.** Each reading compares millions of samples. Foldkit's "no loops" rule yields here, as it does in Foldkit's own `examples/pixel-art/src/grid.ts`. The exemption is for `src/pitch.ts` alone.

### The note name stays blue-white when in tune (2026-11-24, tuner)

- **Why.** The design said both "the note turns green in tune" and "colours match the original". In the live original the green class is overridden and never shows. Kevin looked at the result and kept it as it is.

## Foldkit and Effect

### Tab in the settings menu went to the far end of the page (2026-11-27, Foldkit)

- **Symptom.** With the settings menu open and focus in the A4 field, Tab closed the menu and put focus on the first link of the page, "OK Tuner". Shift+Tab went to the panel, and once more to the last link of the footer. Seen in headless Chrome during a keyboard walk. It was there before 0.8.0, one Tab press further in.
- **Cause.** An open Popover moves its panel to `#foldkit-portal-root`, the first child of `<body>`, so that nothing clips it. Tab follows the document, not the picture. The Listbox meets the same thing and sends Tab back through its button (`interceptTab` in `anchorSetup`); the Popover passes `interceptTab: false`, because a panel may hold several controls to tab between.
- **Fix.** The view takes the key: `h.OnKeyDownPreventDefault` on the A4 field returns a Message for Tab, which makes Foldkit call `preventDefault`, and nothing for any other key. `update` answers `PressedTabInSettingsMenu` with the Popover's own `close` (`foldA4PopoverClose`), whose `FocusButton` Command puts focus on the settings button. From there Tab and Shift+Tab carry on in the order the page is drawn. Shift+Tab on the panel itself is taken the same way (`h.OnKeyDownSelfPreventDefault`, which ignores keys coming up from a child).
- **The cost.** One more key press than the ideal, which would be Tab straight to the On / Off button. And the handler assumes the field is the menu's only stop.
- **Where.** `leaveOnTab` in `src/view.ts`; `PressedTabInSettingsMenu` in `src/main.ts`; "Tab in the settings menu" in `src/story.test.ts`.

### The Popover's `focusSelector`, and a field focused from code (2026-11-27, Foldkit)

- **What `focusSelector` is.** A view input of `Popover.view`. The panel's Mount (`AnchorPopover`) positions the panel, makes it visible, and on the next animation frame focuses `document.querySelector(focusSelector)` where it would have focused the panel. `Dom.focus` in a Command could not do it: the panel is still hidden when a Command runs.
- **Where focus goes on closing.** Escape, the button and a click outside all end in `RequestedClose`, which returns `FocusButton`: focus on the settings button. Focus leaving the panel closes the menu with no focus Command.
- **Symptom of the first try.** With focus put in the field from code, typing 442 gave "440442". A field reached with Tab has its text selected by the browser. A field focused from code does not.
- **Fix.** A Mount of the app's own on the field, `AttachA4SelectOnFocus`, adds a `focus` listener that selects the text and removes it when the field leaves the page. It is the shape of `@foldkit/ui`'s `AttachComboboxSelectOnFocus`. A Mount is handed the element, so nothing looks it up.
- **The panel has a role and a name.** The bundle gives it `tabindex="0"`. It is now `role="group"` named "Tuner settings".
- **Where.** `settingsMenuView` and `a4FieldView` in `src/view.ts`; MOUNT in `src/main.ts`.

### A later attribute replaces the one a component set (2026-11-27, Foldkit)

- **What happens.** The Listbox spreads `itemsAttributes` after its own attributes on the list, and an attribute given twice keeps the later value. So `h.AriaLabelledBy(...)` in `itemsAttributes` replaces the `aria-labelledby` the Listbox wrote. Event handlers are the exception: all of them run (`updateDataOn` in `repos/foldkit/packages/foldkit/src/html/index.ts`), which is how the settings panel has the Popover's key handler and ours.
- **It is not a documented promise.** A Scene test names the list by role and name, and fails if an upgrade changes the order.
- **Where.** `itemsAttributes` in `tuningPickerView`, `src/view.ts`.

### A crash releases nothing, so the app closes the microphone itself (2026-11-26, Foldkit)

- **Symptom.** After a crash while the tuner was listening, the stream's track was still `live`: the browser went on showing its microphone indicator under a screen that says the tuner has stopped. Seen in headless Chrome against the build of `main`.
- **Cause.** A crash sets a flag that makes the runtime drop every later Message, calls `crash.report`, then `crash.view`, and patches the screen in (`crashWith` in `repos/foldkit/packages/foldkit/src/runtime/renderer.ts`, `renderCrashView` in `crashUI.ts`). It does not close its scope. A managed resource is released when the Model stops asking for it or when the scope closes (`managedResourceFibers.ts`), and after a crash neither happens: the Model never changes again.
- **The hooks are not given the microphone.** They get the error, the Model and the Message. The handle is in a cell inside the runtime.
- **Fix.** `src/microphone.ts` keeps a set of the streams it has open: added when `getUserMedia` answers, removed where the tracks are stopped. `closeOpenMicrophones` stops them. The `crash.report` hook is `Crash.reportThenClose(reportCrash, closeOpenMicrophones)`: the report first, then the closing in a `finally`, so a report that throws does not leave the microphone on, and the report has been made before the closing could throw. The runtime catches whatever the hook throws and draws the screen all the same.
- **This is state outside the Model, on purpose.** It is the only such state in the app. A `MediaStream` is a live browser object and cannot be in the Model, and the runtime, which holds it for us, does not give it up after a crash. Nothing reads the set but `closeOpenMicrophones`, and nothing may decide anything from it: whether the tuner is on is `model.tuner`.
- **Only the tracks are stopped.** That is what turns the microphone and the indicator off. The audio context is left to end with the page.
- **Not covered.** A stream that opens after the crash: the app crashes while the browser is still asking for permission, and the person then allows it. In the backlog.
- **Module state outlives a test.** The set is one per module, so a test that opens a microphone and never releases it leaves a stream for the next test in the file. `src/microphone.test.ts` and `src/app.runtime.test.ts` call `closeOpenMicrophones` in `afterEach`, and a stand-in track needs a `stop` for that.
- **Seen.** Forced crash in headless Chrome: the track read `live` on the build of `main` and `ended` on this one.
- **Where.** OPEN STREAMS in `src/microphone.ts`; `reportThenClose` in `src/crash.ts`; `crash` in `src/entry.ts`; "a crash while the tuner listens" in `src/app.runtime.test.ts`; "the crash hook that reports and then closes the microphone" in `src/crash.runtime.test.ts`.

### A height class on the open list stopped it opening upwards (2026-11-26, Foldkit)

- **Symptom.** In a window 1366 by 768 the open tuning list showed seven of eleven tunings and scrolled for the rest, with 436 px free above its button. The same at 1024 by 768, and on a 390 by 844 phone.
- **What was believed.** That `max-h-64` on the list did nothing, because the Listbox sets `max-height` inline ("A Listbox's open list sizes itself", below). That is true of the list's final height and false of where it opens.
- **Cause.** The Listbox places the list with Floating UI's `flip`, then `shift`, then `size` (`anchorSetup` in `repos/foldkit/packages/ui/src/anchor/anchor.ts`). `flip` moves the list to the other side of the button if it overflows the window where it is. `size` then writes the room left as an inline `max-height`. On the first pass there is no inline value yet, so the class held the list to 256 px. Under the button there were 270 px: 256 fits, `flip` saw no overflow and kept the list below, and `size` let it grow to 270. Every later pass started from a list 270 px tall, which still fitted.
- **Fix.** No height class and no overflow class on the list. Measured at its full 396 px it overflows below and `flip` opens it upwards. In headless Chrome it now shows whole at 1366 by 768, 1024 by 768, 1280 by 720, 1280 by 600, 390 by 844, 375 by 667 and 360 by 640 (upwards), and at 1280 by 900 and 1920 by 1080 (downwards).
- **Where it still scrolls.** A window with less than about 410 px free on both sides of the button: a phone held sideways (667 by 375), and a 320 by 568 phone with the page scrolled. There the list carries `scroll-cue`, a utility in `src/styles.css` that draws a soft dark edge at the top or bottom of the list while there is more that way. It is four background gradients, two fixed to the box and two that scroll with the content and cover them at the ends, so it needs no script and no state, and the Content Security Policy allows it as it does any rule of the site's stylesheet.
- **Not seen on a real phone or a Mac.** The cue was looked at in headless Chrome only. A browser that does not know `background-attachment: local` drops the whole declaration, the covers then stay over the shadows, and no cue shows: no worse than before.
- **The rule.** Never give a Listbox's list a `max-h-...` class. If a list must be shorter, that is a different change: fewer items, or a shorter row.
- **Where.** `tuningPickerView` in `src/view.ts`; `@utility scroll-cue` in `src/styles.css`; "the open list is given no height of its own" in `src/scene.test.ts`.

### A plain link does nothing after a crash (2026-11-26, Foldkit)

- **Symptom.** On a crashed page, a click on an ordinary `<a href>` did nothing at all: not a link to another page of the site, not a link to the page's own address, not a link to another site. Seen in headless Chrome, with links added to a crashed page by hand.
- **Cause.** With routing on, the runtime listens for clicks on links across the document, calls `preventDefault()` and sends a Message in the link's place (`addLinkClickListener` in `repos/foldkit/packages/foldkit/src/runtime/browserListeners.ts`). A crash sets a flag that makes the message queue drop every Message (`messageQueue.ts`), and removes nothing: the listener stays. So the browser is told not to follow the link, and the Message that should have replaced the click is thrown away.
- **Fix.** `target="_top"` on every link of the crash screen. The listener leaves alone a link whose `target` is anything but `_self` (and a click with a modifier key or another button, and a `download` link). The site is never framed (`frame-ancestors 'none'`), so the top-level window is the visitor's own tab, and the link behaves as a plain one would on a page with no Foldkit.
- **An empty `href` is "this page".** `href=""` resolves to the page's own address with its query and without its fragment, so the reload link needs to know nothing about where it is. Seen: from `/?a=1#frag` the browser requested `/?a=1` and a working tuner came back.
- **What Foldkit says about it.** Its type for the crash option notes that no handler can be written and says to "reload or navigate with a raw DOM attribute instead" (`CrashConfig` in `crashUI.ts`). It does not mention that a plain link is cancelled.
- **Only Chrome was tried.** That following a link to the address you are at loads the page again is the HTML standard's behaviour, not checked here in Firefox or Safari.
- **Where.** `browserHandled` in `src/crash.ts`; `brandLinkAttributes` in `src/header.ts`; "after the crash" in `src/crash.runtime.test.ts`.

### Foldkit's own Reload button is refused by the Content Security Policy (2026-11-26, Foldkit)

- **Symptom.** On Foldkit's default crash screen, pressing Reload did nothing. Seen in headless Chrome against a build served with the site's headers: no page was requested.
- **Cause.** The default screen, and Foldkit's `crash-view` example, reload with an inline handler, `h.Attribute('onclick', 'location.reload()')`. `script-src 'self'` refuses inline event handlers.
- **What it means.** Under the policy, which dates from 2026-11-25, a visitor whose tuner crashed had a button that did nothing, until this change. And it still matters: if our own crash view ever throws, Foldkit falls back to its default screen, with that button.
- **Where.** `defaultCrashView` in `repos/foldkit/packages/foldkit/src/runtime/crashUI.ts`; `headers` in `vercel.json`.

### What a crash view is given, and what the runtime does with it (2026-11-26, Foldkit)

- **The arguments.** `crash.view(context, h)`. The context is `{ error, model, message }`: always an `Error` (anything else thrown is wrapped in one), the Model as it was, and an `Option` of the Message being handled. `h` is an `HtmlBuilder<never>`, so an event handler does not compile. A view written for `HtmlBuilder<Message>` does not accept it, which is why `Header.view` became generic.
- **The order.** The runtime logs the error to the console, calls `crash.report`, then `crash.view`, then patches the result where the app's page was. A `report` that throws is caught and logged. A `view` that throws is caught too, and the default screen is drawn in its place. The first crash wins: a second is ignored.
- **The document.** The crash Document's `title` is written to `document.title`. A `lang` that is left out is left as the page has it. A `canonical` that is left out goes back to the one the file was served with. Seen: `lang="en"` and the home page's canonical address were still there after a crash.
- **A prerendered page** makes no difference: by the time anything can crash the runtime has taken the server-drawn root over, and the crash screen is patched in like any render. The build draws none of it. A crash during the takeover's own first render was not tried.
- **A throw in a Subscription is a crash,** with no Message: its stream is run under `Effect.catchCause(cause => crashWith(cause, Option.none()))` (`subscriptionFibers.ts`).
- **The microphone stays open, unless the app closes it.** Nothing closes a managed resource when the runtime crashes: after a crash while listening, the stream's track was still `live`, so the browser went on showing its microphone indicator until the page was reloaded. Since 0.7.2 the report hook closes it ("A crash releases nothing, so the app closes the microphone itself", above).
- **Where.** `repos/foldkit/packages/foldkit/src/runtime/crashUI.ts` and `renderer.ts` (`crashWith`); `src/crash.ts`.

### A disabled Button still looks pressable unless the classes say otherwise (2026-11-26, Foldkit)

- **Symptom.** While the tuner was starting, the On / Off button was disabled and still showed the pointing hand and changed colour under the pointer.
- **Cause.** `Button` from `@foldkit/ui` marks a disabled button with `aria-disabled="true"` and `data-disabled` and leaves the native `disabled` attribute off, so that the button can still be reached with the keyboard. The browser therefore treats it as an ordinary button: `cursor-pointer` and a `hover:` class go on applying.
- **Fix.** The cursor and the hover colour are chosen from the state (`powerButtonLook`): the ordinary cursor and no hover colour while booting or starting, the pointing hand and the hover colour otherwise. Starting is not dimmed, because the spinner already says it is busy.
- **Where.** `powerButtonLook` and `powerButtonView` in `src/view.ts`; "the power button under a pointer" in `src/scene.test.ts`.

### The tuner could not hear a five-string bass's low B (2026-11-25, pitch)

- **Symptom.** The list offers "Bass - 5-string", whose lowest string is 30.87 Hz. The detector searched from 40 Hz, so that string read as nothing at all. Listed in the backlog as untested; a test confirmed it.
- **Fix.** The floor is 28 Hz. The window is 4096 samples, which at 48 kHz holds 2.6 periods of that B, above the two the method needs.
- **What it costs.** The search covers about 1,700 lags where it covered 1,200, so each reading does about 40% more arithmetic.
- **The guard.** A test now runs every string of every tuning in the list through the detector at the app's real window length, so a tuning cannot be added whose strings it cannot hear.
- **Where.** `detectPitch` in `src/pitch.ts`; `src/pitch.test.ts`.

### Closing a child component from the parent (2026-11-25, Foldkit)

- **Symptom.** With the settings menu open, going back to another page and forward again showed the menu open on a tuner that was off, and the first press of On / Off only closed it.
- **Fix.** Leaving the tuner's page closes the menu, through the Popover's own `close`, folded with `Update.foldChildStep` and run after the route change with `Update.combine`. Its `Closed` OutMessage puts the A4 text back, as when the person closes it.
- **Not by replacing its Model.** Setting the menu's Model back to a fresh one would skip whatever the component does on closing.
- **What closing returns.** One Command, `FocusButton`. An older test lists `UnlockScroll` and `RestoreInert` beside it with `resolveAll`, which passes although they are never returned: `resolveAllExact` showed it.
- **Where.** `foldA4PopoverClose` and `ChangedUrl` in `src/main.ts`.

### The app's root element is a `<div>`, so the footer can be a landmark (2026-11-25, footer)

- **Why.** A `<footer>` is the page's "contentinfo" landmark only when it is not inside `<main>`. The view's root used to be the `<main>`, and a view has one root, so the root became a `<div>` holding the `<main>` and the `<footer>`.
- **How it is pinned.** Foldkit's Scene knows the rule: `role('contentinfo')` does not find a footer inside a `<main>`. The footer's tests are scoped with `within(footer, ...)`, because the Built With page has links of the same names in its own text.
- **Where.** `view` in `src/view.ts`; `src/footer.ts`; 'footer' in `src/scene.test.ts`.

### A link to another site needs nothing special (2026-11-25, footer)

- **What happens.** The footer and the Built With page hold the app's first links to other sites. Each is a plain `<a href>` with a full address. The runtime reports the click as `UrlRequest.External`, and `update` answers with `LoadExternal`, which had been written for the routing change and never run. In headless Chrome a click on "GitHub" loaded github.com.
- **What was left out on purpose.** No `target` and no `rel`: the links open in the same tab, as Stem Shovel's do, and `rel="noopener"` only matters with a new tab.
- **Copying from Stem Shovel.** Its Built With page labels each section with `aria-labelledby="built-{title}"`, and a title such as "The app" makes an id with a space in it, which that attribute reads as two ids. The copy here has no such attribute. The original is as it was.
- **Check the addresses.** Every address was fetched before it went in. The paper on McLeod's pitch method did not answer at the address I had for it, so that card links to this app's `src/pitch.ts`.
- **Where.** `src/footer.ts`, `src/page/builtWith.ts`, `src/site.ts`.

### What prerendering asks of the code (2026-11-25, prerender)

- **`init` and `view` must not depend on the browser.** The build runs them in Node. Ours needed no change, because they were pure already. The server bundle also imports `sentry.ts` through `main.ts`, which is safe because nothing there runs on import: Sentry starts from `src/instrument.ts`, which only the browser's entry imports.
- **There is no source `index.html`.** The build starts from the script, so a source `index.html` is simply not read. What the plugin refuses is an `index.html` already in the browser output, from `public/` or a stale build. The stylesheet is imported from `src/entry.ts`, which needs `src/vite-env.d.ts` for the compiler to accept it. Head tags move to `renderDocument`.
- **The output moves** to `dist/client`, with the Node bundle in `dist/server`. `vercel.json` has to say so.
- **Commands from `init` run in the browser only.** The build renders the first Model and stops.
- **`container` is null on a prerendered page.** There is no `#root`: the runtime finds the root the build marked. The option is still required.
- **The takeover is strict.** By Foldkit's documentation, a page with no server-drawn root, or with one from another deployment's build, is made inert and the app does not start. Not seen, and not tested.
- **A page that does not match is rebuilt, silently.** The browser keeps the elements that match what it would draw and replaces the rest, with nothing in the console. On the built site that happens at `/index.html` and `/how-to/index.html`: the file's page shows, then "Page not found" replaces it.
- **In development** the dev server renders every address through `renderPage`, so an unknown address is the app's own not-found page with status 200. The page it draws is unstyled until the script has run, because the dev server leaves the stylesheet to the script. One headless run logged a "Slow patch" warning from Foldkit (10.8 ms against a budget of 8 ms) for the first patch. It is a development diagnostic and was not seen on the built pages.
- **Where.** `src/entry.server.ts`, `src/entry.ts`, `vite.config.ts`.

### A page change is silent unless the app moves focus (2026-11-25, routing)

- **Symptom.** After a link was activated the new page was drawn, focus sat on `<body>`, and the window stayed scrolled where it had been. A screen reader would have said nothing. Found by the review of the routing branch, in headless Chrome.
- **Cause.** A browser moves focus and scroll when it loads a page. A change of route is not a page load, and the Foldkit runtime does neither for you.
- **Fix.** `ChangedUrl` returns a `FocusPageHeading` Command when the page changes. It scrolls to the top and focuses the heading that names the page, which each page marks with `pageHeadingAttributes` (an id and `tabindex="-1"`). Foldkit's own website does the scrolling half the same way.
- **What was seen after.** Focus on the `h2` of the how-to page and the `h1` of the tuner's, with the window at the top. After the back button the browser restores its own scroll position for that history entry, which is the usual behaviour.
- **In a scene** `tabindex` is the property `tabIndex`: `toHaveAttr('tabIndex', '-1')`.
- **Where.** `FocusPageHeading` and `ChangedUrl` in `src/main.ts`; `src/page/link.ts`.

### Routing changes the signature of `init` (2026-11-25, routing)

- **What happens.** A `routing` option lets `init` take the address as a second argument (`Runtime.RoutingApplicationInit`). Nothing forces it: an `init` that still takes the flags alone compiles with `routing` set, and simply never learns the address. The reverse is an error, reported at `makeApplication` in `entry.ts`: an `init` with two arguments and no `routing` option.
- **What it costs.** Every caller of `init` changes, and tests are callers: the fixtures in `story.test.ts` and `scene.test.ts`, and one test in `sentry.test.ts` that builds a Model for a crash report.
- **Where.** `init` in `src/main.ts`; `urlOf` in the test files.

### What a path matches (2026-11-25, routing)

- **What was seen.** `/how-to/`, `/how-to?x=1` and `/how-to#y` are all the how-to page: a trailing slash, a query string and a fragment are ignored. `/How-To` and `/how-to/extra` are not found: matching is case-sensitive, and a router must use up every segment.
- **Where.** `src/route.test.ts` pins each of these.

### A saved Model that no longer fits the Schema is dropped (2026-11-25, Foldkit)

- **What it is.** In development the Vite plugin restores the Model after a reload. A Model saved before a field was added, such as `route`, fails the Schema's decode, and the runtime then runs `init` as on a first visit.
- **Source.** Read in `runtime.ts` in `repos/foldkit` (`decodePreservedModel`, `onFailure: () => runInit`). Not exercised by hand.

### Foldkit catches crashes itself, so Sentry's own handlers never see them (2026-11-24, Sentry)

- **What happens.** The runtime catches an error thrown in `update`, in the view, in a Command, in a Subscription or in a managed resource's lifecycle, and shows a crash screen. Nothing reaches `window.onerror`.
- **What to do.** The `crash: { report }` option of `Runtime.makeApplication` is the only route for those. Sentry's global handlers still cover what is thrown outside the runtime.
- **Since 2026-11-26** the crash screen is the app's own (`src/crash.ts`), given as `crash.view` beside `report`. The report is unchanged and still comes first.
- **Where.** `src/entry.ts`, `reportCrash` in `src/sentry.ts`.

### Sentry must start before any other module is evaluated (2026-11-24, Sentry)

- **What happens.** Imports are evaluated before any statement in the file that imports them. A `Sentry.init()` call written as the first statement of `src/entry.ts` would still run after the whole app had loaded.
- **What to do.** Start it from a side-effect import that is the first import: `import './instrument'`. Tests never import `entry.ts`, so they never start Sentry by accident.

### Blocked site storage throws while the storage layer is built, outside the typed error channel (2026-11-24, tuner)

- **Symptom.** With site data blocked, the page crashed at start-up and again on saving a preference. The final review found it; no test had.
- **Cause.** Reading `localStorage` throws while `BrowserKeyValueStore.layerLocalStorage` is being built. That is a defect, not a typed failure, so a handler placed before the layer is provided never sees it.
- **Fix.** `Effect.provide(layer)` first, then `Effect.catchCause`. Blocked storage now means default preferences and an unsaved choice.
- **Where.** `LoadPreferences` (which was the `flags` Effect until 2026-11-25) and `SavePreferences` in `src/main.ts`; `src/storage.test.ts`.

### In development the page can boot already "listening" (2026-11-24, tuner)

- **What happens.** After a full reload, Vite restores the Model without running `init`. The page can start in `Listening` before the microphone has been acquired again. Production never restores a Model.
- **What it shaped.** The readings stream looks the microphone up on every tick and treats "not available" as an empty tick, where a single lookup would leave the tuner on with no readings. `update` accepts "acquired" while already `Listening`.
- **Still open.** The restored audio context may stay suspended until a click. In the backlog.
- **Where.** `measureInput` in `src/main.ts`.

### The Effect lint refuses `unknown` in an error channel (2026-11-24, tuner)

- **What happens.** `bun run lint` runs the Effect rules with `--deny-warnings`. An Effect that can fail with `unknown` fails the lint.
- **What to do.** Fail with a typed `Data.TaggedError` and classify the raw value at the edge. Foldkit's `onAcquireError` still hands over `unknown`, so the classifier takes `unknown` and reads the error by property (`name`, `message`), not by `instanceof`.
- **Where.** `MicrophoneError` and `microphoneFailure` in `src/microphone.ts`.

### An open list or menu hides behind the tuner body without a z-index (2026-11-24, tuner)

- **Symptom.** The open tuning list was drawn behind the tuner. A screenshot showed it; the tests could not.
- **Fix.** `z-20` on the Listbox's items panel and on the Popover's panel, `z-10` on the backdrops.
- **The backdrop needs it too.** Without `z-10` a click on the tuner body does not reach the backdrop, so it would not close the open list.
- **Where.** `tuningPickerView` and `settingsMenuView` in `src/view.ts`.

### The `#root` element does not survive the first render (2026-11-24, Foldkit)

- **What happens.** Foldkit's documentation says the view is patched "into the container". In the running page the view's root element (the `<main>`) takes the container's place: `document.getElementById('root')` is null once the app has drawn.
- **What to do.** Do not style, select or measure `#root`. Seen in headless Chrome while the comments were being written.
- **Since 2026-11-25** the pages are prerendered and there is no `#root` at all: the view's root, now a `<div>` holding the `<main>` and the footer, is in the HTML the build writes.

### `update`'s return type must name the microphone service, though no Command uses it (2026-11-24, Foldkit)

- **What happens.** `Runtime.makeApplication` takes the app's set of services from the return type of `update`. The subscription needs the microphone. Remove `MicrophoneService` from `UpdateReturn` and `src/entry.ts` stops compiling, with an error about the subscription.
- **Where.** `UpdateReturn` in `src/main.ts`.

### The open tuning list scrolls in a short window (2026-11-26, Foldkit)

- **What happens.** The Listbox gives the open list whatever height is left between the button and the edge of the window, less 8 px, and lets it scroll. With eleven tunings the list wants 396 px. Measured in headless Chrome: at 1280 by 900 it opens downwards and shows whole (401 px allowed). At 375 by 667 and at 1280 by 720 it opens upwards and shows whole. At 1366 by 768 it opens downwards with 270 px, shows seven tunings, and scrolls for the other four. At 320 by 568 it has 325 px and scrolls for the last two.
- **Can every tuning be reached.** Yes: the wheel scrolls the list, and the End key moves to the last option and brings it into view.
- **What was not good.** Nothing said the list scrolled where the system hides scrollbars, and the newest tunings were the ones out of sight.
- **Since 0.7.2** the list opens upwards at 1366 by 768 and shows whole, and carries a cue where it still scrolls. The measurements above are of the list as it was ("A height class on the open list stopped it opening upwards", above).
- **Where.** `tuningPickerView` in `src/view.ts`.

### A Listbox's open list sizes itself (2026-11-24, Foldkit)

- **What happens.** The Listbox's anchoring code sets `max-height` and `overflow-y` as inline styles on the open list, which beat classes. `max-h-64` and `overflow-y-auto` on the tuning list therefore do nothing: in the browser the list was 326 px tall against the 256 px the class asks for.
- **Corrected on 2026-11-26.** "Do nothing" was wrong about `max-h-64`. It did not limit the list's final height, and it did decide which side of the button the list opened on. Both classes are gone ("A height class on the open list stopped it opening upwards", above).
- **Where.** `tuningPickerView` in `src/view.ts`.

### Comments: Foldkit's rule, and why this project breaks it (2026-11-24, process)

- **Foldkit's rule.** `FOLDKIT.md` says not to explain code in comments, and to reserve `// NOTE:` for behaviour that would mislead a careful reader. Plain comments written during the Sentry build were converted in review for that reason. Nothing in the lint checks it.
- **This project.** Later the same day Kevin asked for the opposite: verbose comments throughout, so the code can be read to learn Foldkit and shown to the team. `AGENTS.md` records it as a convention that differs from Foldkit's defaults.
- **What it costs.** Comments go stale. A change to code must change the comments beside it, and a statement about Foldkit must be checked against `FOLDKIT.md` or `repos/foldkit/` before it is written.
- **How it was checked.** The comments were added without touching code: each file, with comments stripped, was compared before and after.

## Testing

### What a screen reader is given is read from Chrome, and what it says is not (2026-11-27, screen readers)

- **Names and states.** Chrome's own accessibility tree comes over the DevTools protocol: `Accessibility.getFullAXTree` on a CDP session gives each node's role, computed name and properties (`disabled`, `expanded`, `selected`, `focused`, `live`, `atomic`). That is where "Tuning: Guitar - Standard" and "A2, in tune" were confirmed. Playwright's `ariaSnapshot()` and `getByRole(..., { name })` agree, and compute names with Playwright's own code, not Chrome's.
- **What the tree does not show.** `aria-current` is not among the properties the protocol lists, so the lit chip was checked as an attribute in the page.
- **How often the region speaks.** A `MutationObserver` in the page records every change of the region's text and of the word on the screen, with times. Sampling from outside would miss changes.
- **A tone at the edge.** A steady tone at the edge of in tune settles on one side. To make the edge flutter, the tone's pitch is swung a cent and a half either side of it, with the phase carried from sample to sample so there is no click.
- **The keyboard.** Tab, Shift+Tab, Enter, Space, the arrows and Escape through the page, printing `document.activeElement` and its computed outline after each, with a screenshot of each focused control.
- **axe-core.** Installed in the scratch folder, not the project. Its source is read from `node_modules` and run with `page.evaluate`, which goes through the DevTools protocol and is not stopped by the site's Content Security Policy. Screens scanned: the tuner off, listening, with the list open, with the menu open, with the waiting line and with the failure line at 375 px, the three other pages, the 404 and the crash screen. One violation, on two screens: `region`, for the open list and the open menu (`docs/backlog.md`). What axe could not decide was text on a gradient, which was measured by hand.
- **Where.** The scripts were session scratch (`screen-readers.ts`, `axe.ts` and `make-wobble-wav.ts` in the smoke folder), like the others ("Checking the real page in headless Chrome, with and without a microphone", below).

### A `Mount.expectEnded` step works once (2026-11-27, tests)

- **Symptom.** A Scene step made once, `const gone = Mount.expectEnded(A, B, C)`, and used in several scenes passed in the first and failed in the rest, at the end of the scene: "I found Mounts that ended without being acknowledged", naming all three.
- **Cause.** The step copies its list of Mounts with Effect's `Array.fromIterable`, which returns an array as it is, and then removes each Mount it finds from that list. The list is the step's own, so after one use it is empty, and the next scene's step acknowledges nothing. Read in `expectEndedMountsStep` in `repos/foldkit/packages/foldkit/src/test/scene.ts`.
- **Fix.** Make the step afresh for each scene: `const gone = () => Mount.expectEnded(A, B, C)`. An array of `Mount.resolve` steps can be shared, and is.
- **Where.** `settingsMenuGone` in `src/scene.test.ts`.

### A Scene's `keydown` calls the handlers of one element (2026-11-27, tests)

- **What happens.** In a browser an Escape pressed in the A4 field travels up to the panel, where the Popover's handler closes the menu. In a Scene, `keydown(field, 'Escape')` reaches only the field's own handler and is ignored. Send the key to the element that holds the handler.
- **Useful with it.** `expectHandled()` passes when the last interaction's handler produced a Message, which is what makes `h.OnKeyDownPreventDefault` call `preventDefault`, and `expectIgnored()` when it produced none. That is how the scenes show that Tab is taken from the browser and a digit is not.
- **Where.** "Tab in the A4 field" and "other keys in the A4 field" in `src/scene.test.ts`.

### A boundary is checked in a real browser with a tone a few cents off (2026-11-26, tuner)

- **How.** Chrome plays a WAV file as the microphone, so a tone at 441.349 Hz is an A4 5.3 cents sharp and one at 439.924 Hz is 0.3 cents flat. The detector reads them closely enough: the page settled on "441.3 Hz · +5 cents · in tune" and "439.9 Hz · 0 cents · in tune". On the build of `main` the same tones read "+5 cents · sharp", and "-0 cents" with a few "+0 cents".
- **The needle wanders before it settles.** In the first second the first tone read from +3 to +6, because the fake microphone starts unsteadily and the needle is smoothed. So the check does not rest on one reading. It samples the page forty times and asks two things: that the number, the word and both colours agree in every sample, wherever the needle is, and that the ending seen most often in the second half of the samples is the one expected.
- **One reading of the page per sample.** The line, the marker's class and the chip's class are read in a single call into the page, so they come from the same drawing.
- **Where.** The script was session scratch (`rough-edges.ts` in the smoke folder), like the others ("Checking the real page in headless Chrome, with and without a microphone", below). The same script measures the pedal in three states and opens the tuning list at four window sizes.

### A click that opens a component is three steps in a Scene, and its closing a fourth (2026-11-26, tests)

- **What happens.** `click` on the tuning picker in a Scene is not enough to use the list. The Listbox's update returns a Command (`FocusItems`), and the open list is drawn with two Mounts (`AnchorListbox` on the panel, `PortalListboxBackdrop` on the backdrop). The next interaction throws while any of the three is pending.
- **The steps.** `Command.resolve(Listbox.FocusItems, Listbox.Message.CompletedFocusItems())`, then `Mount.resolve` for each Mount with the Listbox's own Message. They may come in any order. The settings menu is the same without the Command: a Popover that is not modal returns none when it opens, and a modal one would add `LockScroll` and `InertOthers`.
- **Closing needs a step too.** When the list or the menu closes, its two Mounts leave the page, and the scene fails at its end ("Mounts that ended without being acknowledged") unless `Mount.expectEnded(...)` names them, even though both were resolved earlier.
- **Choosing returns two Commands.** With the list open, a choice returns the Listbox's `FocusButton` and the app's `SavePreferences`. With it closed, as two older Story tests have it, only the save.
- **Where it was read.** `repos/foldkit/packages/ui/src/listbox/single.test.ts` ("still opens from the button and closes on Escape"), and `expectEndedMountsStep` in `repos/foldkit/packages/foldkit/src/test/scene.ts`.
- **Where.** OPENING BY A CLICK in `src/scene.test.ts`; "choosing from the open list" in `src/story.test.ts`.

### The real app runs in happy-dom, with a working address bar and no microphone (2026-11-26, tests)

- **What works.** A runtime started on the real app with routing cancels a click on a link, `history.pushState` moves `window.location`, the page, the title and the focus follow, and `history.back()` and `history.forward()` fire `popstate`. `window.location.assign` can be replaced with `vi.spyOn`, which is how a link to another site is tested without happy-dom going to fetch it.
- **What does not exist.** `navigator.mediaDevices` and `AudioContext`. Left alone, the tuner in happy-dom says the browser cannot open the microphone. The test replaces both globals with a stand-in, as `src/microphone.test.ts` does, and the runtime then really opens it, reads it every 50 ms and closes it.
- **Why a runtime and not a unit test for the readings.** `measureInput` asks for the microphone with `Microphone.get`, and the service behind it is a field Foldkit marks internal (`_tag` in `repos/foldkit/packages/foldkit/src/managedResource/managedResource.ts`). Only a runtime supplies it. Foldkit tests its own managed resources the same way (`managedResourceLifecycle.test.ts`).
- **Three traps.** The first drawing of the whole tuner takes longer than one frame in happy-dom, and the runtime prints a warning with the whole Model in it: `slow: false` in `makeApplication` silences it. A Message is handled before the page is drawn again, so the stand-in may already be closed while the button still reads as on: wait for the page, not only for the spy. And the address outlives a test: put it back with `history.replaceState` afterwards.
- **Waiting.** `vi.waitFor(expectation, { timeout, interval })` tries an expectation until it holds and fails with the last error, which is shorter than a loop written by hand. The two checks that readings have stopped are the only fixed waits, 150 ms each.
- **What it leaves to a browser.** `src/entry.ts` itself and `Runtime.hydrate` over a prerendered page (in the backlog), layout, and a real microphone.
- **Where.** `src/app.runtime.test.ts`. Five tests take about 0.9 seconds.

### The "no IP address" mark is inside the event, and only the transport sees it (2026-11-26, Sentry)

- **What happens.** With `dataCollection.userInfo: false` the browser client puts `settings: { infer_ip: 'never' }` in its SDK metadata (`BrowserClient` in `@sentry/browser`'s `client.js`). For an error report it reaches the wire inside the event, at `sdk.settings.infer_ip`. The envelope's header has an `sdk` field too, with the name and version only.
- **Why `beforeSend` cannot check it.** The SDK merges the metadata into the event while it builds the envelope (`createEventEnvelope` in `@sentry/core`), which is after `beforeSend` has run. The event the hook is handed has `sdk.integrations` and nothing else. An event object kept by the hook does show the mark once `Sentry.flush()` has returned, because the SDK writes to the same object: an assertion there would pass, on a side effect and not on what was sent.
- **How it is read.** From the envelope the recording transport keeps: the first item's payload. The SDK types a payload as any of the things an envelope can carry, and the lint allows no type assertion, so a small helper follows a path of keys through plain data with `Predicate.hasProperty`.
- **Checked the hard way.** With `userInfo: true` the mark reads `'auto'` and the test fails.
- **Where.** "what is put on the wire" in `src/sentry.test.ts`.

### An export of an ES module cannot be replaced by a spy, but the SDK's scope can (2026-11-26, Sentry)

- **Symptom.** `vi.spyOn(Sentry, 'captureException')` throws: `Cannot spy on export "captureException". Module namespace is not configurable in ESM.`
- **What to do.** `Sentry.captureException` calls `getCurrentScope().captureException(...)`, and the scope is an ordinary object: `vi.spyOn(Sentry.getCurrentScope(), 'captureException')` works. With an implementation that throws, the real `reportMicrophoneProblem` throws, which is what the test of `ReportProblem`'s own catch-all needed. The scope outlives `Sentry.close()`, so `vi.restoreAllMocks()` runs after each test.
- **Guard against the SDK changing.** The test first asserts that `reportMicrophoneProblem` does throw. If a later SDK stopped going through the scope, it would fail there and not pass with nothing thrown.
- **What was tried first.** A stack parser that throws, passed as an option. The report did not throw.
- **Where.** "completes when the report itself throws" in `src/sentry.test.ts`.

### The blocked-storage test for Sentry ran with reporting switched off (2026-11-26, Sentry)

- **What was known.** The test passes with or without the `try` in `initSentry`, because this SDK version does not read site storage when it starts with our options. (The only code in it that does is the linked-traces part of browser tracing, which is not installed.)
- **What was not.** It also ran on `localhost` with no `enabled: true`, and an SDK that is switched off sets up no integration at all. So it would have passed even with an SDK that did read storage.
- **What was done.** The test now starts the SDK enabled, and still cannot fail today: its comment says so. A second test stands in for a later SDK: an integration whose `setup` reads `sessionStorage`. With storage blocked that makes `Sentry.init` throw, and the test fails when the `try` is removed.
- **Where.** The two "blocked storage" tests in `src/sentry.test.ts`.

### A test cannot hand `view` a builder, so Foldkit's server renderer calls it (2026-11-26, tests)

- **What happens.** `view(model, h)` wants an `HtmlBuilder<Message>`. The one builder Foldkit exports, `inertHtml`, is an `HtmlBuilder<never>`: it is for markup with no handlers, and the compiler refuses it for the tuner's view. (The crash view takes it, because a crash view sends no Message.)
- **What to do.** `Server.renderToString` calls the real `view` with a builder of its own, and what it returns carries the `title` and `canonical` of the Document the view gave back, unchanged (`repos/foldkit/packages/foldkit/src/experimental/server/server.ts`). `renderApplication` in `src/entry.server.ts` wraps it.
- **It was already covered.** `src/entry.server.test.ts` reads the title of all five pages and the canonical address of four out of the finished HTML. Breaking `view` to return a fixed title fails seven of its tests, and leaving the canonical address out fails nine. The table in `src/view.test.ts` says the same thing where a reader looks for it.
- **Where.** "the Document the view returns" in `src/view.test.ts`.

### Put a broken line back from a saved copy, not by replacing in reverse (2026-11-26, process)

- **Symptom.** A script broke one line on purpose, ran a test, and undid the break by replacing the new text with the old. The break had turned `[a4FieldView(model, h)],` into `[],`, and the first `[],` in the file was in a comment 800 lines higher. The undo rewrote the comment and left the break in place.
- **What to do.** Keep the file's text from before the break and write that back, then compare. A replacement is only safe in the direction that was checked to match once.
- **The habit this belongs to.** Every test added after the code is broken once to see it fail ("A test can pass because the thing it guards never runs in a test", below). The pull request for the test debt lists each breakage and the test that caught it.

### A browser's cache is watched from Chrome's own network events (2026-11-26, caching)

- **What happens.** Nothing in the suite can see a browser's cache, and neither the dev server nor Vite's preview sends the headers in `vercel.json`.
- **What to do.** Serve the build with a static server that applies the header rules, open the page twice in one browser context (two tabs of one context share a cache), and listen to the DevTools protocol's `Network` events. They say for each file whether it came from the cache and how many bytes crossed the network.
- **Three traps.** A route installed with Playwright's `page.route` switches the browser's cache off, so the script installs none. `Network.responseReceived` reports a file the server answered 304 for as the 200 that is in the cache: the status on the wire is in `Network.responseReceivedExtraInfo`. And a plain file response from Bun carries no `ETag` and answers no conditional request, so without help every repeat visit downloads everything.
- **The static server changed.** It used to add the headers of every rule that has no condition to every response. With the rule for `/assets/` that would have marked the pages immutable. It now applies a rule only where its `source` fits, and with one more argument it answers as Vercel does: the default `Cache-Control`, an `ETag`, a 304, gzip.
- **What it covers.** Before merging, a build served locally. After, the live site: the same script prints each page's `Cache-Control`, and that of a missing file under `/assets/`.
- **Where.** The scripts are session scratch, like the others (the entry "Checking the real page in headless Chrome" below).

### A crash is forced in the real page from outside the app (2026-11-26, crash screen)

- **How.** In headless Chrome, with the fake microphone and the tuner listening, a script replaces `AnalyserNode.prototype.getFloatTimeDomainData` with a function that throws. The next reading throws inside the readings Subscription, and the runtime crashes within a twentieth of a second. No bug is shipped to make it possible.
- **What it checks.** The screen and its words, the title, the alert, that nothing of the error is on the page, the three links and that each one loads its page (the reload by keyboard and by click), a working tuner after the reload, no Content Security Policy violation and no console error but the crash itself, and the fit at 375 px. Since 0.7.2 also that the microphone's track has ended.
- **What it cannot check on `localhost`.** The report to Sentry: only the live hosts report. Run against the live site it does send one, titled by the script's own error text. Resolve it afterwards.
- **Only from the tuner's page.** The other pages have no Subscription running to throw in. The screen and its links do not depend on the page.
- **Where.** The script was session scratch (`crash.ts` in the smoke folder), like the others (see "Checking the real page in headless Chrome, with and without a microphone").

### A crash view drops into a Scene, and a runtime can be started in a test (2026-11-26, crash screen)

- **The Scene.** A crash view is `(context, h) => Document`, the shape of an app's view. `scene({ update, view })` takes it with the crash context as the Model and `never` as the Message: `given(context)`, then the usual locators. The `update` it asks for can never be called. A scene can look and cannot click, which fits a screen that sends no Message.
- **The title** is read from what the view returns, called with `inertHtml` from `foldkit/html`: the builder for code with none in scope, and an `HtmlBuilder<never>` like the one a crash view is passed.
- **The runtime.** What a click does after a crash is the runtime's doing, so `src/crash.runtime.test.ts` starts one, the first test here to do so: `Effect.runFork(application.start())`, a small app with routing whose `update` throws, and `Fiber.interrupt` afterwards. Foldkit tests its own crash screen this way. Eight tests take about a tenth of a second.
- **The container needs an id.** Without one the runtime dies at start with "Runtime container must have an `id` for Model preservation across reloads", and the page stays empty with nothing in the test's output. `fiber.addObserver` showed it.
- **Reading whether a click was cancelled.** A listener on `window` runs after the runtime's on `document`, reads `event.defaultPrevented`, and then cancels the click itself so that happy-dom does not try to load the address.
- **What it pins.** One report, made before the screen is drawn. The screen in place of the app, and not the default one. A plain link cancelled before the crash and still cancelled after it. Each link of the crash screen left to the browser. Removing the `target` from the reload link fails three tests.
- **Where.** `src/crash.scene.test.ts`, `src/crash.runtime.test.ts`.

### A Scene selector can read an element's key (2026-11-26, tunings)

- **What happens.** A key is a field of the virtual node, not an attribute, so it is not in the page a browser shows and `toHaveAttr` cannot see it. Scene's selectors can: an attribute test on the name `key` is matched against the node's key (`matchesAttribute` in `repos/foldkit/packages/foldkit/src/test/query.ts`). So `selector('[aria-label="Strings"] [key="banjo-4"]')` finds the fifth chip of the banjo.
- **Why it matters.** It lets a test show that the view passes on the key a function made for it, without exporting the view's parts.
- **Where.** "each chip is keyed by its tuning and its place in it" in `src/scene.test.ts`.

### An example of a value that is not on the list will one day be on it (2026-11-26, tunings)

- **Symptom.** The preferences test for "an unknown tuning" used `banjo` as its unknown id. Adding the banjo would have failed that test for a reason that had nothing to do with what it checks.
- **Fix.** It uses `sitar` now. Better still is a value that can never be added, where there is one.
- **The other direction.** The how-to page names the tunings in words, and nothing tied the words to the list. A Scene test now takes the instrument out of every label ("Mandolin - Standard" gives "Mandolin") and looks for it on the page, so a tuning for a new instrument fails until the tip names it. It cannot tell whether a second tuning for an instrument already named is mentioned.
- **Where.** "damaged preferences" in `src/preferences.test.ts`; "the how-to page names the" in `src/scene.test.ts`.

### A test cannot leave a timer pending, so it resolves it with a number no attempt has (2026-11-26, tuner)

- **Symptom.** Once a press returned the timer Command, every Story and Scene test that pressed On / Off and then let the microphone answer failed: "I found unresolved Commands". Neither kind of test sends a Message while a Command is pending, unless the Command is defined as interruptible.
- **Why that is awkward here.** In the app the microphone usually answers first and the timer reports afterwards. Resolving the timer first, with its real Message, marks the start slow, which is the other case.
- **Fix.** The timer's Message carries the number of its attempt, and `update` ignores a number that is not the current attempt's. A test resolves the Command with a number no attempt has (`timerSetAside`), which takes it off the pending list and changes nothing. A Story test then sends the real report by hand, with `message(...)`, at the point in the order it wants. Foldkit's own tests for its hover intent component do the same (`resolveStaleOpen` in `repos/foldkit/packages/ui/src/hoverIntent/story.test.ts`).
- **Where.** `timerSetAside` in `src/story.test.ts` and `src/scene.test.ts`.

### Files that are not code can still be held to the code (2026-11-25, going public)

- **What happens.** `sitemap.xml`, `robots.txt` and `vercel.json` are not TypeScript, so nothing checks them when a page is added or an address changes.
- **What to do.** Vite imports a file as text with `?raw` and a JSON file as data, and Vitest does the same. `src/site.test.ts` reads all three: the sitemap must list exactly `pagePaths`, `robots.txt` must name the sitemap, and the policy's `connect-src` must be the origin of the Sentry DSN.
- **Where.** `src/site.test.ts`.

### The server entry is tested by rendering with a build id of its own (2026-11-25, prerender)

- **What happens.** `Server.renderToString` refuses to render a page that a browser could take over unless it knows the build id, which the Vite plugin compiles in during a real build. A Vitest run has none, so `renderPage` itself fails there with `MissingBuildId`.
- **What to do.** Pass one: the render options take a `buildId`. `renderApplication` in `src/entry.server.ts` exists so that a test can. The tests render each prerendered path, wrap it with `renderDocument`, and check the title, the text, the head tags and that no path comes out as "Page not found".
- **What I got wrong first.** The first version of this entry said the function could not be tested, and pinned only the list of paths and a constant. The review found the option.
- **What is still by hand.** That the files are written and served. `bun run preview` serves `dist/client`, but Vite's preview answers `/how-to` with the tuner's file (open `/how-to/`), and the browser rebuilds a page that does not match without a word, so a click-through looks right even if `how-to/index.html` were missing. Look at the files, or fetch `/how-to` from a Vercel preview.
- **Where.** `src/entry.server.test.ts`.

### A Scene test cannot follow a link (2026-11-25, routing)

- **What happens.** A click on a link becomes `ClickedLink` only because the runtime listens on the real document. A scene has no runtime and no address bar, so clicking a link in one proves nothing about navigation.
- **What to do.** Split the proof in three. A Scene test checks that each page shows what it should and that its link has the right `href`. A Story test checks `update`: `ClickedLink` returns the navigation Command, and `ChangedUrl` sets the route. The click through itself, with back and forward, was a check by hand in headless Chrome until 2026-11-26. It is now a test that starts a runtime (the entry "The real app runs in happy-dom" above). `src/entry.ts` and its `routing` option are still outside the suite: the test wires the app itself.
- **Also.** A scene has no assertion for the document's title, so the title is a pure function, `pageTitle`, with a test of its own.
- **Where.** "pages" in `src/scene.test.ts`, "routing" in `src/story.test.ts`, `src/view.test.ts`, `src/app.runtime.test.ts`.

### A test can pass because the thing it guards never runs in a test (2026-11-24, Sentry)

- **Symptom.** "Initialising sends nothing" passed with the per-visit session integration still installed.
- **Cause.** The SDK sends a session only when a `release` is set. The build sets one on Vercel; a test does not.
- **Fix.** The test sets a release. It was then checked the hard way: put the integration back and watch the test fail.
- **The habit.** For any test written after the code, break the code once and see the test fail. This was done for the A4 field tests and the microphone clean-up tests too.
- **Where.** `src/sentry.test.ts`, "initialising sends nothing, even with a release set".

### Testing Sentry without the network (2026-11-24, Sentry)

- **How.** `initSentry` takes overrides. A test passes `enabled: true` (tests run on `localhost`, where reporting is off), a `transport` that records envelopes, and a `beforeSend` that records events. `Sentry.close()` runs after each test.
- **Why two recorders.** The lint allows no type assertions, and an envelope's payload is untyped. `beforeSend` receives a typed event, so assertions read from there; the transport answers "was anything sent at all". One group does read inside an envelope, for what the SDK adds after `beforeSend` (the entry on the "no IP address" mark above).
- **Where.** `startRecording` in `src/sentry.test.ts`, the only test file allowed to import `@sentry/browser`.

### There are no Node types, so a test cannot listen for unhandled rejections (2026-11-24, Sentry)

- **What happens.** `process.on('unhandledRejection', …)` fails typecheck: the project has no Node types.
- **What we rely on.** Vitest fails the run on any unhandled rejection. A throwaway test confirmed it. "Completes when Sentry cannot be reached" depends on this and has no assertion of its own for it.

### `Command.resolveAll` passes when a listed Command was never returned (2026-11-24, tuner)

- **What happens.** `resolveAll` resolves the Commands that are pending and ignores the pairs that match nothing. Three Story tests list Listbox and Popover Commands (`FocusButton`, `UnlockScroll`, `RestoreInert`) that `update` does not return on that path, so those lines assert nothing. `resolveAllExact` fails on an unused pair.
- **What to do.** Prefer `resolveAllExact`, or `Command.expectExact` first. The three tests were tightened on 2026-11-26: each now lists only what is returned, and making the Popover or the Listbox modal, which adds the two Commands, fails them.
- **Where.** The "tuning" tests and "closing the A4 menu" in `src/story.test.ts`.

### Story has no managed-resource steps; Scene does (2026-11-24, tuner)

- **What to do.** In a Story test, "the microphone is required exactly while starting or listening" is tested by calling `managedResources.microphone.modelToMaybeRequirements` directly. A Scene test can use `ManagedResource.acquire`, `failAcquire` and `release`.
- **Where.** `src/story.test.ts`, `src/scene.test.ts`.

### Scene's `Mount.resolve` takes the child component's own Message (2026-11-24, tuner)

- **Symptom.** A type and schema error when resolving a Popover's mount with `Message.GotA4PopoverMessage({ … })`.
- **Fix.** Pass the component's Message, unwrapped: `Popover.Message.CompletedAnchorPopover()`.

### Scope a locator to the part of the page it is about (2026-11-24, tuner)

- **Symptom.** A test counted ten strings where there are six, and an "absent" check matched text that was present.
- **Cause.** The how-to text is also a list, and it contains "442 Hz".
- **Fix.** `all.selector('[aria-label="Strings"] li')`, and `/Hz ·/` in place of `/Hz/`.

### Checking the real page in headless Chrome, with and without a microphone (2026-11-24, tuner and Sentry)

- **A working microphone.** Chrome plays a WAV file as the microphone: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file.wav>`. A synthesised 110 Hz tone reads as A2, 110.00 Hz.
- **No microphone.** Leave out the last two flags. The VM has no audio device, so the page gets `NotFoundError`, which is the one failure that can be produced on demand to send a real report to Sentry.
- **What it is run with.** `/usr/bin/google-chrome` and the `playwright-core` already installed in `~/projects/stem-shovel`. The scripts were session scratch and are not in the repository.
- **What it covers that the suite does not.** Stacking order and where an open list lands, a real microphone, the takeover of a prerendered page, and everything about what Sentry receives from a built site. Until 2026-11-26 it was also the only click-through of the picker, the menu and the pages. Those are in the suite now.

## Sentry

### What the SDK's size switches save, and where they work (2026-11-26, Sentry)

- **Measured,** with one build id so the numbers compare, raw and as gzip. As it is: 512.12 kB and 165.76 kB. Debug statements out (`__SENTRY_DEBUG__: false`): 506.82 kB and 163.89 kB, a saving of 5.30 kB, 1.0%. Tracing out (`__SENTRY_TRACING__: false`): 0.15 kB. Both: 5.45 kB, or 1.91 kB as gzip. The four replay switches: nothing, because no replay code is in the script.
- **Decision.** Nothing was changed. One percent is not a saving a visitor can notice, and the tests cannot show that reports stay the same: Vitest does not read `vite.config.ts`.
- **The plugin's option reaches the live build only.** `bundleSizeOptimizations` belongs to the Sentry Vite plugin, and with `disable: true` the whole plugin is swapped for an empty one. This project disables it everywhere but on Vercel. So the option would trim the live script and no other: not a local build, and not the one a browser check runs against. All the option does is replace a flag in the SDK's code, and Vite's `define` does that in every build. The numbers above were made with `define`.
- **What the debug switch removes.** Read through the SDK: its debug logging, and one check of the DSN's shape. Nothing that a report contains. With it, `debug: true` would print nothing.
- **An explicit list of integrations saves 27 bytes.** `Sentry.init` names every default integration itself (`getDefaultIntegrations`), so the bundler keeps them all whatever list it is given. Keeping `BrowserSession` out of the script would mean not calling `Sentry.init` and assembling the client by hand, to save its 485 bytes. One default, `conversationIdIntegration`, is not exported by `@sentry/browser`, so a list written by hand could not name the same set.
- **`@sentry/browser` already resolves to its production build** (`build/npm/esm/prod`), which has no debug statements. The 5.30 kB is in `@sentry/core` and `@sentry/browser-utils`.

### Sentry answers 200 to a report it then drops (2026-11-25, Sentry)

- **What was seen.** With Allowed Domains set, four reports sent by hand with an `Origin` that is not on the list each got `200` and an event id back. None of them ever appeared in Sentry. A fifth, identical but for an allowed `Origin`, appeared within two minutes.
- **What it means.** Neither the browser nor a script can tell that a report was dropped. A report that arrives from the real site does not prove a filter is on, and a `200` does not prove a report was kept. Only what turns up in Sentry does.
- **How to prove a filter.** Send the same report twice: once claiming an allowed origin, as the control, and once claiming one that should be refused. A minimal envelope posted with `curl` to the DSN's `/api/<project id>/envelope/` address with an `Origin` header is enough. Wait two minutes, then look for both by title. Resolve the issue the control creates.
- **What did not help.** The connector's dropped-events query returned nothing for the project, neither kept nor dropped, minutes after both kinds had been sent. Sentry's own Stats page was not checked.

### Previews report nothing (2026-11-25, Sentry)

- **Why.** Kevin set the Sentry project's Allowed Domains to our own hosts on 2026-11-25. No entry can match our preview addresses without matching every project on Vercel (see the Allowed Domains entry below), so Sentry drops what a preview sends. The app sending reports that go nowhere would be a lie in the code, so previews came off `reportsFrom`, and the `preview` environment tag went with them: nothing could carry it any more.
- **What it costs.** A fault that only shows in a preview build is not reported. Previews are behind Vercel's sign-in, so only we see them, and the dev server still reports.
- **To bring them back.** Both lists have to change: `*.vercel.app` in Allowed Domains, which lets any Vercel project that copies our DSN report, and the preview pattern in `reportsFrom`.
- **Where.** `reportsFrom` and `environmentOf` in `src/sentry.ts`, and their tables in `src/sentry.test.ts`.

### A new domain reports nothing until it is listed (2026-11-24, Sentry)

- **Symptom.** `www.oktuner.com` was connected to production. The same failure that sent a report from `ok-tuner.vercel.app` sent nothing from the new domain, and nothing said so.
- **Cause.** The host list in `src/sentry.ts`: an unknown host means the SDK is disabled. It would also have been tagged `development`.
- **Fix.** `www.oktuner.com` and `oktuner.com` added to `PRODUCTION_HOSTNAMES`.
- **For the next domain.** Add it there. If the Sentry project's Allowed Domains is set, add it there too: that is a second list with the same silent failure. Then send a test report from the new address.
- **Where.** `src/sentry.ts`; `reportsFrom` in `src/sentry.test.ts`.

### Sentry's Allowed Domains: what it checks and what it cannot match (2026-11-24, Sentry)

- **Where it is.** Project Settings, General Settings, "Client Security". One entry per line; the default is `*`.
- **What it checks.** The `Origin` header of each incoming report, or `Referer` when there is no `Origin`. A request with neither is always accepted, so it stops a copy of the app running in a browser on another host, and does not stop a script. A rejected report shows in Sentry's Stats as "Disallowed Domain".
- **What an entry can be.** A hostname (`www.oktuner.com`, any scheme and port), a full origin (`https://www.oktuner.com`), `*.oktuner.com` (the domain and every subdomain), or `*:port`. A `*` is honoured only as the whole host or as a leading `*.`; there is no pattern for the middle of a name.
- **What follows.** Our preview addresses (`ok-tuner-<something>-lightning-jar.vercel.app`) cannot be listed narrowly. The only entry that matches them is `*.vercel.app`, which matches every project on Vercel. So with Allowed Domains set to our own hosts, previews stop reporting.
- **Source.** Sentry's documentation ("Inbound Filters", "Allowed Domains") and the matcher itself, `relay-filter/src/origin.rs` in `getsentry/relay`, read on this date.
- **Tested on 2026-11-25,** after Kevin set it. Reports from `www.oktuner.com` and from the dev server arrived. Reports claiming `not-ours.example.org`, `www.oktuner.com.example.org`, `staging.oktuner.com` and a preview-shaped `…-lightning-jar.vercel.app` address were dropped, so neither a look-alike domain nor an unlisted subdomain gets through. The two `vercel.app` production addresses and the bare domain were not tested. The list itself is in Sentry, not in this repository: `reportsFrom` in `src/sentry.ts` is meant to match it.

### Sentry attaches a location even when it stores no IP address (2026-11-24, Sentry)

- **What was seen.** Every report has `ipAddress: null` and still carries a country, and sometimes a city: "US, New York" on the first reports, "US" with no city on a later one, "US, New York" again on one sent after "Prevent Storing of IP Addresses" was switched on for the project.
- **What it means.** Sentry looks the location up from the address the report arrives from, then keeps the location and not the address. Neither the SDK's switches nor the project setting stops it.
- **Why it matters.** It bears on what the page may claim. "Ad-free, ad-tracker-free" holds; a plain "tracker-free" or "we know nothing about you" would claim too much. It is one of the two reasons the title was left alone ("The title does not say 'ad-free' or 'tracker-free'").

### The SDK's privacy switches changed name, and they default to on (2026-11-24, Sentry)

- **What happens.** In `@sentry/browser` 11 the `dataCollection` option replaces `sendDefaultPii`. Its categories default to on, and one of them infers the IP address.
- **What to do.** Switch off the five that carry a visitor's data in a browser, as `sentryOptions` does: user information (which includes the address), cookies, headers, request bodies and query strings. With `userInfo: false` the SDK tells Sentry not to infer the address.
- **Not literally every category.** The option has more (`graphQL`, `genAI`, `mcp`, `databaseQueryData`, `queues`, `stackFrameVariables`, `frameContextLines`), left at their defaults, which are on. Each gates an integration this app does not install, by the SDK's own description; that was read, not tested one by one. The design and one test name say "every category", which overstates it. Switching the rest off as well is in the backlog.
- **Where.** `sentryOptions` in `src/sentry.ts`. Stem Shovel does the same in its `src/hooks.client.ts`.

### A default integration tells Sentry about every visit (2026-11-24, Sentry)

- **What happens.** `BrowserSession` is on by default and sends an envelope on each page load, crash or not. It only sends once a `release` is set, so it is invisible in development and appears on the first Vercel build.
- **What to do.** It is filtered out of the default integrations. The cost: Sentry shows no crash-free-session figures.
- **Check.** A visit to the live site with a working microphone sends no request to Sentry at all.

### Source maps resolved one line off (2026-11-24, Sentry)

- **Symptom.** The first production report had readable stack frames that named the wrong lines and, through them, the wrong files.
- **How it was found.** A local build pushed through the same upload path was byte for byte what production served, and its map on disk resolved all nine frames correctly. Sentry's answers matched a lookup one line up. So the uploaded copy differed from the served one.
- **Cause.** [sentry-javascript #26658](https://github.com/getsentry/sentry-javascript/issues/26658). On Vite 8 the minifier rewrites the snippet that carries the bundle's debug ID. The upload tool bundled with the plugin (`sentry` 0.49.0) no longer recognises it and adds its own line to the uploaded copy.
- **Fix.** `@sentry/vite-plugin` 11.16.0, which bundles `sentry` 0.50.0. `sentry sourcemap inject --dry-run` on a built file shows the difference: the old tool modifies the file, the new one skips it.
- **Guard.** There is no automated test, and there cannot be one in the suite: the frames are resolved by Sentry, from maps that only a Vercel build uploads. After changing the plugin's version, send a test report from production and check that its frames name files under `src/` with the right lines.

### A reported message is titled by the function that sent it (2026-11-24, Sentry)

- **Symptom.** With `attachStacktrace` on, a `captureMessage` report appeared in Sentry titled "reportMicrophoneProblem".
- **Fix.** Send an `Error` whose `name` is `Microphone failed: <browser error name>` and whose text is the browser's message, with a fingerprint and a tag on the error name. The issue is titled "Microphone failed: NotFoundError: Requested device not found".
- **What it costs.** In Sentry it looks like a thrown error, though it was caught and handled.
- **Where.** `reportMicrophoneProblem` in `src/sentry.ts`.

### Crash reports flattened the Model (2026-11-24, Sentry)

- **Symptom.** The Model attached to a crash report showed "[Object]" where the current reading should be.
- **Cause.** The SDK keeps three levels of nested data by default. A `Listening` Model is deeper.
- **Fix.** `normalizeDepth: 10`, with a test that sends a real `Listening` Model.

### What the Sentry connector can and cannot do (2026-11-24, Sentry)

- **Can.** Create the project, read issues and events (including the resolved stack frames and the location), comment on and resolve issues, read the documentation.
- **Cannot.** Change a project's security settings ("Prevent Storing of IP Addresses", Allowed Domains) or delete uploaded source-map bundles. Those are done by hand in Sentry.
- **Why the build has its own token.** The build uses an Organization Token, which is scoped to uploading source maps and creating releases. Managing the project goes through the connector, so no personal token is stored anywhere.

### A simulated Vercel build really uploads (2026-11-24, Sentry)

- **What happens.** A local build with `VERCEL=1` and the token present uploads its source maps as a release. Three such bundles are in Sentry from proving and debugging the upload. They do no harm and can be deleted by hand.
- **Test issues.** A test report reopens the issue it belongs to as a regression. Resolve it afterwards, with a comment saying it was a test. `OK-TUNER-1` is the test issue for a missing microphone.

### What Sentry added to the bundle (2026-11-24, Sentry)

- **Measured.** 398 kB before, 491 kB after (159 kB compressed). Whether the plugin's `bundleSizeOptimizations` trims it was tried on 2026-11-26: by 1%. See "What the SDK's size switches save, and where they work" above.

## Varlock and the build

### Varlock resolves the environment the moment its plugin is imported (2026-11-24, Varlock)

- **What happens.** Importing `@varlock/vite-integration` reads `.env.schema`, fetches the values from 1Password and puts them in `process.env`. An ordinary import at the top of `vite.config.ts` would do that for everyone, including someone with no 1Password access.
- **What to do.** The plugin is imported with a top-level `await import(…)` only when `SKIP_VARLOCK` is not set. The Sentry plugin then reads the token from `process.env`, so the Varlock plugin must come first.
- **Never** set `SKIP_VARLOCK` on Vercel: the build would pass and upload nothing.
- **Where.** `vite.config.ts`.

### A Vercel build without the token fails, on purpose (2026-11-24, Varlock)

- **Why.** The alternative is a green build that ships stack traces nobody can read. `SENTRY_AUTH_TOKEN` is `@required=forEnv(preview, production)`, and `APP_ENV` falls back from Vercel's `VERCEL_ENV`.
- **Proved by.** Renaming the item in the schema and watching a production-mode build stop.
- **Upload rule.** Source maps are made and uploaded only when `VERCEL` is set and the token is present. They are "hidden" (no pointer in the bundle) and deleted from the output after upload. Since 2026-11-25 only the browser bundle has them: the Node bundle that draws the pages gets none. A local build makes no maps.

### An undeclared variable is treated as a secret (2026-11-24, Varlock)

- **What happens.** Varlock scans what is served for secrets. Vercel's own build variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`) would count as sensitive unless declared.
- **What to do.** They are declared in `.env.schema` as optional and not sensitive. `VERCEL_OIDC_TOKEN` is declared and left sensitive.
- **Also.** In development the Varlock plugin lists the names of the environment's keys in the served page. Names only, development only.

### `vercel link` rewrites `.gitignore` and writes a token to disk (2026-11-24, Vercel)

- **What happens.** `vercel link` created `.env.local` holding a `VERCEL_OIDC_TOKEN` and added `.env*` to `.gitignore`. That pattern would have hidden `.env.schema`, which must be committed.
- **Fix.** The file was removed and the change reverted; only `.vercel/` was added. `.gitignore` ignores `.env.*` and then un-ignores `!.env.schema`.

### A fork's pull request builds with our 1Password token in reach (2026-11-24, Varlock)

- **What happens.** A preview build runs the pull request's own `vite.config.ts` with `OP_TOKEN` in its environment. On a public repository that is a stranger's code.
- **What stops it.** Vercel's Git Fork Protection, which holds a fork's pull request until a team member authorises the build. It was on when checked. Do not switch it off, and read a fork's `vite.config.ts` before authorising it.

### `vite.config.ts` is not type-checked or linted (2026-11-24, tooling)

- **What happens.** `tsc` and the lint cover `src` only. A mistake in the build configuration shows as a failed or wrong build. In the backlog.

## The page and its assets

### Three things rename the script on a deploy that did not change it (2026-11-26, build)

- **Symptom.** The script has a new name after every deploy, a docs-only one included, so a returning visitor downloads all of it again (about 171 kB) even though a browser now keeps a hashed file for a year.
- **Cause 1: Foldkit's build id.** `foldkit()` makes a random id for each build and compiles it into the script and onto each page's root element. `Runtime.hydrate` compares the two and stops if they differ, so a script never takes over a page drawn by another build. The plugin accepts an id from the app: the `buildId` option of `foldkit()`, or the `FOLDKIT_BUILD_ID` environment variable (`repos/foldkit/packages/vite-plugin-foldkit/src/buildToken.ts`). With a fixed id, two builds gave the same script and the same pages, byte for byte.
- **Cause 2: Sentry's release.** On a Vercel build the Sentry plugin writes `SENTRY_RELEASE={id:"<the commit>"}` at the top of the script. Read in the live script. The commit is new on every deploy, so the script is too, whatever the build id does. The plugin's documentation for `release.inject` describes exactly this.
- **Cause 3: the stylesheet.** Vite gives the script a new name when the stylesheet changes, although the script's bytes stay the same: three builds gave one script, by its SHA-256, under three names. And the stylesheet changed whenever a document gained a word that Tailwind takes for a class.
- **What was done.** Cause 3, in part: Tailwind now scans `src` only (the entry on Tailwind below).
- **What was not, and why.** A stable build id by itself changes nothing on Vercel, because of cause 2. Removing both means an id made from the files the script is built from, and the release taken out of the script: `release.inject: false` for the plugin, the commit written into each page by `src/entry.server.ts`, and `initSentry` reading it from the page. That moves how a report gets its release, with the proof only on the live site, for a small gain: of the 19 commits on `main` so far, one left the script's inputs alone and one more touched only tests. A change and its documents go in one pull request here, and every release changes the version, which is in the script. In the backlog.
- **Would a stable id be safe?** For hydration, yes. A page names its script by a hash of the script's contents, so a page can only ever load the script it was built with, whatever the two ids say. The id guards the case where that pairing can go wrong: a script with a fixed name, or pages drawn by a server at request time.
- **Where.** `foldkit()` and `sentryVitePlugin()` in `vite.config.ts`; `src/styles.css`. The design is `docs/superpowers/specs/2026-11-26-script-size-and-caching-design.md`.

### Where the script's bytes are (2026-11-26, build)

- **Measured.** The script is 512 kB, 166 kB as gzip. By its source map, in bytes of the minified file: Effect 153.8 kB (30.5%), Foldkit 150.2 kB (29.8%), Sentry 90.6 kB (18.0%), Foldkit UI 47.3 kB (9.4%), the app itself 42.2 kB (8.4%), Floating UI, which Foldkit UI uses, 17.3 kB (3.4%), Vercel Analytics 1.9 kB.
- **What it means.** Three fifths of the script is the framework and Effect. Sentry is under a fifth, and most of that is its core (65.7 kB), which every report passes through. The switches that trim it save 1% (the Sentry section, "What the SDK's size switches save").
- **How.** A build with `build.sourcemap: true`, then each mapped span of the minified file counted against the package its source is in. A throwaway script, not in the repository.

### An SVG that a browser draws inline can still fail as an image (2026-11-24, favicon)

- **Symptom.** The icon file as supplied did not load as an image at all (width 0 in Chrome), so it could not have worked as a favicon.
- **Cause.** Two attributes with no space between them: `xmlns="…"viewBox="…"`. Inline in a page, the HTML parser forgives that. As a file, an SVG is read as XML, which does not.
- **Fix.** One space added in `public/favicon.svg`; nothing else was changed. Check any supplied SVG by loading it in an `<img>` before using it as a file.
- **The set.** `public/favicon.svg` for browsers that take SVG, `favicon-48.png` for those that do not, and `apple-touch-icon.png` (180 px, on a solid square, since a phone's home screen fills transparent corners with black). The two PNGs were rendered from the SVG in headless Chrome; render them again if the SVG changes. Vite serves `public/` at the site root and copies it into `dist/`.
- **Also.** With no icon declared, every page load asked for `/favicon.ico` and logged a 404. The declared icons end that.

### Tailwind reads comments and documents as if they were markup (2026-11-24, build)

- **What happens.** Left to itself, Tailwind 4 scans every file in the project as plain text for class names, comments and Markdown included. An ordinary word that is also a utility name becomes a rule in the built stylesheet.
- **Seen.** The teaching comments added `.contents{display:contents}` (27 bytes) from the word "contents" in a test file's comment. The stylesheet already carried unused rules from prose: `.hidden`, `.static`, `.container`, `.table`, `.filter`, `.visible`, `.invisible`, `.inline`, `.ring`, `.transition`.
- **What it costs.** A few unused rules. No class the page uses is affected. And a new name for the stylesheet whenever such a word is written, which renames the script as well ("Three things rename the script" above).
- **Fix, for the documents (2026-11-26).** `@import 'tailwindcss' source('.')` in `src/styles.css` limits the scan to the stylesheet's own folder, `src`. Writing a document no longer changes the stylesheet. The built file lost one rule, `.transition`, and three theme variables that nothing else used, and went from 27.61 kB to 27.00 kB. Screenshots of every page at two widths were the same, byte for byte, before and after.
- **Still true for comments in `src`.** The other ten rules above are still built: each word is in a comment or a test under `src`. In the backlog.

### Comments in a hand-written HTML file are served (2026-11-24, build)

- **What happens.** Vite does not strip HTML comments. While the project had an `index.html`, its teaching comments took the built file from 0.7 kB to 3.4 kB and were readable in the page source. Since 2026-11-25 every page is written by the build and carries no comments. Comments in TypeScript and CSS are removed by the build.

### The lint and TypeScript configuration files carry comments (2026-11-24, tooling)

- **What happens.** `.oxlintrc.json`, `.oxlintrc.effect.json` and `tsconfig.json` have `//` comments. oxlint 1.85.0, `tsc` 7 and oxfmt all accept them, and the lint rules were probed afterwards and still fire. A tool that reads these files as strict JSON would not; an editor without the oxc extension may underline them.

## Vercel and domains

### Hashed files are kept for a year, and a page is checked on every visit (2026-11-26, caching)

- **What was seen.** Every file was served `Cache-Control: public, max-age=0, must-revalidate`, the script and the stylesheet included. That is Vercel's default for a static file. On a repeat visit Chrome asked for the page, the stylesheet, the script and the icon again, and was answered `304 Not Modified` four times. Nothing was downloaded twice (297 bytes in all), but the script could not start until its question was answered.
- **Fix.** A header rule in `vercel.json` for `/assets/(.*)`: `public, max-age=31536000, immutable`. Vite writes the script and the stylesheet into `assets/` with a hash of their contents in the name, so a name never comes to mean other bytes, and a browser may use its copy without asking.
- **How the rules combine.** Every rule whose pattern and conditions fit a request is applied, not only the first, and a rule's `Cache-Control` takes the place of Vercel's default. A page fits only the two older rules, so it keeps the default and is checked with the server on every visit. It has to be: the page is what names the current script. Read in Vercel's documentation for `vercel.json`, whose own example is this rule.
- **Measured, before.** On the live site a first visit made 5 requests and transferred 184,428 bytes, 170,769 of them the script. A repeat visit made 4 requests, each answered 304.
- **Measured, after.** Against a build served locally the way Vercel answers: a repeat visit makes 2 requests, for the page and the icon, and none for the script or the stylesheet.
- **A rule reaches a 404 too.** The live site's answer for a file that does not exist carries the Content Security Policy, which comes from a rule. So a missing file under `/assets/` is very probably marked cacheable for a year as well. A browser asks for a missing file only when it holds a page from an older deploy and not that page's script, and a cached 404 does harm only if that name comes back, as it would after a rollback to that deploy. In the backlog, to be checked on the live site.
- **Vercel compresses as it serves, and not hard.** Chrome was sent the script as Brotli, 170,769 bytes. gzip at its usual setting makes it 164,778, and Brotli at its highest 143,015. Vite's "gzip" figure in the build output is therefore a little under what a visitor downloads.
- **Not checked before merging:** what Vercel itself sends. A preview is behind Vercel's sign-in, so the first proof is the browser check against the live site after the merge (the Testing section, "A browser's cache is watched from Chrome's own network events").
- **Where.** `headers` in `vercel.json`; "only the files under /assets/ are cached for a year" in `src/site.test.ts`. The rule to follow is in `AGENTS.md`, "Prerendering".

### An address ending in `index.html` is redirected (2026-11-25, Vercel)

- **Symptom.** Each page is a folder holding an `index.html`, and Vercel also answered at that file's own address. The app has no route for such a path, so `/index.html` showed the tuner and then replaced it with "Page not found".
- **Fix.** Two permanent redirects in `vercel.json`: `/index.html` to `/`, and any `…/index.html` to its folder. A redirect is applied before any file is served.
- **Where.** `redirects` in `vercel.json`; `src/site.test.ts`.

### The Content Security Policy: what the app needed, and how it was tried (2026-11-25, going public)

- **The policy.** Scripts and stylesheets from the site only, requests to the site and to Sentry's address for this project, no plugins, no framing. Vercel's analytics script and its requests are on the site's own address, so they need no allowance.
- **The one allowance.** `style-src 'self'` alone broke the page: the needle's position and Foldkit's components are set with `style` attributes, which count as inline style. `style-src-attr 'unsafe-inline'` allows those attributes and still refuses an inline `<style>` block. Nothing needed `unsafe-eval`.
- **How it was tried.** The headers live in `vercel.json`, so neither the dev server nor Vite's preview sends them. A small static server that reads the headers from `vercel.json` served the built pages, and a browser script ran the tuner, opened the tuning list and the settings menu, and visited every page, listening for `securitypolicyviolation`. The stricter rule gave violations; the final one gave none.
- **Not tried before merging:** a report to Sentry under the policy, because only the live hosts report. Checked after.
- **Previews.** Vercel's own toolbar on a preview loads from another origin and is refused by the policy. Accepted.
- **Where.** `headers` in `vercel.json`; `src/site.test.ts`.

### Vercel's analytics script ignores automated browsers (2026-11-25, analytics)

- **Symptom.** After Web Analytics went live, a headless browser loaded the script and no page view was sent.
- **Cause.** The script checks `navigator.webdriver` and looks for "Headless" in the user agent, and sends nothing if either is set. Read in the script the site serves.
- **What it means.** Smoke tests and most bots do not inflate the counts. To see a page view in a test, the browser has to present as an ordinary one: an ordinary user agent, and Chrome started with `--disable-blink-features=AutomationControlled`. That does count as a visit.
- **What a page view's request holds:** the page's address, the referrer, and the versions of the script and the package. The location and the device are worked out by Vercel from the request itself.

### Vercel Web Analytics is two switches (2026-11-25, Vercel)

- **What it needs.** The package in the code, which adds the script tag, and Web Analytics enabled for the project in Vercel (the dashboard, or `vercel project web-analytics enable`). With only the first, the script's address answers 404 and nothing is counted.
- **What the package offers a plain app.** `inject()`. Vercel's documentation says it has "no route support", which means it cannot group addresses with parameters under one route. It does report changes of page inside the app. This app's addresses have no parameters.
- **Where.** `src/analytics.ts`.

### Vercel answers 403 to any address ending in `.map` (2026-11-25, Vercel)

- **What was seen.** On production and on a preview, the address of the script's source map answered 403 with an empty body. So did a made-up `.map` name under `/assets/`, while a made-up `.js` name answered 404.
- **What it means.** A 403 there says nothing about whether the file exists. The proof that no map is deployed is the build: the Sentry plugin deletes the browser bundle's maps after uploading them, and the Node bundle gets none. What blocks the request was not looked into.

### The 404 page is prerendered, then moved (2026-11-25, Vercel)

- **Why.** With the pages prerendered, an address with no file is a real 404, and Vercel sends `404.html` with it if the output has one. That page should look like the rest of the site and share its stylesheet.
- **The obstacle.** Foldkit's prerender writes every path as a folder holding an `index.html`. Asked for `/404.html` it writes a folder of that name, which Vercel does not use.
- **What was done.** The build draws the app's own not-found page at the path `/404`, which no route matches, and the build command then moves `404/index.html` to `404.html`. A build that wrote no such file fails at the move.
- **The page prints no path.** The one file is served for every unknown address. A page that printed the path would show "/404" until the script had run, and would not match the browser's own drawing. In headless Chrome, at an unknown address, all seven elements of the page were kept when the script took over.
- **First version.** For a few hours the page was a hand-written `public/404.html` with its styles inline, because a hand-written file cannot know the hashed name of the stylesheet. Kevin asked for it to share the site's styles, which is what prerendering it gives.
- **Before prerendering.** The app was client-rendered with routing for a day, and `vercel.json` rewrote every path that was not a file to `index.html`. An unknown address was answered 200: a "soft 404".
- **Checking it locally.** Vite's preview does not serve `404.html` for a missing file. A static server that does is a dozen lines of Bun.
- **Where.** `NOT_FOUND_PATH` in `src/entry.server.ts`; the `build` script in `package.json`; `src/page/notFound.ts`.

### `oktuner.com` redirects to `www.oktuner.com` (2026-11-24, Vercel)

- **What happens.** The bare domain answers with a 308 to `www`. The app never runs on the bare domain, but both are in the production host list in case the redirect is ever turned round.
- **Still `noindex`.** Both `vercel.json` (a header on every response) and the head of every page (a meta tag: `DOCUMENT_HEAD` in `src/entry.server.ts`) say so. Making the site crawlable means changing both. In the backlog.

### A new project's first deployment becomes production (2026-11-24, Vercel)

- **What happens.** Vercel promoted the first deployment of the new project to production. After that, `main` is production and pull requests get previews. Expect it when creating a project before its first merge.

### Previews are behind Vercel's sign-in (2026-11-24, Vercel)

- **What happens.** A preview address asks for a Vercel login. A headless check or a `curl` of a preview sees the login page unless it carries a bypass. Production and the dev server are the easy places to check a real page.

### `vercel git connect` cannot read the exe.dev remote (2026-11-24, Vercel)

- **Symptom.** Connecting the project to GitHub failed: the remote is the exe.dev proxy address, which Vercel does not recognise as GitHub.
- **Fix.** Name the repository: `vercel git connect https://github.com/kevinpeckham/ok-tuner-foldkit`.

## The dev server and the VM

### Restart the dev server after changing the build configuration (2026-11-24, dev server)

- **What happens.** The dev server is a long-running service and serves the working tree. It needs `.env.local`. A change to `vite.config.ts` or `.env.schema` can leave it serving an error page until it is restarted.
- **What to do.** `systemctl --user restart ok-tuner-dev`, then load the page.

### A new bench hostname may not resolve on the VM at first (2026-11-24, VM)

- **Symptom.** Just after its DNS record was created, `ok-tuner.bench.lj.dev` did not resolve on the VM, though it did everywhere else.
- **Cause.** The VM had looked the name up before the record existed and remembered the "no such name" answer.
- **What to do.** Use `http://localhost:5273/` or `curl --resolve` until it clears.

### Caddy leaves its certificate challenge records behind (2026-11-24, VM)

- **What happens.** Caddy's DigitalOcean plugin does not always remove the `_acme-challenge` TXT records it creates in the `bench.lj.dev` zone. Twenty-two were there when this project's name was added. Not caused by this project and not cleaned up.

## Tooling and process

### `bun run format` reformats the documents too (2026-11-24, tooling)

- **What happens.** oxfmt formats Markdown as well as code, including everything under `docs/`. A formatting run after writing a document changes it.
- **What to do.** Run it before committing a document, so the reformat is not a separate commit later. A script that edits a file by matching text can miss after a format run: match again.

### The newest fixed version may be younger than the seven-day wait (2026-11-24, dependencies)

- **What happened.** The workspace takes releases at least seven days old. `@sentry/vite-plugin` 11.16.0 was four days old and was the oldest version with the source-map fix. It was taken, and said so.
- **Dependencies are pinned exactly** where this project added them, so an upgrade is always a deliberate change.

### The final review found what the tests could not (2026-11-24, process)

- **What happened.** Each build ended with one fresh review of the whole branch. It found the blocked-storage crash in the tuner, and in the Sentry work both the flattened crash data and the fact that a public repository would report from anywhere. The production proof then found the source-map fault that no review had.
- **The habit.** Keep both: a fresh review before merging, and a real report from the real site after.
