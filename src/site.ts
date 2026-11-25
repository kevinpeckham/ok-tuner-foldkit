// site.ts: the facts about the site that more than one page states.
//
// What this file is. Plain constants: the version, and the addresses the
// footer and the Built With page link to. Nothing from Foldkit is here.
// They are in one file so that an address is written once, and so that the
// tests can check a link against the same constant the view uses.
//
// Read with: src/footer.ts and src/page/builtWith.ts, which use them.

// The version, read from package.json. Vite and Vitest both let a JSON file
// be imported like a module, and a named import takes one field of it, so
// the built script holds this one string and not the whole file.
// (`resolveJsonModule` in tsconfig.json is what lets the compiler read the
// file's shape.)
//
// It is the same in the build that prerenders the pages and in the browser,
// which a prerendered page needs (src/entry.server.ts): a value read from
// the build's environment would have to be passed to both. That is why the
// footer shows a version and not a commit.
//
// The number is raised by hand, in package.json, with each change that is
// merged (AGENTS.md, "Version").
/** The version in package.json, such as `0.2.0`. */
export { version as VERSION } from '../package.json'

/** The year in the footer's copyright line. */
export const COPYRIGHT_YEAR = 2026

/** Who holds the copyright, and who built the site. */
export const COPYRIGHT_HOLDER = 'Lightning Jar'

/** The source code. */
export const GITHUB_URL = 'https://github.com/kevinpeckham/ok-tuner-foldkit'

// The LICENSE file as GitHub shows it. The repository carries the Apache
// License 2.0, the same as Stem Shovel, which the tuner is ported from.
/** The license the code is published under. */
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`

/** The studio that built the site. */
export const LIGHTNING_JAR_URL = 'https://www.lightningjar.com'

/** The app whose tuner this is a port of. */
export const STEM_SHOVEL_URL = 'https://www.stemshovel.com'

// The address the site lives at. It is written into every page as that
// page's canonical address, into the link-preview tags, and into
// sitemap.xml and robots.txt (src/site.test.ts holds those two files to
// it). A page says this address whatever host it was served from, so a copy
// of the site at one of Vercel's own addresses points back to the original.
/** The live site's origin, with no trailing slash. */
export const SITE_ORIGIN = 'https://www.oktuner.com'

/** The site's name, as link previews show it. */
export const SITE_NAME = 'OK Tuner'

// The picture a shared link shows: a screenshot of the home page, 1200 by
// 630 pixels, the size link previews expect. It is a file in public/, made
// by `bun run og:image` (scripts/og-image.ts), not by the build. A preview
// needs the whole address, not a path.
/** The address of the link-preview picture. */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`
