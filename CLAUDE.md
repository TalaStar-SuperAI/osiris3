# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What OSIRIS is

OSIRIS is a real-time global OSINT (open-source intelligence) situational-awareness
dashboard. A single GPU-accelerated MapLibre GL map aggregates live feeds — aviation,
maritime, CCTV, seismic, wildfires, news, weather, space weather, cyber/CVE threats,
conflict zones, crypto-wallet tracing and OFAC sanctions — plus an in-browser RECON
toolkit (port/DNS/WHOIS/SSL/IP/CVE scanning). Almost everything runs **without any API
keys**: core feeds use public keyless sources. Only the RECON scanner backend and the
AI briefing features require configuration.

## Commands

```bash
npm run dev          # Next.js dev server (Turbopack) on http://localhost:3000
npm run build        # production build (output: 'standalone')
npm start            # serve the standalone build
npm run lint         # eslint (flat config, eslint.config.mjs)

npm test             # vitest run — unit tests only (network tests skipped)
npm run test:watch   # vitest watch mode
npm run test:live    # RUN_LIVE_TESTS=1 — opt-in live-network integration tests
```

Run a single test file / test:
```bash
npx vitest run src/app/api/cctv/utah.test.ts
npx vitest run -t "name of test"
```

Tests live next to code as `*.test.ts` (see `vitest.config.ts` — node environment,
`@` aliased to `src/`, 30s timeout). Live-network tests are gated behind
`RUN_LIVE_TESTS=1` so the default `npm test` stays offline and deterministic.

**Build caveat:** `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so a
production build does **not** type-check. Run `npx tsc --noEmit` (or rely on the editor)
to catch type errors — the build will not.

## Architecture

Three deployable services, wired together by `docker-compose.yml`:

1. **`osiris`** — the Next.js 16 app (App Router). The whole UI plus ~50 API routes.
2. **`osiris-intel`** — a standalone Express service in `intel/server.js` (port 4000).
   The **ontology / entity-resolution engine**.
3. **`osiris-cache`** — an nginx reverse-cache in front of the app (`nginx/`).

### Frontend (`src/app/page.tsx` + `src/components/`)

`page.tsx` is the single client-side root (`'use client'`). It owns all layer-toggle
and panel state and orchestrates the components. `OsirisMap.tsx` (the largest file,
~100 KB) is the MapLibre GL canvas — **all map entities are rendered as WebGL layers,
not DOM**, which is the core performance constraint: adding data means adding/​updating
MapLibre sources & layers, not React nodes. Heavy components (`OsirisMap`, `LayerPanel`,
`CameraViewer`, `OsintPanel`, `EntityGraphPanel`) are `next/dynamic` imports, and
`OsirisMap` is `ssr: false`.

Data flow: components fetch from same-origin `/api/*` routes; the app never calls
external OSINT providers directly from the browser. Layers fetch **on-demand** when
toggled on, and a per-layer fetched-guard (`layerFetchedRef` pattern) prevents duplicate
requests — polling intervals are deliberately relaxed (15–30 min for stable feeds) to
keep edge-request volume down.

### API routes (`src/app/api/*/route.ts`)

Each route is a server-side proxy/normalizer for one intelligence domain (`flights`,
`cctv`, `earthquakes`, `maritime`, `fires`, `news`, `satellites`, `sentinel`, `gdelt`,
`weather`, `space-weather`, `markets`, …) plus the `osint/*` RECON tools (`whois`, `dns`,
`ip`, `cve`, `sanctions`, `bgp`, `phone`, `certs`, `shodan`, `mac`, `sweep`, `leaks`,
`threats`, `github`). Routes fan out to public feeds, normalize the shapes, and return
JSON to the client. Many set `export const maxDuration = 60`.

Conventions to follow when adding/editing a route:
- **Outbound fetches go through `stealthFetch` (`src/lib/stealthFetch.ts`)**, which
  rotates spoofed browser fingerprints/headers to spread load across public APIs.
- **Any route taking a user-controlled host/IP MUST use the SSRF guard**
  (`src/lib/ssrf-guard.ts`) before fetching — it resolves A/AAAA records and rejects
  reserved/internal ranges (RFC1918, loopback, link-local incl. cloud metadata, etc.).
- **Fail closed on missing config:** the `scanner` route returns `503` when
  `SCANNER_URL`/`SCANNER_KEY` are unset; the SDK ingest route disables itself when
  `SDK_INGEST_KEY` is unset. Match this pattern rather than degrading silently.

### CCTV registry pattern (`src/app/api/cctv/`)

CCTV is the largest multi-source aggregation. Each country/provider is its own module
(`taiwan.ts`, `iceland.ts`, `france.ts`, …) exporting a `fetch<Country>Cameras()`
function; `route.ts` imports and combines them, and supports viewport-aware loading via
`?region=` or `?lat=&lng=&radius=`. **To add a CCTV source, add a new module and register
it in `route.ts`** — don't inline it. Shared shapes live in `cctv/types.ts`. Files ending
`.generated.ts` are produced by tooling — edit the generator/source, not the output.

### Intelligence layer (`intel/server.js`)

A separate Express app (its own `package.json`/`node_modules`/`Dockerfile` under
`intel/`) — **not** part of the Next build. It exposes `GET /resolve?type=<type>&id=<id>`
for `aircraft | vessel | company | person | ip | country`, returning a `{ nodes, links }`
entity graph. It correlates:
- **OpenSanctions OFAC SDN** — bulk CSV loaded in-memory, refreshed every 24h, name/alias
  normalized index. Every resolver cross-checks its subject against this and emits a
  `sanction` node on a match.
- **Wikidata SPARQL** — on-demand lookups (LRU-cached 24h) for ownership, nationality,
  operators, etc.
- **ip-api.com + RIPEstat** for IP ge/ ASN / WHOIS / abuse-contact enrichment.

Security posture is strict and must be preserved: outbound requests are restricted to an
`ALLOWED_DOMAINS` allowlist, SPARQL inputs are sanitized against injection, and `/resolve`
is per-IP rate-limited.

The Next app reaches this service from `src/app/api/entity/expand/route.ts` via
`INTEL_URL` (defaults to `http://osiris-intel:4000` in Docker, `http://localhost:4000` in
dev). The result feeds the `EntityGraphPanel` force-graph in the UI.

### Polybolos SDK (`src/lib/sdk/` + `src/app/api/sdk/`)

A standardized multi-domain entity model (`types.ts` — `PolybolosEntity`, `Domain`,
`EntityType`, `ThreatLevel`) plus a client (`PolybolosClient.ts`) and a `LatticeAdapter`
for external interop. `POST /api/sdk/ingest` accepts external entity pushes (auth via
`SDK_INGEST_KEY`) and `GET /api/sdk/stream` is an SSE feed. **The ingest/stream pair share
an in-memory store attached to `globalThis`** — it is process-local and non-persistent, so
it resets on restart and is not shared across serverless instances.

### AI engine (`src/lib/ai-engine.ts` + `src/app/api/ai/*`)

Gemini (`gemini-2.0-flash`) integration for correlating feeds into briefings/analysis
(`analyze`, `briefing`, `overview` routes). Keys are read from **numbered env vars**
(`GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, …) and rotated per-request; a user can also
supply their own key via the settings panel (`TokenPanel`). Absent any key, the AI routes
report that no key is configured rather than erroring.

## Environment & configuration

`.env.example` is the source of truth (copy to `.env`). The **only** vars the current code
reads are `SCANNER_URL` / `SCANNER_KEY` (RECON backend; `SCANNER_KEY` must equal the
backend's `OSIRIS_KEY`), `GEMINI_API_KEY_*` (AI), `SDK_INGEST_KEY` (SDK ingest),
`INTEL_URL` (intel service), and `OSIRIS_PORT` (published host port; the container always
listens on 3000). The other keys in `.env.example` (`FIRMS_API_KEY`, `OPENSKY_*`,
`N2YO_API_KEY`, `AIS_API_KEY`) are documented for future use / higher rate limits but are
**not** currently consumed — don't assume a feed depends on them. `OSIRIS_TELEGRAM_CHANNELS`
is likewise documented in `README.md`/`DOCKER.md`/`.env.example` as a Telegram-channel
override, but the current code ignores it too: `src/app/api/news/route.ts` uses a hardcoded
`TELEGRAM_CHANNELS` list and reads no env var.

Path alias `@/*` → `src/*` is configured in both `tsconfig.json` and `vitest.config.ts`.

See `DOCKER.md` for the full self-hosting / CasaOS / API-key guide. `deploy.sh` is the
maintainer's git→SSH→docker-rebuild deploy script targeting a specific host (not for
general use).
