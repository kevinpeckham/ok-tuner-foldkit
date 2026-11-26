# Microphone polish: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). Two items from the backlog's "Microphone and listening" section, small enough for a short design.

## Intent

While the browser's permission prompt is open, the On / Off button says "Starting…" and nothing else. A visitor who has not noticed the prompt sees a tuner that seems stuck. Say what the tuner is waiting for. And while the button is disabled, stop it looking pressable.

## Goals

- A start that takes longer than about 1.2 seconds shows one line near the button: the tuner is waiting for the microphone, and if the browser is asking for permission, allow it.
- A screen reader announces that line, politely.
- A start that is granted quickly never shows it, not even for a moment.
- The line goes when the tuner stops starting, whichever way: listening, failed, or the visitor left the page.
- A disabled On / Off button has the ordinary cursor and no hover colour, while starting as well as while booting.

## Not goals

- **No cancel button** (given). The browser's own prompt has one, and so has leaving the page.
- No telling the permission prompt apart from a slow audio start. The line covers both, which is why it says "if".
- The other items in that backlog section: starting on pointer entry, pitch detection off the main thread, the development-only suspended audio context.

## Approaches

### Knowing that the tuner is waiting

1. **Time (chosen, given).** If the tuner is still `Starting` 1.2 seconds after the press, show the line. It works in every browser, and it also covers a start that is slow for another reason.
2. **The Permissions API,** `navigator.permissions.query({ name: 'microphone' })`, which can say that the permission's state is `prompt`. Rejected (given). The reason given was that Firefox does not support that name, so the line would be missing exactly where the prompt cannot be detected. Checked during the build, that is now only true of older versions: MDN's compatibility data lists the microphone query in Firefox from version 132 (October 2024), Chrome from 64 and Safari from 16. The decision stands on what is left: a browser older than those would get no line, the query is a second asynchronous answer to fit in beside the microphone's own, and a start that is slow with no prompt open would still say nothing. A later change could use the API to show the line at once when the state is `prompt`, and keep the clock as the fallback.

### Where the timer lives

1. **A Command (chosen, given).** `update` returns it when the tuner enters `Starting`. It waits, then reports with a Message, and `update` marks the `Starting` state as slow. This is the shape Foldkit's own code uses for a delay (`WaitBeforeHidingCopiedIndicator` on its website, `WaitBeforeOpening` in `@foldkit/ui`'s hover intent).
2. **A subscription that depends on "is starting".** The runtime stops a subscription's stream when its dependencies change, so the timer would end with the start. Not chosen: Foldkit's own rule for picking between the two is what causes the work (`repos/foldkit/AGENTS.md`, "Choosing Lifecycle Primitives"). A subscription is for an outside source of events that a condition in the Model switches on. This wait is caused by one Message, the press, and happens once, which is a Command.

### An old timer and a new start

A Command runs to its end once returned (unless it is defined as interruptible, below), so a timer can report after its start is over. If the tuner is no longer starting, the report changes nothing. The case that matters is a second start soon after a first: on, off and on again within 1.2 seconds, or a fast failure and another press. The first timer would then arrive during the second start and show the line early, perhaps for a twentieth of a second before the microphone opens. That breaks "a quick start never shows it".

1. **Number the attempts (chosen).** The Model counts starts. `Starting` carries the number of its attempt, the Command and its Message carry the same number, and `update` acts on a report only if the tuner is starting with that number. An old timer is then ignored whatever state it arrives in. This is what `@foldkit/ui`'s hover intent does with its `pendingOpenVersion`. It costs one number field on the Model.
2. **Accept it.** Simplest, and wrong in the case above.
3. **An interruptible Command, interrupted wherever the tuner leaves `Starting`.** Three places to remember (opened, failed, left the page), an extra Message for the outcome of each interruption, and nothing checks that a fourth exit is not added without one.

## Design

- **Model.** `startCount`, a number: how many times the tuner has been started in this visit. `TunerState.Starting` gains two fields: `attempt` (the `startCount` it was given) and `isSlow` (false at first). The "slow" fact is inside the variant and not a field of the Model, so "slow" cannot be true of a tuner that is not starting (given).
- **Command.** `WaitBeforeSlowStartHint({ attempt })` sleeps for `SLOW_START_DELAY` (1.2 seconds, `Effect.sleep`) and ends with `CompletedWaitBeforeSlowStartHint({ attempt })`. It is named for the wait, not for the hint that may follow (FOLDKIT.md, "Commands").
- **Update.** `ClickedPower` from `Off` or `Failed` raises `startCount`, enters `Starting({ attempt, isSlow: false })` and returns the Command. `CompletedWaitBeforeSlowStartHint` sets `isSlow` only when the tuner is `Starting` with the same `attempt`; in every other case it returns the Model it was given.
- **View.** A `role="status"` region sits under the On / Off button, always in the page and empty. While the tuner is starting slowly it holds the line: "Waiting for the microphone. If your browser is asking for permission, allow it." The region is there from the first render because a screen reader announces a change to a live region it already knows about, and may say nothing about a region that arrives with its text already in it.
- **The button.** Three looks: booting (ordinary cursor, dimmed), starting (ordinary cursor, not dimmed: the spinner already says it is busy), and otherwise the pointing hand and the hover colour.
- **The prerendered page** starts in `Booting`, so the build never draws the line. It does draw the empty status region.
- **Privacy.** Nothing new leaves the browser.
- **Tests.** Story: the Command on each start, the Message in every state, an old attempt during a new start. Scene: the line absent after the press, present after the wait, gone when the microphone opens or fails; the button's classes in each state. Server entry: the built page has the empty region and not the line. Headless Chrome: `getUserMedia` held back by an init script, and a normal start.
- **Version** 0.5.0.

## Calls made for Kevin

- **A number on the Model** to tell one start from the next. Without it the line can flash on a quick second start.
- **The status region is always in the page,** empty, where the brief expected the line to be added and removed whole. It changes the built HTML by one empty element.
- **The wording** of the line.

## Left to the builder

The names, the line's colour and spacing, and how the tests set a timer aside.

## Changes during the build

Recorded on 2026-11-26, after the build. Where this section and the text above disagree, this section is what was built.

- **The reason given for leaving out the Permissions API was out of date.** Firefox has answered a query about the microphone since version 132. The decision was kept, for the reasons under "Approaches".
- **Measured in headless Chrome:** a start that needs no prompt took about 0.11 seconds. With the comparison of attempts taken out, a quick on, off and on showed the line for 0.2 seconds. The line's contrast against the pedal is 4.9:1 at its lowest.
- **The pedal grows while the line shows,** by 52 px at desktop width and 72 px on a phone, as it does for the failure line. Left as it is, and in `docs/backlog.md` under "Look".
