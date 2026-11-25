// route.ts: the app's pages, as data.
//
// What this file is. A route is a value that says which page is showing. The
// Model holds one (`route` in src/main.ts), and the view draws the page it
// names (src/view.ts). This file declares the routes and the two-way mapping
// between a route and an address:
//
//   - address to route: `urlToAppRoute` reads the address the app was opened
//     at, and every address it moves to afterwards;
//   - route to address: a router called with no arguments gives the path of
//     its page, and links are written with it. `howToRouter()` is `'/how-to'`.
//
// One definition does both jobs, which is what Foldkit calls a "biparser": a
// description of a path that can be read and printed. A path is therefore
// spelled once, here, and nowhere else.
//
// The routes are in a file of their own because three files need them:
// main.ts for the Model and `update`, view.ts and the pages under src/page
// for links. Foldkit's `routing` example is laid out the same way
// (repos/foldkit/examples/routing).
//
// Read the ROUTING part of the header of src/main.ts for how an address
// change travels through the app.
import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
// `defineRouteUnion` and `literal` live in the `foldkit/route` module. The
// `Route` namespace imported above is the same module under one name:
// `Route.root` and `literal` come from the same place. The spelling here
// follows Foldkit's own examples.
import { defineRouteUnion, literal } from 'foldkit/route'

// ROUTE

// `defineRouteUnion` is to routes what `defineMessageUnion` is to Messages
// (FOLDKIT.md, "Project Conventions"): one object, one key per variant, the
// fields as Schemas. It returns a Schema for the whole union, which is what
// lets `route` be a field of the Model, and a constructor for each variant:
// `AppRoute.Tuner()` gives `{ _tag: 'Tuner' }`.
//
//   Tuner     the tuner, at `/`.
//   HowTo     "How to use the tuner", at `/how-to`.
//   BuiltWith what the app is made of, at `/built-with`.
//   NotFound  any other address. It carries the path that was asked for.
export const AppRoute = defineRouteUnion({
  Tuner: {},
  HowTo: {},
  BuiltWith: {},
  NotFound: { path: Schema.String },
})

// The same name again, as a type: the usual pairing for a Schema
// (src/main.ts, the note at `TunerState`).
export type AppRoute = typeof AppRoute.Type

// The id of the heading that names the page showing. Every page's view
// puts it on one heading, and the `FocusPageHeading` Command in src/main.ts
// moves focus to the element that has it when the page changes. It lives in
// this file because the views and main.ts both need it, and both already
// import from here.
export const PAGE_HEADING_ID = 'page-heading'

// ROUTER

// A router is built in two steps, joined with `pipe`:
//   1. a description of the path. `Route.root` matches a path with no
//      segments, which is `/`. `literal('how-to')` matches the one segment
//      `how-to`.
//   2. `Route.mapTo(constructor)`, which ties the path to a route. The
//      result can parse a matching address into that route, and, called as a
//      function, print the path for it.
//
// None of these routes has parameters. A route with some, such as a page per
// tuning, would add them to the path (`slash(int('id'))` in Foldkit's
// examples), and its router would take them as its argument.

/** The tuner's page, at `/`. */
export const tunerRouter = pipe(Route.root, Route.mapTo(AppRoute.Tuner))

/** The how-to page, at `/how-to`. */
export const howToRouter = pipe(literal('how-to'), Route.mapTo(AppRoute.HowTo))

/** The Built With page, at `/built-with`. */
export const builtWithRouter = pipe(
  literal('built-with'),
  Route.mapTo(AppRoute.BuiltWith),
)

// PARSE

// `Route.oneOf` tries each router in turn, and the first to match the whole
// path wins. A router matches only when it uses up every segment, so
// `/how-to/extra` is not the how-to page.
//
// `Route.parseUrlWithFallback` wraps that in a function that cannot fail: an
// address no router matches becomes `AppRoute.NotFound({ path })`. That is
// why NotFound is a route like the others and not an error: the app always
// has a page to draw.
//
// What matches, as pinned in src/route.test.ts: a trailing slash, a query
// string and a fragment are ignored, so `/how-to/` and `/how-to?x=1` are the
// how-to page. A path is split at its slashes and empty pieces are dropped,
// which is why the trailing slash does not count (and why `//` is the tuner
// too). Capitals do count: `/How-To` is not found.
/** The route for an address. Never fails: an unknown address is NotFound. */
export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(howToRouter, builtWithRouter, tunerRouter),
  AppRoute.NotFound,
)
