# Footer and Built With page: design

Approved by Kevin on 2026-11-25. A small change, so a short design.

## Intent

Give every page a footer in the manner of Stem Shovel's last two rows, and a Built With page in the manner of Stem Shovel's, saying what OK Tuner is made of. The repository gets a license, so that the footer's license statement has something to state.

## Design

- **Row 1:** "© 2026 Lightning Jar. Open source under the Apache 2.0 license." (the license name links to `LICENSE` on GitHub), a link "Built with Foldkit" to the new page, and a link "GitHub" to the repository.
- **Row 2:** "Built by ⚡️ Lightning Jar", the version, and "Ported from Stem Shovel", with Lightning Jar and Stem Shovel linked to their sites.
- **Where:** under every page, the 404 page included, small and dimmed with a thin rule above. A `<footer>` beside the `<main>`, so that it is a landmark.
- **Built With page** at `/built-with`, prerendered: an introduction with a link to the code, groups of cards (The app, Sound, Running it, Checking it), and a closing line. Each card is a link and a line on what the thing does here.
- **License:** Apache 2.0, the same as Stem Shovel. Kevin chose it.
- **Version:** read from `package.json`, raised to 0.2.0 with this change, and from now on raised with each change a visitor would notice. No commit hash: a prerendered page needs every value to be the same in the build and in the browser.
- **Links to other sites** open in the same tab.

## Approaches

- **Version from `package.json` (chosen)** against a build-time constant from Vercel's environment, which could carry the commit but would have to reach the build's render and the browser's alike.
- **The footer in the shared shell (chosen)** against a footer per page: it is the same everywhere.

## Left to the builder

The copy of the Built With page, for Kevin to edit; class names; file names.
