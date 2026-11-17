# Deploy

HauntMap is a static site. The release build is one folder of plain files with no server code.

## Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

The output folder is `dist/`. Upload all of it.

## Any web path works

`vite.config.ts` sets `base: "./"`, so every script, style, worker and sample file is fetched by a relative path. The site works at the root of a domain and under any sub path, as long as the page address ends with a slash (`https://example.com/hauntmap/`, not `https://example.com/hauntmap`).

Checked on 17 Nov 2026: `dist/` copied to `/some/path/` on a plain static file server, opened in headless Chromium, `Explore the manor` loaded `manor/before` with no failed request and no console error.

## What the folder holds

| Path | What it is |
| --- | --- |
| `index.html` | the page |
| `assets/` | the scripts, styles and the analysis worker |
| `demo/manor/before/`, `demo/manor/after/`, `demo/annex/` | the bundled samples (`sources.json` and `expected.json`) |
| `demo/live.json` | the last live snapshot written by the Kiro hook |

## Settings for a static host

| Setting | Value |
| --- | --- |
| Build command | `pnpm build` |
| Output folder | `dist` |
| Node version | 24 |
| Redirects or rewrites | none needed (one page, no client routes) |

The development hook (`window.__hauntmap`) is only in `pnpm build:devhook`, which writes `dist-devhook/`. Never upload that folder.
