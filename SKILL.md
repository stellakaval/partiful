---
name: "partiful"
description: "Work with the user's Partiful events: look up event details, her own invitations with RSVP status, guest lists and RSVP counts, invitable contacts, and mutuals. Triggers on Partiful, party invites, RSVP lists, guest counts, and event headcounts."
metadata: { "includeInPrompt": true }
---

# Partiful

## Purpose
Read the user's Partiful data: her own invitations with RSVP statuses, event
details, guest lists with RSVP statuses, contacts she can invite to an event,
and her mutuals. Partiful has **no public API**, so this skill talks to
Partiful's own backend through community reverse-engineering. Everything here
is read-only.

## Tooling
Helper CLI at `bin/partiful.mjs` (run from this skill's directory so
`node_modules` resolves). All output is JSON except raw guest CSV.

- `node bin/partiful.mjs event <eventId>` — name + start time. No token needed.
- `node bin/partiful.mjs rsvps [--summary]` — events she is invited to /
  RSVP'd to, with her RSVP status on each. Community-confirmed endpoint
  (`getMyRsvps`), but not yet run against her account — the first live run
  verifies it.
- `node bin/partiful.mjs guests <eventId> [--summary] [--statuses GOING,MAYBE] [--no-questionnaire]` — guest CSV, or headcount summary.
- `node bin/partiful.mjs invitable <eventId> [--skip N] [--limit N]` — contacts she can invite.
- `node bin/partiful.mjs mutuals` — her mutuals.
- `node bin/partiful.mjs users <id> [id...]` — user details.

Event IDs come from `partiful.com/e/<eventId>` URLs.

## Transport
Two layers, because Partiful migrated backends and the npm package did not:

1. The community `partiful-api` npm package → the old host
   `https://us-central1-getpartiful.cloudfunctions.net/<method>`
   (`guests`, `invitable`, `mutuals`, `users`). It will rot; expect drift.
2. Direct fetch → the new host `https://api.partiful.com/<method>` (`rsvps`,
   and future reads). Envelope is
   `{"data": {"params": {...}, "userId": "<firebase-uid>"}}`, the payload nests
   at `.result.data`, and the firebase uid is decoded from the JWT's `sub`
   claim — no extra call needed.

Do not call endpoint names guessed from convention: two guesses
(`getHostedEvents`, `getInvitableContacts` on the new host) 404 in production.
Only use names community-verified against a real account (see
`references/api.md`), and run each once against her account before relying on
it.

## Auth
Bearer token in the `PARTIFUL_AUTH_TOKEN` env var, grabbed from the user's own
Partiful web session (steps in `references/api.md`). It expires periodically;
on a 401, ask her to refresh it — do not retry in a loop. Never write the
token to files or memory; env only.

Planned upgrade (documented, not yet implemented): her Firebase **refresh
token** via the secret-entry flow into env (`PARTIFUL_REFRESH_TOKEN`),
exchanged at Google's Secure Token endpoint (with `Referer:
https://partiful.com/`) for short-lived JWTs cached in memory only, one retry
on 401/403. Required before any write action is usable.

## Operating Rules
- This skill is **read-only**: creating or editing events, changing RSVPs, and
  sending invites are not supported. Writes go through Partiful's Firebase
  directly and have not been reverse-engineered. Say so plainly if asked.
- `event` works without a token (public page scrape); private events return
  empty results — that means the event is private or the id is wrong, not a bug.
- The API is unofficial and can break without notice; keep calls minimal and
  report breakage as "Partiful changed something" rather than debugging deeply.
- **ToS gray area — personal use only.** This uses her own session token
  against undocumented endpoints. Fine for her personal use; do not build a
  commercial product on it or share the token pattern beyond her account.

## Roadmap (not commands yet)
- Read backfill, community-confirmed but pending one live run each:
  `event-info` (`getEventInfo`, replaces the page scrape), `hosted`
  (`getPublishedEvents`), `guests-json` (`getGuests`, replaces the CSV parse).
- Write discovery is a separate milestone: RSVP change and invite-send have no
  confirmed endpoint; each requires bundle-grep discovery plus her explicit
  per-action approval and re-verification in the Partiful app afterward. Never
  auto-RSVP or auto-invite.
