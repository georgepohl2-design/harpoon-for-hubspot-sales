// Harpoon's rules, in one place: tile colours, hot/cold, money, the Slack notification, the schedule.
// Used by the board page and by the background scheduler.

export const CAP = 100;
export const HARPOON_LINK = 'https://georgepohl2-design.github.io/harpoon/open/';
export const DEFAULT_STAGES = ['Discovery', 'Demo booked', 'Proposal', 'Negotiation', 'Closed won'];

export const LABEL = { won: 'Won', amber: 'Being contacted', red: 'Not contacted', grey: 'Not linked' };

export const LIFECYCLE = {
  subscriber: 'Subscriber', lead: 'Lead', marketingqualifiedlead: 'MQL', salesqualifiedlead: 'SQL',
  opportunity: 'Opportunity', customer: 'Customer', evangelist: 'Evangelist', other: 'Other'
};

/**
 * The colour rules (George's red/amber/green):
 *   grey  = not matched to a HubSpot company yet
 *   green = a customer, or has a closed-won deal
 *   red   = nobody owns it, or it has an owner but nothing is logged
 *   amber = has an owner and at least one logged email, call or meeting
 */
export function classify(a) {
  if (a.unlinked) return { s: 'grey', why: null };
  if (a.won) return { s: 'won', why: null };
  if (!a.owner) return { s: 'red', why: 'noowner' };
  if ((a.t || 0) > 0 || a.last != null) return { s: 'amber', why: null };
  return { s: 'red', why: 'nocontact' };
}

/** 'hot' | 'cold' | '' for amber accounts. */
export function heat(a, S) {
  if (a.s !== 'amber') return '';
  if (a.last != null && a.last >= S.coldDays) return 'cold';
  if (a.t != null && a.t >= S.hotTouches && a.last != null && a.last <= S.hotDays) return 'hot';
  return '';
}

export function money(n, cur = '£') {
  if (n == null || isNaN(n)) return '';
  if (n >= 1000) return cur + (n / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + 'k';
  return cur + Math.round(n).toLocaleString('en-GB');
}

export function moneyFull(n, cur = '£') {
  if (n == null || isNaN(n)) return '';
  return cur + Math.round(n).toLocaleString('en-GB');
}

export const ago = d => d == null ? 'never' : d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;

export const daysSince = ts => ts ? Math.max(0, Math.floor((Date.now() - ts) / 86400000)) : null;

export function shortName(first, last, email) {
  const f = (first || '').trim(), l = (last || '').trim();
  if (f && l) return `${f} ${l[0]}.`;
  if (f || l) return f || l;
  return email ? email.split('@')[0] : 'Someone';
}

// ---------- the Slack notification ----------

/**
 * Builds the notification as data, so it can be shown on the board (preview)
 * and sent to Slack (mrkdwn) from the same source.
 * full = true adds "Who's doing what" (the weekly / on-demand version).
 * S.hunting = 'solo' is the personal version, for one SDR, BDR or AE: no crew list, no @-mentions,
 * and a pipeline / won line to bring to 1:1s and pipeline meetings.
 */
export function buildRundown(accounts, S, { full = true, demo = false } = {}) {
  // accounts arrive in priority order: #1 is the most important whale
  accounts = accounts.map((a, i) => ({ ...a, rank: i + 1 }));
  const linked = accounts.filter(a => a.s !== 'grey');
  const count = s => accounts.filter(a => a.s === s).length;
  const hot = accounts.filter(a => heat(a, S) === 'hot').map(a => a.name);
  const cold = accounts.filter(a => heat(a, S) === 'cold').map(a => a.name);

  // who's doing what: one bullet per owner, the unowned as one bullet, never more than 5
  const owners = {};
  linked.forEach(a => {
    const o = a.owner || '';
    (owners[o] ||= { won: 0, amber: 0, red: 0, list: [] });
    owners[o][a.s]++; owners[o].list.push(a);
  });
  const named = Object.keys(owners).filter(Boolean)
    .sort((x, y) => owners[y].list.length - owners[x].list.length || x.localeCompare(y));
  const unowned = (owners[''] || { list: [] }).list.map(a => a.name);
  const crew = named.slice(0, unowned.length ? 4 : 5).map(o => {
    const x = owners[o], bits = [];
    if (x.amber) bits.push(`working ${x.amber}`);
    if (x.won) bits.push(`won ${x.won}`);
    if (x.red) bits.push(`${x.red} not contacted yet`);
    const big = x.list.filter(a => a.s === 'amber' && a.deal && a.deal.amount).sort((p, q) => q.deal.amount - p.deal.amount)[0];
    return { owner: o, text: bits.join(', '), biggest: big ? `${big.name}, ${money(big.deal.amount, S.currency)} in ${big.deal.stage}` : '' };
  });
  if (unowned.length) crew.push({ owner: '', text: unowned.join(', '), biggest: '' });

  // next to hunt: the most important whale (lowest number) that nobody has contacted, nobody owns, or is getting cold
  let next = null;
  const pick = accounts.find(a => a.s === 'red' || heat(a, S) === 'cold');
  if (pick && pick.s === 'red' && pick.why === 'nocontact') next = { rank: pick.rank, name: pick.name, reason: 'Owned but never contacted.', owner: pick.owner, action: 'time to make first contact.' };
  else if (pick && pick.s === 'red') next = { rank: pick.rank, name: pick.name, reason: 'Nobody owns it yet.', owner: '', action: 'Who wants it?' };
  else if (pick) next = { rank: pick.rank, name: pick.name, reason: `${pick.last} days since the last touch.`, owner: pick.owner, action: 'time to throw a line.' };

  const solo = S.hunting === 'solo';
  const pipe = accounts.filter(a => a.s === 'amber' && a.deal).reduce((n, a) => n + (a.deal.amount || 0), 0);
  const wonAmt = accounts.filter(a => a.s === 'won' && a.won).reduce((n, a) => n + (a.won.amount || 0), 0);
  if (solo && next) { next.owner = ''; next.action = next.action.charAt(0).toUpperCase() + next.action.slice(1); }

  return {
    demo, full, solo,
    pipe: money(pipe, S.currency) || S.currency + '0', wonAmt: money(wonAmt, S.currency) || S.currency + '0',
    total: accounts.length, won: count('won'), amber: count('amber'), red: count('red'), grey: count('grey'),
    hot, cold, crew: full && !solo ? crew : [], next
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function rundownToSlack(r, S) {
  const L = [];
  L.push(`:whale: *${r.solo ? 'Ahoy Captain! Your whales to hunt' : 'Ahoy crew! Whales to hunt'}: ${r.total}*${r.demo ? '  _(demo data)_' : ''}`);
  L.push(`:large_green_circle: ${r.won} won / :large_orange_circle: ${r.amber} being contacted / :red_circle: ${r.red} not contacted so far`);
  if (r.solo) L.push(`:moneybag: Open pipeline ${r.pipe} · Won ${r.wonAmt}`);
  if (r.hot.length) L.push(`:fire: Hot: ${esc(r.hot.join(', '))}`);
  if (r.cold.length) L.push(`:cold_face: Getting cold: ${esc(r.cold.join(', '))}`);
  if (r.crew.length) {
    L.push('', "*Who's doing what*");
    r.crew.forEach(c => L.push(c.owner
      ? `• *${esc(c.owner)}*: ${esc(c.text)}${c.biggest ? ` · biggest: ${esc(c.biggest)}` : ''}`
      : `• :scream: *No owner*: ${esc(c.text)}`));
  }
  if (r.next) {
    const id = r.next.owner && S.mentions && S.slackIds && S.slackIds[r.next.owner];
    const who = r.next.owner ? (id ? `<@${id}>` : `@${esc(r.next.owner)}`) + ' ' : '';
    L.push('', `:dart: *${r.solo ? 'Next up' : 'Next to hunt'}:* #${r.next.rank} ${esc(r.next.name)}. ${esc(r.next.reason)} ${who}${esc(r.next.action)}`);
  }
  L.push('', `<${HARPOON_LINK}|Open the target account list in Harpoon →>`);
  return L.join('\n');
}

export function rundownToHTML(r) {
  const e = esc;
  let h = `<div>🐋 <b>${r.solo ? 'Ahoy Captain! Your whales to hunt' : 'Ahoy crew! Whales to hunt'}: ${r.total}</b>${r.demo ? ' <i>(demo data)</i>' : ''}<br>🟢 ${r.won} won / 🟠 ${r.amber} being contacted / 🔴 ${r.red} not contacted so far${r.solo ? `<br>💰 Open pipeline ${e(r.pipe)} · Won ${e(r.wonAmt)}` : ''}</div>`;
  if (r.hot.length || r.cold.length) h += `<div>${r.hot.length ? `🔥 Hot: ${e(r.hot.join(', '))}` : ''}${r.hot.length && r.cold.length ? '<br>' : ''}${r.cold.length ? `🥶 Getting cold: ${e(r.cold.join(', '))}` : ''}</div>`;
  if (r.crew.length) h += `<div><b>Who's doing what</b><ul>${r.crew.map(c => c.owner
    ? `<li><b>${e(c.owner)}</b>: ${e(c.text)}${c.biggest ? ` · biggest: ${e(c.biggest)}` : ''}</li>`
    : `<li><b>😱 No owner</b>: ${e(c.text)}</li>`).join('')}</ul></div>`;
  if (r.next) h += `<div>🎯 <b>${r.solo ? 'Next up' : 'Next to hunt'}:</b> #${r.next.rank} ${e(r.next.name)}. ${e(r.next.reason)} ${r.next.owner ? `<span class="mention">@${e(r.next.owner)}</span> ` : ''}${e(r.next.action)}</div>`;
  h += `<div><a href="${HARPOON_LINK}" target="_blank" rel="noopener">Open the target account list in Harpoon →</a></div>`;
  return h;
}

// ---------- the schedule ----------

/** Next send time (ms) for 'daily' (Mon–Fri) or 'weekly' (Mondays) at schedule.time, after `from`. */
export function nextDue(schedule, from = Date.now()) {
  if (!schedule || schedule.freq === 'off') return null;
  const [hh, mm] = String(schedule.time || '09:00').split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(hh || 0, mm || 0, 0, 0);
    const wd = d.getDay(); // 0 Sun .. 6 Sat
    const ok = schedule.freq === 'daily' ? (wd >= 1 && wd <= 5) : wd === 1;
    if (ok && d.getTime() > from) return d.getTime();
  }
  return null;
}

export function scheduleLabel(schedule) {
  if (!schedule || schedule.freq === 'off') return 'Off';
  return schedule.freq === 'daily' ? `Every weekday, ${schedule.time}` : `Every Monday, ${schedule.time}`;
}

// ---------- what changed: the toolbar badge and the tag on a tile ----------
// A whale "changes" when its colour changes (won / being contacted / not contacted / not linked),
// it heats up 🔥 or gets cold 🥶, or its deal moves to another stage.
// Changes stay until you've seen them (hover the tile, or "Mark all seen").

export const stateOf = (a, S) => ({ s: a.s, h: heat(a, S) || '', d: a.s === 'amber' && a.deal ? a.deal.stage : '' });
const same = (x, y) => x && y && x.s === y.s && x.h === y.h && (x.d || '') === (y.d || '');

/**
 * Compares the whales now with what Harpoon last saw.
 * watch = { seen: { key: {s, h, d} }, changes: { key: { from, to, at } } }. Returns the new watch.
 * A whale seen for the first time is just remembered, so adding 100 whales doesn't light up 100 tags.
 */
export function trackChanges(accounts, watch = {}, S, now = Date.now()) {
  const seen = { ...(watch.seen || {}) }, changes = { ...(watch.changes || {}) };
  const keys = new Set(accounts.map(a => a.key));
  for (const a of accounts) {
    const cur = stateOf(a, S), prev = seen[a.key];
    seen[a.key] = cur;
    if (!prev) continue;
    if (prev.d === undefined) prev.d = cur.d; // remembered before Harpoon tracked deal stages: don't call that a move
    if (same(prev, cur)) continue;
    const moved = cur.s === 'amber' && prev.s === 'amber' && cur.d && prev.d !== cur.d;
    const worthIt = prev.s !== cur.s || (cur.h && cur.h !== prev.h) || moved; // cooling back to normal isn't news
    if (!worthIt) continue;
    const from = changes[a.key] ? changes[a.key].from : prev;
    if (same(from, cur)) delete changes[a.key]; // changed and changed back: nothing to tell
    else changes[a.key] = { from, to: cur, at: now };
  }
  Object.keys(seen).forEach(k => { if (!keys.has(k)) delete seen[k]; });
  Object.keys(changes).forEach(k => { if (!keys.has(k)) delete changes[k]; });
  return { seen, changes };
}

/** What kind of change it is, most important first. */
export function changeKind(c) {
  if (!c) return '';
  const { from, to } = c;
  if (to.s === 'won' && from.s !== 'won') return 'won';
  if (from.s === 'red' && to.s === 'amber') return 'contacted';
  if (from.s !== to.s) return to.s === 'red' ? 'uncontacted' : to.s === 'grey' ? 'unlinked' : 'contacted';
  if (to.h === 'hot' && from.h !== 'hot') return 'hot';
  if (to.h === 'cold' && from.h !== 'cold') return 'cold';
  if (to.d && from.d !== to.d) return 'stage';
  return 'changed';
}

/** The short label on the tile's tag. */
export function changeTag(c) {
  const k = changeKind(c);
  return { won: '🏆 Deal won!', contacted: '👋 First contact', uncontacted: 'Not contacted', unlinked: 'Unlinked',
    hot: '🔥 Heating up', cold: '🥶 Getting cold', stage: `Moved to ${c && c.to.d}`, changed: 'Changed' }[k] || '';
}

/** The fuller line in the hover card. */
export function describeChange(c, a, cur = '£') {
  const k = changeKind(c);
  if (!k) return '';
  const { from, to } = c;
  if (k === 'won') return `🏆 Deal won${a && a.won && a.won.amount ? ': ' + money(a.won.amount, cur) : ''}! Harpoon struck true.`;
  if (k === 'contacted') return from.s === 'red' ? '👋 First contact made: now being contacted' : `Now ${LABEL[to.s].toLowerCase()}`;
  if (k === 'uncontacted') return 'Back to not contacted';
  if (k === 'unlinked') return 'No longer linked to HubSpot';
  if (k === 'hot') return '🔥 Heating up: lots of contact lately';
  if (k === 'cold') return `🥶 Getting cold${a && a.last != null ? `: ${a.last} days since the last touch` : ''}`;
  if (k === 'stage') return `Moved to ${to.d}${from.d ? ` (from ${from.d})` : ''}`;
  return 'Changed';
}
