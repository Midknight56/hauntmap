# Third-party notices

Packages of `packages/hauntmap-mcp` (the MCP server and the `hauntmap` command line tool). The licence of each row was read from the `license` field of the installed `package.json` on 2026-11-17 (`pnpm --filter hauntmap-mcp ls --depth Infinity --json`, then each package's own `package.json`). The root application's own dependencies are in `package.json` and `pnpm-lock.yaml`; the three typefaces of the design are listed under "Fonts" below.

Direct dependencies: `@modelcontextprotocol/sdk` (the MCP TypeScript SDK), `esbuild` (the bundler), `typescript` and `@types/node` (build time only). `dist/index.js` and `dist/cli.js` bundle the SDK and its runtime dependencies, so the runtime table below ships inside them.

## Runtime dependencies (bundled into `dist/`)

| Package | Version | Licence |
| --- | --- | --- |
| `@hono/node-server` | 2.1.8 | MIT |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT |
| `accepts` | 2.0.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `body-parser` | 2.4.0 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `content-disposition` | 2.0.1 | MIT |
| `content-type` | 1.0.5 | MIT |
| `content-type` | 2.1.0 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.2.2 | MIT |
| `cors` | 2.8.6 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `depd` | 2.0.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.3 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `eventsource` | 3.0.7 | MIT |
| `eventsource-parser` | 3.1.1 | MIT |
| `express` | 5.3.0 | MIT |
| `express-rate-limit` | 8.7.4 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.9 | BSD-3-Clause |
| `finalhandler` | 2.1.1 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 2.0.0 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `hono` | 4.13.18 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `iconv-lite` | 0.7.3 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ip-address` | 10.7.6 | MIT |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-promise` | 4.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jose` | 6.2.17 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 1.1.1 | MIT |
| `merge-descriptors` | 2.0.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `negotiator` | 1.1.0 | MIT |
| `object-assign` | 4.1.1 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `on-finished` | 2.4.2 | MIT |
| `once` | 1.4.0 | ISC |
| `parseurl` | 1.3.3 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-to-regexp` | 8.4.2 | MIT |
| `pkce-challenge` | 5.0.1 | MIT |
| `proxy-addr` | 2.0.8 | MIT |
| `qs` | 6.17.1 | BSD-3-Clause |
| `range-parser` | 1.3.0 | MIT |
| `raw-body` | 3.0.2 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `router` | 2.2.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `send` | 1.2.1 | MIT |
| `serve-static` | 2.2.1 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `statuses` | 2.0.2 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `type-is` | 2.1.0 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `vary` | 1.1.2 | MIT |
| `which` | 2.0.2 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `zod` | 4.6.7 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |

## Build-time dependencies (not shipped)

| Package | Version | Licence |
| --- | --- | --- |
| `@esbuild/win32-x64` | 0.28.2 | MIT |
| `@types/node` | 24.19.2 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |
| `undici-types` | 7.24.6 | MIT |

25 optional `@esbuild/<platform>` packages of version 0.28.2 are listed by pnpm but are not installed on this Windows PC (only `@esbuild/win32-x64` is), so their licence field was not read here; this file makes no claim about them.

## Test-time dependencies of the root application (not shipped)

The licence of each row was read from the `license` field of the installed `package.json` on 2026-11-20. Both packages are used only by `tests/e2e/axe.ts`; neither is bundled into `dist/`. The MPL-2.0 applies to the files of these packages, which are used unmodified.

| Package | Version | Licence |
| --- | --- | --- |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 |
| `axe-core` | 4.14.1 | MPL-2.0 |

## Fonts

The application loads these typefaces with @font-face from the files in src/styles/fonts/ and requests no font from a remote server. Each is under the SIL Open Font License, Version 1.1, and each licence text is committed beside its font file.

| Typeface | Use | Files | Licence text |
| --- | --- | --- | --- |
| Almendra SC | display face: brand, panel headings, wing plaques, the Dependency loops button | AlmendraSC-Regular.ttf | SIL Open Font License 1.1, AlmendraSC-OFL.txt |
| Spectral (400 and 600) | interface and body text | Spectral-Regular.ttf, Spectral-SemiBold.ttf | SIL Open Font License 1.1, Spectral-OFL.txt |
| Spline Sans Mono | room names, paths, counts, the source excerpt | SplineSansMono-VariableFont_wght.ttf | SIL Open Font License 1.1, SplineSansMono-OFL.txt |

Cinzel, the display face of the earlier theme, was removed together with its files when nothing used it any more.
