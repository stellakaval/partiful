# Partiful API (unofficial) — reference

Partiful has **no public API** (re-confirmed 2026-09-22; community projects
July–Sep 2026 agree; Partiful's payment endpoints are also undocumented). This
skill uses community reverse-engineering of Partiful's own backend.

## Backend transport

Firebase Cloud Functions, POST to `https://api.partiful.com/<functionName>`:

```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
Origin: https://partiful.com
Referer: https://partiful.com/
{"data": {"params": {<endpoint-specific>}, "userId": "<firebase-uid>"}}
```

Responses nest at `.result.data` (`getPublishedEvents` responds with a bare
array instead). The older host
`https://us-central1-getpartiful.cloudfunctions.net/<method>` still serves the
npm package's calls but Partiful has migrated — the package is pinned to the
old host and will rot.

Confirmed-real read endpoints (method names are bare string literals in
Partiful's public JS bundles — bundle-grep verified, each called at least once
against a real account, July–Aug 2026):

| Method | Params | Notes |
|---|---|---|
| `getMyRsvps` | `{}` | All events she is invited to / RSVP'd to; richest event objects. Wired as CLI `rsvps` — pending first live run against her account |
| `getEventInfo` | `{eventId}` | Real event detail; replaces the page scrape. Not wired yet |
| `getGuests` | `{eventId}` | Full guest list as JSON; replaces the fragile CSV parse. Not wired yet |
| `getPublishedEvents` | `{userId}` | Events she hosts; bare-array response. Not wired yet |
| `getContactsFilteredByEvent` | `{eventId}` | Invitable contacts, no pagination. Not wired yet (CLI `invitable` still uses the old-host package call, which works) |
| `getMutuals` | `{}` | Via the package |
| `getUsers` | `{ids, includePartyStats}` | Via the package |
| `getMutualGuests`, `getEventComments`, `getEventMedia`, `getEventRestrictions`, `getEventPermission` | various | Confirmed names, not wired |

Do NOT use: `getHostedEvents` and `getInvitableContacts` on the new host —
both 404 in production. Method names are never guessed from convention.

## Auth token

1. Log in at partiful.com in a desktop browser.
2. Open DevTools → Network tab, refresh the page.
3. Find a request to `api.partiful.com` (e.g. `getMutuals`).
4. Copy the `Authorization` header value, minus the `Bearer ` prefix.
5. Export it for the session: `export PARTIFUL_AUTH_TOKEN='<token>'`

The token is a session token and **expires periodically (~1h)**. On a 401,
grab a fresh one. Never commit it, never save it to files or memory.

**Planned durable path (not yet implemented):** her Firebase **refresh token**
(grabbed once from IndexedDB `firebaseLocalStorageDb` in the same DevTools
session) via the secret-entry flow into env only (`PARTIFUL_REFRESH_TOKEN`);
the CLI exchanges it at Google's Secure Token endpoint — which **requires**
`Referer: https://partiful.com/` or Google returns 403 — caches the JWT in
memory only, retries once on 401/403, then asks her to re-auth on refresh
failure. This removes the hourly DevTools re-grab and is required before any
write action is usable.

## Endpoints the npm package wraps (old host)

| Method | Args | Returns |
|---|---|---|
| `getEvent(eventId)` | broken (cheerio interop) — the CLI scrapes the public page instead | `{id, name, startDateTime, url}` — no token needed; private events return empty |
| `getMutuals()` | — | JSON list of the user's mutuals |
| `getUsers(ids)` | array of user ids | JSON user data |
| `getInvitableContacts(eventId, skip, limit)` | event id, paging | JSON contacts invitable to the event |
| `getGuestsCsv(eventId, statuses, questionnaire)` | event id; statuses default to all six; questionnaire bool | CSV text of the guest list |

## Hard limitations

- **Read-only.** Creating, editing, or deleting events goes through
  Partiful's Firebase directly and is not reverse-engineered. RSVP change and
  invite-send have no confirmed endpoint (bundle candidates exist, shapes
  unverified). The skill cannot create events, change RSVPs, or send invites.
- **Unofficial.** Endpoints can change or break without notice (a host
  migration and two method renames already happened); keep calls minimal and
  treat failures as "Partiful changed something". Pin endpoint names/param
  shapes to observed bundle versions and re-verify before each build milestone.
- **ToS gray area.** This uses the user's own session token against
  undocumented endpoints. Fine for her personal use; don't build a commercial
  product on it without talking to Partiful.

## Discovery method for unverified endpoints

Download Partiful's public Next.js bundles (static assets, no login needed),
grep for the candidate function name as a string literal, read the surrounding
fetch-wrapper call site to get the exact `params` shape. Never guess from
naming convention — two guesses already 404'd. Then confirm with ONE live call
against her account before documenting as supported.
