# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wonder Jar is a family gratitude-journal PWA for the Ortiz family: kids speak or type a nightly "happy thought" into a glowing jar and earn rewards (Glimmers, badges, sparks, family milestones). It is a **zero-dependency, no-build static site** — four files total:

- `index.html` — the entire app: all CSS in one `<style>` block (~lines 15–488), all JS in one `<script>` block (~lines 605–2621), organized by `// ---------- section ----------` comment headers.
- `sw.js` — service worker: network-first caching plus nightly reminder notifications via periodic background sync.
- `manifest.webmanifest`, `icon.svg` — PWA install metadata.

## Development

There is no build step, package manager, linter, or test suite. To run locally:

```bash
python3 -m http.server 8000   # any static server works
```

Serve over http(s) — service worker and PWA features don't work from `file://`. Verify changes by exercising the app in a browser.

When shipping changes to cached assets, bump the `CACHE` version constant in `sw.js` (`wonderjar-v2` → `wonderjar-v3`) so installed clients pick up the new files.

## Architecture

### Data model: one flat record store

All persistent state lives in a single object `data = { records: {} }`, keyed by record id. Every record carries `id`, `type`, `updatedAt` (epoch ms), and optionally `deleted: true`. Record types:

- `entry` — a night's thought (`kidId`, `text`, `prompt`, `date`); id `entry_<uid>`
- `glimmer`, `badge` — earned rewards per kid; deterministic ids like `badge_<kidId>_<badgeId>`
- `wishspent` — a "Wonder Wish" spent to patch a missed streak night
- `reaction` — a parent/sibling heart (+ optional note) on an entry
- `profile_<personId>`, `pin_<personId>`, `reward_<milestone>` — customization, PINs, claimed family milestones

Rules that follow from this design:

- **Never hard-delete a record.** Set `deleted: true` and bump `updatedAt` (tombstone). Sync merge purges tombstones older than 60 days. Every read helper (`entriesFor`, `glimmersFor`, etc.) filters `!r.deleted` — new queries must too.
- **Every mutation must set `updatedAt: Date.now()` and then call `syncAfterChange()`** (saves locally, debounces a Gist push by 1.5s). `saveLocal()` alone is only for non-record state.
- Prefer deterministic record ids (e.g. `pin_dad`, `wishspent_<kid>_<date>`) so the same logical record merges cleanly across devices; use `uid()` only for entries.

### Sync: GitHub Gist, offline-first

`Sync` (in index.html) pulls a JSON file from a Gist, merges per-record by last-write-wins on `updatedAt`, and PATCHes back. Local always works without network; sync status shows via `setSyncDot('pending'|'ok'|'err')`. `pullAndRender()` runs at startup and on tab visibility. Sync is configured through Settings (`gist_token` + `gist_id` in `Store`).

### Local storage split

`Store` wraps localStorage with the `wonderjar_` prefix. **Device-local** keys: `data` (the record cache), `gist_token`, `gist_id`, `anthropic_key`, `trust_device`, `seen_reactions_<kid>`. Anything that should follow the family across phones (avatars, tints, PINs) goes in **synced records**, not bare Store keys.

### Time: Arizona is canonical

All date logic goes through the `AZ` helper (`America/Phoenix`, no DST). Dates are `YYYY-MM-DD` strings from `AZ.today()` / `AZ.dateKey()`. Never derive a date key from raw `new Date()` — device timezones would break streaks. `sw.js` has its own copies (`azToday`, `azHour`) since it can't share code with the page.

### Screens and rendering

Four `<section class="screen">`s toggled by `show(screenId)`: `screen-profiles` (person picker), `screen-journal` (the jar + capture UI), `screen-sky` (family constellation of shared milestones), `screen-admin` (parent-only entry browser). Rendering is manual re-render functions (`renderProfiles`, `renderStats`, `renderJarFireflies`, `renderAdminList`…); `refreshCurrentView()` re-renders whichever screen is active after a sync pull.

### Key behaviors to preserve

- **One glowing thought per night per kid**: saving when today's entry exists appends to it (newline-joined) rather than creating a second entry. Glimmer/badge/follow-up rewards only fire for genuinely new entries (`isNew`).
- **Streaks** (`statsFor`): today gets grace if not yet filled; an available Wonder Wish (earned every `WISH_EVERY = 7` entries) is auto-spent to patch exactly one missing night inside a chain, writing a `wishspent` record.
- **Celebration queue**: reveals (glimmer, badge, reaction, follow-up) show one at a time via `queueCeleb`/`nextCeleb` — don't stack overlays directly.
- **PINs**: each person can have a 4-digit PIN (synced record). A parent PIN opens any kid's jar; `requireParentPin` gates the admin view; `trust_device` (local, set in Settings) bypasses all PIN prompts on that device.
- **Reminders**: the page pushes `lastEntryByKid` to the service worker (`updateSWMeta` → postMessage → IndexedDB `wonderjar-sw`), and `sw.js` nudges via periodic sync only after 4pm Arizona time.

## Conventions

- **Build DOM with `createElement` + `textContent` only** — the codebase contains zero `innerHTML`. Entry text, notes, and names are user content; keep it that way.
- **No native dialogs** — never `alert`/`confirm`/`prompt`. Use `showModal`, `showInputModal`, `showPinModal`, `showTextModal`, and `toast(msg)` for transient feedback.
- **Anthropic API is strictly optional.** `askClaude` powers follow-up questions and the Wonder Report/Week of Wonder insights, but every AI path must silently no-op when `anthropic_key` is missing or the request fails — the app fully works without a key.
- Tone: all user-facing copy is warm and kid-friendly (ages ~9–12), emoji-rich, never babyish or negative — match the existing voice in prompts, toasts, and badge names.
- `PEOPLE` (Sedona, River, Mom, Dad) is a hardcoded constant; per-person customization layers on top via `profile_*`/`pin_*` records, not by editing the constant shape.
