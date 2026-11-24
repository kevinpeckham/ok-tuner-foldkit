import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

// Varlock resolves .env.schema, with its values from 1Password, the moment its
// plugin is imported, and puts the result in process.env. So it is imported
// only when it is going to be used: SKIP_VARLOCK=1 leaves it out, for anyone
// without 1Password access. Never set SKIP_VARLOCK on Vercel.
const varlockPlugins = process.env['SKIP_VARLOCK']
  ? []
  : [(await import('@varlock/vite-integration')).varlockVitePlugin()]

// Source maps go to Sentry from Vercel builds only, with the token Varlock
// just resolved. .env.schema makes the token required there, so a Vercel build
// without it fails. A local build never uploads and makes no maps.
const sentryAuthToken = process.env['SENTRY_AUTH_TOKEN']
const uploadsSourceMaps =
  Boolean(process.env['VERCEL']) && Boolean(sentryAuthToken)

export default defineConfig({
  plugins: [
    ...varlockPlugins,
    tailwindcss(),
    foldkit(),
    sentryVitePlugin({
      org: 'lightning-jar',
      project: 'ok-tuner',
      authToken: sentryAuthToken,
      telemetry: false,
      disable: !uploadsSourceMaps,
      // The maps are for Sentry, not for the site: removed once uploaded.
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ],
  build: {
    sourcemap: uploadsSourceMaps ? 'hidden' : false,
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
