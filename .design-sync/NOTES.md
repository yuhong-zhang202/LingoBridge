# design-sync notes — lingobridge

LingoBridge is a **Next.js app**, not a published component library. The sync scopes in only the
brand **presentational primitives** (10 components) + a compiled Tailwind stylesheet. App-coupled
components (routing/Supabase/hooks) are intentionally out of scope.

## How this repo builds for design-sync (package/synth-entry shape)

- **No `dist/`, no Storybook** → synth-entry from `src/`. shape pinned to `package` in config.
- **Self-symlink does NOT work**: `node_modules/lingobridge → repo root` creates a directory
  cycle (repo → node_modules → lingobridge → repo) and the converter stack-overflows. Don't.
- **PKG_DIR is set via `--entry`**: pass `--entry ./.design-sync/.cache/ds-entry.tsx`. The walk-up
  from that file finds the repo-root `package.json` (name `lingobridge`) → PKG_DIR = repo root.
- **`--entry` IS the bundle source** in package shape — it must be a CLEAN re-export entry. Pointing
  it at `next.config.mjs` pulled in `next-pwa` (node built-ins `path`/`fs`/`crypto` unresolvable).
  `.design-sync/.cache/ds-entry.tsx` re-exports exactly the 10 scoped components (regenerate if lost;
  it is gitignored under `.cache/`).
- **`@/*` alias** resolves because `cfg.tsconfig` points at `./tsconfig.json` (`paths: {"@/*": ["./src/*"]}`).

## CSS

- Components are styled with **Tailwind utilities + custom `@layer components` classes** (`.btn-gradient`,
  `.skeleton`, `.toast-enter`, etc. from `src/app/globals.css`). There is no shipped static stylesheet.
- We compile one: `npx tailwindcss -c tailwind.config.ts -i src/app/globals.css -o .design-sync/.cache/ds-styles.css --minify`
  and point `cfg.cssEntry` at it. **Re-sync must regenerate this CSS** before building (it's gitignored).
- Inline gradient styles (`GRADIENT_BORDER_STYLE`, `BRAND_GRADIENT_SOFT` from `src/lib/constants.ts`)
  travel with the JS bundle, so gradient borders render without extra CSS wiring.

## Build + validate commands

```sh
npx tailwindcss -c tailwind.config.ts -i src/app/globals.css -o .design-sync/.cache/ds-styles.css --minify
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules \
  --entry ./.design-sync/.cache/ds-entry.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check
```

## Known render warns (triaged)

- `[RENDER_SKIPPED]` — Playwright/Chromium not installed (user opted to review previews manually).
  This is expected on this machine, not a new warn.
- `tokens: 2 missing, below threshold` — a couple of `var(--*)` referenced but not defined in the
  compiled CSS; below the converter's threshold, non-blocking.

## Re-sync risks

- **Brand font NOT shipped.** Plus Jakarta Sans is loaded by the Next app at the `<html>` level via
  `next/font/google` (`--font-jakarta`), so it is absent from the component CSS and the bundle.
  Previews + designs render in a system fallback. No `[FONT_MISSING]` fires because the component
  classes don't name the family. To ship it, add a `@font-face` CSS for Plus Jakarta Sans via
  `cfg.extraFonts`. Left unwired for now (recorded per skill: substitute accepted = system fallback).
- **Render never machine-verified** — no Playwright on this machine. Visual gate was `.review.html`.
- **Compiled CSS + ds-entry are gitignored** (`.design-sync/.cache/`) — regenerate both on every
  re-sync (commands above) before the converter.
- **Grouping**: all 10 land under group `general`. Regroup later via `cfg.docsMap` category stubs if desired.
- **Scope**: TabBar / TopBar are `next/navigation`-coupled and excluded. To include them, stub
  `next/navigation` + `next/link` in the preview/bundle and re-scope.
