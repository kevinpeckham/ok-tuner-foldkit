# "How to use the tuner" on its own page: design

Approved by Kevin on 2026-11-25. A small change, so a short design.

## Intent

Move the "How to use the tuner" text off the main page, so the main page is the heading, one line and the tuner. It is the app's first second page, and the first use of Foldkit's routing: the comparison with SvelteKit had not touched routing. Server rendering is to be considered next, and should be able to build on this.

## Goals

- The tuner at `/`, the how-to text at `/how-to`, and a link each way.
- Opening `/how-to` directly works, on the dev server and on Vercel.
- The browser's back and forward buttons work.

## Not goals

- No change to the how-to text.
- No restructuring of the tuner into a page module of its own.
- No server rendering or prerendering in this change.

## Anti-goal

The microphone must never stay open on a page that shows no tuner.

## Approaches

1. **Foldkit routing (chosen).** The route is a field of the Model, link clicks and address changes are Messages, and `init` reads the address. It is the pattern of Foldkit's `routing` example, and the shape its experimental prerender expects.
2. **A static `how-to.html` beside `index.html`.** Less code and no script, but it tests nothing about routing and repeats the page shell by hand.
3. **A disclosure or dialog on the main page.** Not a page: nothing to link to.

## Design

- **Routes:** `Tuner` at `/`, `HowTo` at `/how-to`, and `NotFound` for anything else.
- **Main page:** the how-to box is replaced by one text link under the tuner, "How to use the tuner".
- **How-to page:** the same "OK Tuner" heading and column, the existing text unchanged, and a link "Back to the tuner". Its tab title is its own.
- **Leaving the tuner page switches the tuner off.** Any address change to a route other than `Tuner` sets the tuner to `Off`, and the runtime then releases the microphone. A failure message is cleared the same way.
- **Unknown address:** a short "Page not found" with a link to the tuner.
- **Vercel:** a rewrite sends every path that is not a file to `index.html`.
- **Tests:** address parsing; Story tests for the new Messages, including "leaving switches the tuner off"; Scene tests for what each route shows and where its link points; a click through and back in a real browser.
- **Docs:** teaching comments on the new code, `FINDINGS.md` for what routing taught, the backlog item removed.

## Calls made for Kevin

- "Nothing is recorded" appears only in the how-to text, so it leaves the main page with it.
- An unknown address returns the app with status 200, not 404, until pages are prerendered.

## Left to the builder

File names, the link's styling, and the exact wording of the not-found page.
