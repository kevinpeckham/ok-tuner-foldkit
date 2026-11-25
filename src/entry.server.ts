// entry.server.ts: how each page becomes an HTML file at build time.
//
// What this file is. The site is prerendered: the build runs the app once
// for each page and writes what it draws to a file (`index.html`,
// `how-to/index.html`, and `404.html` for an address the site does not
// have), so a visitor's browser shows the page before any script has run. This file is what the build runs to do it. Nothing here
// runs in the browser, and there is no server at run time: Vercel serves
// the files it was given.
//
// How it is used. `vite.config.ts` names this file as the `serverEntry` of
// Foldkit's Vite plugin. A build then does three things:
//   1. bundles the browser script from src/entry.ts, as before;
//   2. bundles this file for Node;
//   3. for each path in `prerenderPaths`, calls `renderPage` with a request
//      for that path, passes the result to `renderDocument`, and writes the
//      document to a file.
// The dev server uses the same two functions for every page request, so
// development draws pages the way the build does.
//
// What happens in the browser. The file the build wrote holds the page as
// HTML, and a script tag for src/entry.ts. That script does not draw the
// page again. `Runtime.hydrate` takes over the HTML that is there (Foldkit
// calls this hydration), and from then on the app runs as it always has.
// For that to work, the build and the browser must draw the same thing from
// the same Model. That is why `init` in src/main.ts depends on nothing but
// the address.
//
// This file replaces the `index.html` the project had while the browser
// drew everything. A prerendered Foldkit app has no source `index.html`:
// the document is built by `renderDocument` below (FOLDKIT.md, "File
// Organization").
//
// NOTE: Foldkit marks all of this experimental, and says to expect breaking
// changes. It ships from `foldkit/experimental`. After a Foldkit upgrade,
// run a build and the browser check before anything else (FINDINGS.md, "The
// pages are prerendered").
//
// Read next: src/entry.ts, the browser's half, and `init` in src/main.ts.
import { Effect } from 'effect'
import { Server } from 'foldkit/experimental'

// `init` and `view` are the same two functions the browser uses. Nothing
// about them is particular to the build: that is the point. `update` is not
// imported, because the build sends no Messages. It renders the first Model
// and stops.
import { init } from './main'
import { howToRouter, tunerRouter } from './route'
import { view } from './view'

// The site's pages, by path. The paths come from the routers in
// src/route.ts, so a path is still spelled in one place only.
//
// A page added to src/route.ts must be added here too. Nothing checks that:
// leave it out and the build writes no file for it, and opening its address
// directly is a 404 (AGENTS.md, "Pages").
/** The paths of the site's pages. */
export const pagePaths: ReadonlyArray<string> = [tunerRouter(), howToRouter()]

// The path the not-found page is drawn at.
//
// A static host answers an address that has no file with status 404, and
// Vercel sends a file named `404.html` with it, if the output has one. That
// page should look like the rest of the site, so the app draws it: no route
// matches this path, so `urlToAppRoute` gives the NotFound route, and the
// build writes the not-found view (src/page/notFound.ts) like any page.
//
// One step is left over. The plugin writes every path as a folder holding
// an `index.html`, so this one becomes `404/index.html`, which is not the
// name Vercel looks for. The build command in package.json moves it:
//
//   vite build && mv dist/client/404/index.html dist/client/404.html
//             && rmdir dist/client/404
//
// If the path here changes, change it there too. A build that did not write
// the file fails at the `mv`, which is the intention: no build ships
// without its 404 page (FINDINGS.md, "The 404 page is prerendered, then
// moved").
/** Where the build draws the page for an address the site does not have. */
export const NOT_FOUND_PATH = '/404'

// Everything the build writes as an HTML file. The plugin looks for an
// export with this name.
/** The paths the build writes as HTML files. */
export const prerenderPaths: ReadonlyArray<string> = [
  ...pagePaths,
  NOT_FOUND_PATH,
]

// What every page carries in its `<head>` besides what Foldkit puts there.
// Foldkit's document already has the character set, the viewport, the
// page's title, the stylesheet and the script. These are ours:
//   - the site icon, three ways. The files are in public/, which Vite
//     copies into the output as they are. The SVG is for browsers that
//     accept an SVG icon and the 48px PNG for those that do not. The
//     apple-touch-icon is what a phone's home screen shows (FINDINGS.md, "An
//     SVG that a browser draws inline can still fail as an image").
//   - `noindex`, which asks search engines not to index the site while it
//     is not public. vercel.json says the same a second way, as an
//     X-Robots-Tag header on every response. Making the site crawlable
//     means removing both (docs/backlog.md, "Make the page crawlable").
//
// This is HTML written as a string, and it is put into the page as it
// stands. It must only ever hold text written here, never anything taken
// from a request.
/** Extra tags for the head of every page. Exported for the test. */
export const DOCUMENT_HEAD = [
  '<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48" />',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  '<meta name="robots" content="noindex" />',
].join('\n')

// Builds the whole document around a rendered page. `Server.renderDocument`
// writes the doctype, the `<head>` and the `<body>`: the title comes from
// the `Document` that the view returned (`pageTitle` in src/view.ts), and
// `assets` holds the addresses of the built stylesheet and script, which
// the plugin supplies. The two options are the page's language and the tags
// above.
//
// The plugin looks for an export with this name.
/** Turns one rendered page into a complete HTML document. */
export const renderDocument: Server.DocumentRenderer = (application, assets) =>
  Server.renderDocument(application, assets, {
    lang: 'en',
    head: DOCUMENT_HEAD,
  })

// Renders the app at one address, and returns an Effect of the result.
//
// `Server.renderToString` is the build's stand-in for the runtime. It calls
// `init` with the address, calls `view` with the Model that comes back, and
// turns the result into HTML. It does not run the Command that `init`
// returned: Commands run in the browser, after it has taken the page over.
// The first argument is the same kind of configuration that src/entry.ts
// gives `Runtime.makeApplication`, cut down to what a single render needs.
// `routing: {}` says the app has routing, so that `init` is given the
// address.
//
// `buildId` is for the tests. A page that a browser can take over is marked
// with the id of the build that drew it, so that a script never takes over
// a page from another build. In a real build Foldkit's plugin compiles the
// id in, and nothing is passed here. A test run has no build, so a test
// passes an id of its own. With neither, the render fails with
// `MissingBuildId`.
//
// The function is separate from `renderPage` below so that the tests can
// call it (src/entry.server.test.ts).
/** Renders the app at `url`. Fails without a build id: see above. */
export const renderApplication = (url: string, buildId?: string) =>
  Server.renderToString(
    { routing: {}, init, view },
    buildId === undefined ? { url } : { url, buildId },
  )

// Renders the page for one request. The plugin looks for an export with
// this name too, and calls it with a standard `Request`: at build time one
// for each path above, and in development one for each page the browser
// asks for.
//
// `renderApplication` gives an Effect, as most things in Foldkit do. The
// plugin wants a Promise, so `Effect.runPromise` runs it here. This is the
// one place in the project where an Effect is run by hand outside a test:
// there is no Foldkit runtime in a build to do it. `Server.Rendered` wraps
// the page as "send this, with status 200".
/** Renders the page a request asks for. */
export const renderPage = (request: Request): Promise<Server.EntryResult> =>
  Effect.runPromise(
    renderApplication(request.url).pipe(Effect.map(Server.Rendered)),
  )
