// Demo mode: eight made-up whales (Moby Dick, then Whale B to Whale H, matching their starting rank) and made-up people, so anyone can try Harpoon without HubSpot.
// Every name here is invented. Any likeness to a real company is a coincidence.

import { classify, DEFAULT_STAGES } from './model.js';

const DAY = 86400000;

// e/c/m = emails, calls, meetings logged; last = days since the last touch
const BASE = [
  { name: 'Moby Dick', owner: 'Priya N.', life: 'Opportunity', e: 5, c: 1, m: 1, last: 3, deal: [61000, 'Negotiation'] },
  { name: 'Whale B', owner: 'Tom B.', life: 'Customer', won: ['2026-02-14', 120000] },
  { name: 'Whale C', owner: 'Jess R.', life: 'SQL', e: 6, c: 2, m: 1, last: 8, deal: [40000, 'Demo booked'] },  // hot
  { name: 'Whale D', owner: 'Tom B.', life: 'Lead' },                                                          // owned, never contacted
  { name: 'Whale E', owner: null, life: 'Lead' },                                                              // nobody owns it
  { name: 'Whale F', owner: 'Priya N.', life: 'SQL', e: 2, c: 0, m: 0, last: 4, deal: [18000, 'Discovery'] },
  { name: 'Whale G', owner: 'Sam K.', life: 'Customer', won: ['2026-11-03', 32000] },
  { name: 'Whale H', owner: 'Jess R.', life: 'Lead', e: 1, c: 0, m: 0, last: 33 }                             // getting cold
];

// Extra made-up "HubSpot" companies, so adding and linking accounts works in the demo.
const EXTRA = [
  { name: 'Whale I', owner: 'Jess R.', life: 'MQL', e: 2, c: 1, m: 0, last: 9 },
  { name: 'Whale J Ltd', owner: 'Tom B.', life: 'Lead' },
  { name: 'Whale J Inc', owner: null, life: 'Lead' },
  { name: 'Whale K', owner: null, life: 'Lead' }
];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function build(r, i) {
  const a = {
    key: r.unlinked ? 'u:' + r.name : 'demo:' + slug(r.name),
    id: r.unlinked ? null : 'demo-' + slug(r.name),
    name: r.name,
    domain: r.unlinked ? '' : slug(r.name) + '.example',
    url: null,
    unlinked: !!r.unlinked,
    owner: r.owner || null,
    life: r.life || '',
    e: r.e || 0, c: r.c || 0, m: r.m || 0,
    last: r.last ?? null,
    deal: null, won: null, log: []
  };
  a.t = a.e + a.c + a.m;
  if (r.deal) {
    const idx = DEFAULT_STAGES.indexOf(r.deal[1]);
    a.deal = { amount: r.deal[0], stage: r.deal[1], stages: DEFAULT_STAGES, idx };
  }
  if (r.won) a.won = { date: new Date(r.won[0]).getTime(), amount: r.won[1], stages: DEFAULT_STAGES };
  // a believable touch log, newest first, built from the counts
  if (a.t) {
    let e = a.e, c = a.c, m = a.m; const types = [];
    while (e + c + m > 0) { if (m) { types.push('meeting'); m--; } if (c) { types.push('call'); c--; } if (e) { types.push('email'); e--; } }
    let d = a.last;
    types.forEach((type, j) => { a.log.push({ type, who: a.owner, ts: Date.now() - d * DAY }); d += 3 + (j * 5) % 7; });
  }
  Object.assign(a, classify(a));
  return a;
}

export const DEMO_BASE = BASE.map(build);
export const DEMO_DIRECTORY = BASE.filter(r => !r.unlinked).concat(EXTRA).map(build);

// The demo's priority order: #1 is the most important whale.
const PRIORITY = ['Moby Dick', 'Whale B', 'Whale C', 'Whale D', 'Whale E', 'Whale F', 'Whale G', 'Whale H'];
const DEFAULT_ORDER = PRIORITY.map(n => DEMO_BASE.find(a => a.name === n).key);

/**
 * The demo board, in priority order: the base list, minus anything thrown back,
 * plus anything added or linked. `origKey` remembers a linked account's place in the order.
 */
export function demoAccounts(state = {}) {
  const removed = new Set(state.removed || []);
  const links = state.links || {};
  const list = DEMO_BASE.filter(a => !removed.has(a.key)).map(a => {
    if (a.unlinked && links[a.key]) {
      const hit = DEMO_DIRECTORY.find(d => d.key === links[a.key]);
      if (hit) return { ...hit, origKey: a.key };
    }
    return a;
  });
  (state.added || []).forEach(k => {
    if (list.some(a => a.key === k)) return;
    const hit = DEMO_DIRECTORY.find(d => d.key === k);
    if (hit) list.push({ ...hit });
    else if (k.startsWith('u:')) list.push(build({ name: k.slice(2), unlinked: true }));
  });
  // an order saved before the demo whales were renamed won't match any of them: fall back to the default
  const order = (state.order && state.order.some(k => DEFAULT_ORDER.includes(k))) ? state.order : DEFAULT_ORDER.concat(state.added || []);
  const pos = a => { const i = order.indexOf(a.origKey || a.key); return i < 0 ? 1e6 + list.indexOf(a) : i; };
  return list.slice().sort((x, y) => pos(x) - pos(y));
}

const norm = s => s.toLowerCase().replace(/\b(ltd|limited|inc|llc|plc|gmbh|group)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

/** Demo version of "find this company in HubSpot". */
export async function demoSearch(raw) {
  const s = raw.trim();
  let hits;
  if (/\./.test(s) && !/\s/.test(s)) {
    const d = s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    hits = DEMO_DIRECTORY.filter(x => x.domain === d);
  } else {
    const n = norm(s);
    hits = DEMO_DIRECTORY.filter(x => norm(x.name) === n);
    if (!hits.length && n.length >= 4) hits = DEMO_DIRECTORY.filter(x => norm(x.name).startsWith(n) || n.startsWith(norm(x.name)));
  }
  return hits.map(h => ({ id: h.id, key: h.key, name: h.name, domain: h.domain, owner: h.owner }));
}

export async function demoTargetAccounts() {
  return ['Whale I', 'Whale J Ltd', 'Whale K'].map(n => DEMO_DIRECTORY.find(d => d.name === n))
    .map(h => ({ id: h.id, key: h.key, name: h.name, domain: h.domain, owner: h.owner }));
}

// A few made-up changes, so the demo shows the toolbar badge and the dots on tiles.
// Each says what the whale looked like before. Seen ones are remembered in the demo state.
const HOUR = 3600000;
const DEMO_CHANGES = [
  ['Whale G', { s: 'amber', h: '' }, 5],                        // won
  ['Whale C', { s: 'amber', h: '' }, 20],                       // heating up
  ['Whale F', { s: 'red', h: '' }, 26],                         // first contact made
  ['Whale H', { s: 'amber', h: '' }, 50],                       // getting cold
  ['Moby Dick', { s: 'amber', h: '', d: 'Proposal' }, 30]       // deal moved to Negotiation
];
export function demoWatch(accounts, state = {}, stateOf) {
  const seenKeys = new Set(state.seenChanges || []);
  const changes = {};
  DEMO_CHANGES.forEach(([name, from, hoursAgo]) => {
    const a = accounts.find(x => x.name === name);
    if (!a || seenKeys.has(a.key)) return;
    changes[a.key] = { from, to: stateOf(a), at: Date.now() - hoursAgo * HOUR };
  });
  return { seen: {}, changes };
}
