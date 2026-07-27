# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`site-engine` is a standalone CMS + e-commerce app for a single LeadBase tenant website (blog, products, cart/checkout, shipping, AI-editable themes). It is provisioned and managed by a separate Laravel app, `lead-base` — **not part of this repo**. Every website tenant runs its own instance (own DB, own `/admin`), authenticated via LeadBase OAuth. Full design docs live in `docs/` (`PRD.md`, `architecture.md`, `system_design.md`, `tech_doc.md`, `task_list.md`) — read `docs/tech_doc.md` first for stack rationale and directory layout; note the docs describe the original design and some shipped features (payment/shipping/coupons, blog site-type, tracking pixels, single-device login) may not be fully reflected there.

## HARD RULE: never discard uncommitted work without explicit permission

**Never run `git checkout -- <file>`, `git restore`, `git reset --hard`, `git clean`, or any other command that discards uncommitted changes — for ANY file, for ANY reason — without the user explicitly approving that specific action first.** This applies even if a file looks broken, half-finished, or like "leftover debris" from a previous edit. Uncommitted local changes are not recoverable from git once discarded, and a file that looks like a mistake may actually be deliberate in-progress work the user has not committed yet.

If a file appears broken and you suspect reverting would fix it: **stop and ask** ("this file looks broken — do you want me to revert it to the last commit, or fix it in place?"). Fixing forward (editing the file to correct the actual problem) is almost always the safer default over reverting. Only revert after the user has confirmed that's what they want, and confirm exactly which file(s) and to which commit.

## RULE: keep AI-facing prompts terse

When writing or editing text that gets sent TO an AI model as a prompt (system prompts, `RESPONSE_FORMAT_GUIDE`, tool descriptions in `ToolRegistry`, agent `systemPrompt` seeds, etc.) — every extra sentence is tokens spent on every single call. State the rule/format directly. Do not add explanatory prose, rationale, or examples beyond what's needed for the model to comply. If a shorter phrasing conveys the same instruction, use it.

Tool `name`/`description` fields sent to an AI model (MCP `inputSchema` descriptions, `ToolRegistry` tool descriptions) must be in **English**, not Vietnamese — regardless of the surrounding code comments' language. This content is model-facing context, not human-facing UI copy or internal documentation. The same applies to authored error/refusal strings a tool's `execute()` returns or throws on failure (e.g. "Missing required field X", "Not permitted", validation messages) — those go back into the model's context too. Data values pulled from the DB (a real customer/campaign name, a user-entered note) are not authored strings and don't need translating.

## Commands

```bash
npm install
cp .env.example .env        # fill DATABASE_URL, SITE_ENGINE_SECRET, LEADBASE_API_URL, ... (see docs/ENV.md)
npm run prisma:migrate      # create/apply migrations against local DB
npm run dev                 # tsx watch on src/server.ts, port 3040, excludes themes/uploads/debug-ai
npm run build                # prisma generate + tsc -p tsconfig.json -> dist/
npm run start                 # node dist/server.js (compiled, used in production)
npm test                       # vitest run
npm run release                # scripts/build-release.sh -> site-engine.zip (dist/prisma/views/themes/assets/package.json)
npm run prisma:deploy          # prisma migrate deploy (production/VPS, no new migrations)
```

Single test file: `npx vitest run path/to/file.test.ts`. Single test name: `npx vitest run -t "test name"`. There is no `vitest.config.*` — defaults apply, and no test files exist in the repo yet.

Dev-only auth backdoor: `GET /dev/login-as-admin` logs in as a local admin without going through LeadBase OAuth — only registered when `NODE_ENV !== "production"` ([server.ts](src/server.ts)).

## Architecture

### Single-tenant, no multi-tenant code

This repo has **zero concept of multiple websites**. No `websiteId` column, no domain-based routing. Each running process serves exactly one website with its own `.env` and DB. If you find yourself writing code that queries "by websiteId" or branches on domain/Host header, that's a sign of drifting into the wrong (rejected) architecture — see `docs/architecture.md` §1. The packaging/deploy side (building `site-engine.zip`, unzipping N times, systemd template units) lives entirely in the `lead-base` repo, not here.

### Route registration is centralized and explicit

`src/server.ts` is the single composition root: it registers ~50 route modules by hand (no auto-discovery), sets up sessions, the ecommerce-path gate, the 404 handler, and dynamic plugin loading, then starts cron jobs. Route modules live in `src/routes/admin/*.ts` (session-gated, `requireRole()` from `src/plugins/requireRole.ts`) and `src/routes/public/*.ts`. Most `admin/*.ts` files pair with an `admin/*Ui.ts` counterpart — the former is a JSON API, the latter renders the admin HTML page that calls it.

Roles are hierarchical (`edit` < `manager` < `admin`, `ROLE_RANK` in `src/plugins/requireRole.ts`) — `requireRole(minRole)` gates by minimum rank; for exact-role checks compare `session.get("role")` directly.

### E-commerce is a togglable module, not a separate app

`SiteConfig.siteType === "blog"` completely blocks every ecommerce path (public and admin) via an `onRequest` hook and prefix list (`ECOMMERCE_PATH_PREFIXES` in [server.ts](src/server.ts)) — checked before touching the DB on non-matching paths to avoid a query per request on blog-only sites. When adding a new ecommerce route, add its prefix to that list.

### Theming: Liquid, no build step, two render paths

Both the public site and the admin UI are server-rendered LiquidJS (`@fastify/view` for admin, a dedicated engine in `src/services/themeRenderer.ts` for public) — deliberately not React/Vite, so AI chat and the inline click-to-edit tool can change a theme file and see the result immediately with no compile step. Liquid was chosen specifically because AI/agent-generated themes need real logic (loops/conditionals) but must never execute server-side code — unlike EJS. Built-in themes live in `themes/{slug}/` (sibling of `dist/`, not compiled by `tsc`, copied verbatim into the release zip); `ThemeConfig.activeTheme` picks which one is live. `themeRenderer.ts`'s `renderPublic()` is the single place that assembles render context (site config, menus, plugin data/blocks, URL prefixes, analytics scripts, JSON-LD schemas) for every public template.

Theme editing currently has one working surface: `themeInlineEdit.ts` (click-to-edit static content directly in the live preview). There used to also be a full AI chat agent that redesigned themes wholesale (multi-step tool-calling loop with file read/write, a tester+reviewer QA gate, live-iframe error/screenshot capture) — that UI and its backend (`services/themeChat.ts`, `services/themeTester.ts`, `services/uiuxSearch.ts`, `services/themeSkills.ts`, `src/agents/tester.md`/`reviewer.md`) were removed as dead code; only the file-read endpoint survives in `themeChat.ts` (`GET /admin/api/themes/:slug/file`, used by the theme editor's file tree). `themeContract.ts`/`themeValidator.ts` remain — they still validate AI-generated theme output for the plugin/addon rendering paths and `themeInlineEdit.ts`. If AI-driven theme redesign gets rebuilt, it's expected to go through the shared `ai-chat-widget` rather than a page-specific chat drawer.

### Plugin system: dynamically loaded, sandboxed against core tables

Plugins live under `src/addons/{slug}/` with a `manifest.json` (validated by the zod schema in `src/services/pluginDb.ts`), an optional `install.ts` (`setup(prisma, slug)` — create the plugin's own tables, seed plugin-scoped `Agent` rows), and an optional `backend/index.ts` (`register(app)` — add Fastify routes). `server.ts` loads these dynamically at startup by scanning `src/addons/`, checking the `Plugin` DB row is `enabled`, then dynamically `import()`-ing both files.

Plugins get a restricted Prisma client (`getPluginDb()` in `src/services/pluginDb.ts`): all ORM write operations on core models are blocked outright; raw SQL writes are checked against the plugin's declared `allowedTables` and can never touch core-model table names. Plugins declare in their manifest which core models they may *read* (`READABLE_CORE_MODELS`), what public data/blocks/actions they expose to the public site (rendered into `pluginData`/`pluginAreas` in the Liquid context by `buildPublicPluginContext()`), and optional `themeContracts` — instructions injected into the theme so AI-generated themes render the plugin's markup correctly (see `manifest.json` in `src/addons/customer-support/` for an example contract). See `src/routes/admin/plugins.ts` for the admin-facing management API.

### Two "AI" surfaces — don't conflate them

- **In-product AI agents** (`Agent` Prisma model, `src/services/aiClient.ts`, `assets/data/AGENT_MANUAL.md`): AI features the app itself ships to admins/customers — the admin chat widget (`src/routes/admin/aiChat.ts`, `views/admin/components/ai-chat-widget.liquid`, backing plugin `src/addons/admin-ai-chat/`), customer support chat (`src/addons/customer-support/`), content generation (`src/services/contentGenerator.ts`). `assets/data/AGENT_MANUAL.md` is a lookup doc the chat agent can fetch by heading (`read_manual` tool) — one heading per admin sidebar page. These agents are configured/seeded per plugin and stored in the DB, not hardcoded.
- **Claude Code** (you, working in this repo) — unrelated to the above; this file is your guidance, not theirs.

### Order flow crosses a trust boundary via HMAC

`src/security.ts` implements the sign/verify pair (ported from `facebook-gateway/src/security.ts`) used for **both** directions of the LeadBase↔site-engine relationship, keyed by a single per-instance `SITE_ENGINE_SECRET`: outbound order creation (`src/services/leadbaseClient.ts`) and inbound product sync (`src/routes/public/productsSync.ts`, which requires the raw request body — see the global `addContentTypeParser` in `server.ts` that stashes `request.rawBody` for signature verification). Never log the secret or a computed HMAC.

## Docs map

- `docs/tech_doc.md` — stack rationale, directory layout, env vars, coding conventions, VPS setup notes.
- `docs/architecture.md` — LeadBase ↔ site-engine boundary, data flow.
- `docs/system_design.md` — DB schema, bidirectional API contracts, state machines.
- `docs/ENV.md` — full env var reference.
- `docs/CONTRIBUTING.md` — dev setup/scripts/testing expectations.
- `docs/RUNBOOK.md` — deploy/release flow and common operational issues.
