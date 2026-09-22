# partiful

A [Muse](https://muse.ai) skill that works with your Partiful data: your invitations and RSVP statuses, event details, guest lists with RSVP counts, contacts you can invite, and your mutuals.

Partiful has **no public API**, so this skill talks to Partiful's own backend through community reverse-engineering (the [`partiful-api`](https://github.com/cerebral-valley/partiful-api) npm package plus direct calls to the newer backend). It is **read-only**.

## Install

Requires Node.js 18+.

```bash
npm install   # in this directory
```

## Auth

Everything except public event lookup needs your own Partiful session token in the `PARTIFUL_AUTH_TOKEN` env var.

1. Log in at [partiful.com](https://partiful.com) in a desktop browser.
2. Open DevTools (Network tab) and refresh the page.
3. Find a request to `api.partiful.com` and copy the `Authorization` header value, dropping the `Bearer ` prefix.
4. `export PARTIFUL_AUTH_TOKEN='<token>'`

The token is a session token and expires periodically. On a 401, grab a fresh one. Never commit it, never write it to files.

## Usage

Run from this directory so `node_modules` resolves. All output is JSON except raw guest CSV.

```bash
node bin/partiful.mjs event <eventId>                        # name + start time; no token needed
node bin/partiful.mjs rsvps [--summary]                      # your invitations + RSVP statuses
node bin/partiful.mjs guests <eventId> [--summary] [--statuses GOING,MAYBE] [--no-questionnaire]
node bin/partiful.mjs invitable <eventId> [--skip N] [--limit N]  # contacts you can invite
node bin/partiful.mjs mutuals                                # your mutuals
node bin/partiful.mjs users <id> [id...]                     # user details
```

Event IDs come from `partiful.com/e/<eventId>` URLs. The `event` command scrapes the public page, so private events return empty results; that means the event is private or the id is wrong, not a bug.

## Hard limits

- **Read-only.** Creating or editing events, changing RSVPs, and sending invites are not supported. Those paths go through Partiful's Firebase directly and have not been reverse-engineered.
- **Unofficial.** Endpoints can change or break without notice. Keep calls minimal and treat failures as "Partiful changed something" rather than debugging deeply.
- **Personal use only.** This uses your own session token against undocumented endpoints. Do not build a commercial product on it.

## How it works

Partiful migrated backends without publishing an API, so the skill uses two transports: the community `partiful-api` npm package against the old cloud-functions host, and direct fetch against the newer `api.partiful.com` host with the documented envelope. See [`references/api.md`](references/api.md) for the endpoint table and transport details, and [`SKILL.md`](SKILL.md) for the full agent-facing spec.
