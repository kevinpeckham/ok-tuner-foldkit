// layout.ts: the frame every screen is drawn in.
//
// What this file is. Three strings of Tailwind classes, and nothing from
// Foldkit: the page ground, the `<main>` and the centred column. They were
// written out in `view` in src/view.ts until the crash screen needed the
// same frame.
//
// Why they are in a file of their own. The crash screen (src/crash.ts) is
// what Foldkit draws when the app has stopped, and it must look like the
// site without calling the app's own `view`, which may be the code that
// just threw. It also must not fall behind when the look changes: nobody
// looks at a crash screen until it is needed. So the frame is stated once,
// here, and `view`, the header, the footer and the crash screen all read it.
//
// Tailwind finds a class by reading the source as text (src/styles.css), so
// a class name kept in a constant is found like any other, as long as it is
// written out in full.
//
// Read with: `view` in src/view.ts, which puts the three together.

// The dark ground (`bg-oxford-dark`, a colour defined in styles.css) and
// the colour of ordinary text. The element is a column as tall as the
// window (`flex min-h-screen flex-col`), so that a `<main>` with `flex-1`
// can push a footer to the bottom of a short page.
/** The outer element of every screen: the ground, and a full-height column. */
export const PAGE_CLASS =
  'flex min-h-screen flex-col bg-oxford-dark text-slate-100'

// `flex-1` takes whatever height the header and the footer leave. `px-6`
// keeps the text off the edges of a narrow window.
/** The `<main>` of every screen. */
export const MAIN_CLASS = 'flex-1 px-6 pb-12'

// One centred column, at most 600px wide. The header, the `<main>` and the
// footer each hold one, so their left edges line up.
/** The centred column that everything on a screen sits in. */
export const COLUMN_CLASS = 'mx-auto w-full max-w-[600px]'
