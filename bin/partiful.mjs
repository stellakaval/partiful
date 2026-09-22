#!/usr/bin/env node
// partiful CLI — read-only access to the user's Partiful data.
//
// Two transport layers (Partiful migrated backends; the npm package did not):
//   1. The community `partiful-api` npm package → OLD host
//      https://us-central1-getpartiful.cloudfunctions.net/<method>
//      (commands: guests, invitable, mutuals, users)
//   2. Direct fetch → NEW host https://api.partiful.com/<method>
//      (command: rsvps — via community-confirmed getMyRsvps)
//      Envelope: {"data": {"params": {...}, "userId": "<firebase-uid>"}},
//      payload nests at .result.data. Firebase uid decoded from the JWT.
//
// Auth: bearer token via PARTIFUL_AUTH_TOKEN env var (grabbed from the user's
// own Partiful web session; see references/api.md). Never persist the token.
// `event` needs no token (public page scrape).
import PartifulApi from 'partiful-api';
import * as cheerio from 'cheerio';

const P = PartifulApi?.default ?? PartifulApi;
const NEW_HOST = 'https://api.partiful.com';

function usage() {
  console.error(`usage:
  partiful event <eventId>                      # event name + start time (public page, no token needed)
  partiful rsvps [--summary]                    # events she's invited to + her RSVP status
  partiful guests <eventId> [--statuses A,B] [--no-questionnaire] [--summary]
  partiful invitable <eventId> [--skip N] [--limit N]
  partiful mutuals
  partiful users <id> [id...]

Event IDs come from partiful.com/e/<eventId> URLs.
Auth token: set PARTIFUL_AUTH_TOKEN (not needed for 'event').
All output is JSON except raw guest CSV.`);
  process.exit(2);
}

function needToken() {
  const t = process.env.PARTIFUL_AUTH_TOKEN;
  if (!t) {
    console.error('error: PARTIFUL_AUTH_TOKEN is not set. See references/api.md for how to grab it from your Partiful session.');
    process.exit(2);
  }
  return t;
}

function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function boolFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

// Read the firebase uid from the JWT payload (base64url) — no verification,
// just reading her own token's claims. Needed for the new-host envelope.
function decodeUserId(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return claims.sub ?? claims.user_id ?? null;
  } catch {
    return null;
  }
}

// POST to the new Partiful host. `method` is a community-confirmed Cloud
// Function name (see references/api.md). Do not call guessed names — two
// earlier guesses 404'd in production.
async function postNewHost(method, params) {
  const token = needToken();
  const userId = decodeUserId(token);
  if (!userId) {
    console.error('error: could not read the user id from the token (expected a Firebase JWT). Grab a fresh token and retry.');
    process.exit(2);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${NEW_HOST}/${method}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Origin': 'https://partiful.com',
        'Referer': 'https://partiful.com/',
      },
      body: JSON.stringify({ data: { params, userId } }),
    });
    if (res.status === 401 || res.status === 403) {
      console.error('error: Partiful rejected the token (401/403). The session token expired — grab a fresh one (see references/api.md) and retry once.');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`error: Partiful returned ${res.status}. The endpoint may have moved — see references/api.md.`);
      process.exit(1);
    }
    const body = await res.json();
    return body?.result?.data ?? body?.data ?? body;
  } finally {
    clearTimeout(timer);
  }
}

// minimal CSV parse (handles quoted commas) for --summary
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === 'event') {
    const [eventId] = rest;
    if (!eventId) usage();
    // NOTE: partiful-api's own getEvent is broken (cheerio interop), so we do
    // the public-page scrape here directly. No auth needed.
    const url = `https://partiful.com/e/${eventId}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      });
      if (!res.ok) {
        console.log(JSON.stringify({ id: eventId, url, error: `page returned ${res.status} (event may be private or the id wrong)` }));
        process.exit(0);
      }
      const $ = cheerio.load(await res.text());
      const name = $('h1 span').first().text().trim();
      const dateTime = $('time').attr('datetime') || null;
      console.log(JSON.stringify({
        id: eventId,
        name: name || null,
        startDateTime: dateTime ? new Date(dateTime).toISOString() : null,
        url,
      }, null, 2));
    } finally {
      clearTimeout(timer);
    }
  } else if (cmd === 'rsvps') {
    // NEW (2026-09-22): all events she's invited to / RSVP'd to, with her RSVP
    // status on each — via getMyRsvps on the new host. Community-confirmed
    // (July 2026, called against a real account) but NOT yet run against her
    // account — the first live run verifies it.
    const summary = boolFlag(rest, '--summary');
    const data = await postNewHost('getMyRsvps', {});
    const events = Array.isArray(data) ? data : [];
    if (summary) {
      console.log(JSON.stringify({
        count: events.length,
        events: events.map((e) => ({
          id: e.id ?? e.eventId ?? null,
          title: e.title ?? e.name ?? null,
          start: e.startDate ?? e.startDateTime ?? null,
          rsvp: e.rsvpStatus ?? e.myRsvpStatus ?? e.status ?? null,
        })),
      }, null, 2));
    } else {
      console.log(JSON.stringify(events, null, 2));
    }
  } else if (cmd === 'guests') {
    const token = needToken();
    const summary = boolFlag(rest, '--summary');
    const noQ = boolFlag(rest, '--no-questionnaire');
    const statuses = flag(rest, '--statuses', null);
    const [eventId] = rest;
    if (!eventId) usage();
    const api = new P(token);
    const csv = await api.getGuestsCsv(
      eventId,
      statuses ? statuses.split(',').map(s => s.trim().toUpperCase()) : undefined,
      !noQ,
    );
    if (!summary) { process.stdout.write(csv.endsWith('\n') ? csv : csv + '\n'); process.exit(0); }
    const rows = parseCsv(csv);
    const headers = rows[0] ?? [];
    const statusCol = headers.findIndex(h => /status|rsvp/i.test(h));
    const counts = {};
    for (const r of rows.slice(1)) {
      const k = statusCol >= 0 ? (r[statusCol] || 'unknown') : 'row';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    console.log(JSON.stringify({ eventId, guests: rows.length - 1, columns: headers, byStatus: counts }, null, 2));
  } else if (cmd === 'invitable') {
    const token = needToken();
    const skip = parseInt(flag(rest, '--skip', '0'), 10);
    const limit = parseInt(flag(rest, '--limit', '100'), 10);
    const [eventId] = rest;
    if (!eventId) usage();
    const api = new P(token);
    console.log(JSON.stringify(await api.getInvitableContacts(eventId, skip, limit), null, 2));
  } else if (cmd === 'mutuals') {
    const api = new P(needToken());
    console.log(JSON.stringify(await api.getMutuals(), null, 2));
  } else if (cmd === 'users') {
    if (!rest.length) usage();
    const api = new P(needToken());
    console.log(JSON.stringify(await api.getUsers(rest), null, 2));
  } else {
    usage();
  }
} catch (e) {
  const msg = e?.message ?? String(e);
  if (/401|unauthorized/i.test(msg)) {
    console.error('error: Partiful rejected the token (401). The session token expired — grab a fresh one (see references/api.md) and retry.');
  } else {
    console.error('error:', msg);
  }
  process.exit(1);
}
