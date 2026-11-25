// vite-env.d.ts: tells TypeScript about the things only Vite understands.
//
// src/entry.ts imports a stylesheet (`import './styles.css'`). That is not
// TypeScript: Vite sees the import during a build and adds the stylesheet
// to the page. Without this file the compiler rejects the import, because
// it knows of no module by that name. The line below loads Vite's own
// declarations, which say what importing a `.css` file means.
//
// A `.d.ts` file holds types only and produces no code. The three slashes
// are TypeScript's syntax for "include these types".
/// <reference types="vite/client" />
