// Harpoon board page.
import * as store from './lib/store.js';
import { IS_EXT } from './lib/store.js';
import { logoSVG } from './lib/logo.js';
import { demoAccounts, demoSearch, demoTargetAccounts, demoWatch } from './lib/demo.js';
import { CAP, LABEL, heat, money, moneyFull, ago, daysSince, buildRundown, rundownToHTML, rundownToSlack, nextDue, scheduleLabel, trackChanges, describeChange, changeTag, changeKind, stateOf } from './lib/model.js';
import * as hubspot from './lib/hubspot.js';
import { sendSlack } from './lib/slack.js';
import { drawSnapshot, snapshotBlob } from './lib/snapshot.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGT = { email: '✉️ Email', call: '📞 Call', meeting: '🤝 Meeting' };
const HEAT = { hot: '🔥', cold: '🥶', '': '' };
const REPO = 'https://github.com/georgepohl2-design/harpoon';

let S;                 // settings
let mode = 'demo';     // 'demo' | 'live'
let accounts = [];
let targets = [];      // live: [{ key, id, name }]
let demoState = {};    // demo: { removed, added, links }
let warnings = [], errorMsg = '', lastUpdated = null, refreshing = false, notifyState = {};
let filter = 'all', query = '';
let watch = { seen: {}, changes: {} }; // what changed since you last looked (see trackChanges)

// ---------- start ----------
init();

async function init() {
  S = await store.loadSettings();
  document.body.dataset.skin = S.skin;
  paintLogos();
  bind();
  await load();
  render();
  if (mode === 'live') refresh();
  if (IS_EXT && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.notify) { notifyState = ch.notify.newValue || {}; renderBanners(); }
      if (ch.watch && mode === 'live') { watch = ch.watch.newValue || { seen: {}, changes: {} }; render(); } // the hourly background check found something
    });
  }
}

function paintLogos() {
  document.querySelectorAll('.js-logo').forEach(el => { el.innerHTML = logoSVG(false, 'aria-hidden="true"'); });
}

async function load() {
  ({ notify: notifyState = {} } = await store.get('notify'));
  if (S.token && IS_EXT) {
    mode = 'live';
    ({ targets = [] } = await store.get('targets'));
    const { cache } = await store.get('cache');
    if (cache && cache.accounts) {
      const byKey = Object.fromEntries(cache.accounts.map(a => [a.key, a]));
      accounts = targets.map(t => byKey[t.key]).filter(Boolean);
      warnings = cache.warnings || []; lastUpdated = cache.at;
    } else accounts = [];
    ({ watch = { seen: {}, changes: {} } } = await store.get('watch'));
    if (accounts.length && !Object.keys(watch.seen || {}).length) { watch = trackChanges(accounts, {}, S); await store.set({ watch }); }
  } else {
    mode = 'demo';
    ({ demo: demoState = {} } = await store.get('demo'));
    accounts = demoAccounts(demoState);
    watch = demoWatch(accounts, demoState, a => stateOf(a, S));
    lastUpdated = Date.now();
  }
}

async function refresh() {
  if (mode !== 'live' || refreshing) return;
  refreshing = true; errorMsg = ''; renderStatus();
  try {
    const r = await hubspot.refresh(S.token, targets);
    accounts = r.accounts; warnings = r.warnings; lastUpdated = Date.now();
    const { watch: stored } = await store.get('watch');
    watch = trackChanges(accounts, stored || watch, S);
    await store.set({ cache: { at: lastUpdated, accounts, warnings, portal: r.portal }, watch });
  } catch (e) {
    errorMsg = e.message || String(e);
  } finally {
    refreshing = false;
    render();
    badge();
  }
}

function badge() {
  if (!IS_EXT) return;
  try { chrome.runtime.sendMessage({ type: 'badge', count: Object.keys(watch.changes || {}).length }); } catch { /* ignore */ }
}

// You've seen what changed on this whale: drop its dot, and take it off the toolbar count.
async function markSeen(keys) {
  keys = [].concat(keys).filter(k => watch.changes && watch.changes[k]);
  if (!keys.length) return;
  if (mode === 'demo') { demoState.seenChanges = [...new Set([...(demoState.seenChanges || []), ...keys])]; await saveDemo(); }
  else { keys.forEach(k => delete watch.changes[k]); await store.set({ watch }); }
  keys.forEach(k => { const tw = document.querySelector(`.tw[data-key="${CSS.escape(k)}"] .chg`); if (tw) tw.remove(); });
  renderBanners(); badge();
}

async function saveDemo() { await store.set({ demo: demoState }); accounts = demoAccounts(demoState); watch = demoWatch(accounts, demoState, a => stateOf(a, S)); }
async function saveTargets() { await store.set({ targets }); }
async function saveS() { await store.saveSettings(S); }

// ---------- render ----------
function render() {
  accounts.forEach((a, i) => { a.rank = i + 1; }); // the list order is the priority order: #1 matters most
  renderOnboard();
  renderBanners();
  renderStats();
  renderBoard();
  renderLog();
  renderStatus();
  $('legend').textContent = `🔥 Hot: ${S.hotTouches}+ touches and a touch in the last ${S.hotDays} days. 🥶 Going cold: no touch for ${S.coldDays}+ days. Change these in Settings.`;
  document.querySelectorAll('#sortSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === (S.sort || 'rank')));
  document.querySelectorAll('#viewSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === S.view));
}

// ---------- welcome, Captain: three steps to get started ----------
function renderOnboard() {
  const el = $('onboard');
  const solo = S.hunting === 'solo';
  const steps = [
    { done: mode === 'live', title: 'Connect your HubSpot CRM', open: 'settings', btn: 'Connect HubSpot',
      text: solo ? "Read-only. Not a HubSpot admin? Ask yours for a read-only token. It takes them 5 minutes."
                 : 'Read-only: Harpoon never changes anything in HubSpot. About 5 minutes.' },
    { done: mode === 'live' && targets.length > 0, title: 'Add your target accounts', open: 'add', btn: 'Add whales',
      text: solo ? "Your own whales: the accounts you're going after. 100 is the limit, but we recommend starting with 20."
                 : 'Whales, we call them. 100 is the limit, but we recommend starting with 20.' },
    solo
      ? { done: (!!S.webhook && S.schedule.freq !== 'off') || !!S.slackSkipped, optional: true, title: 'Set up your Slack recap', open: 'slack', btn: 'Set up Slack',
          text: 'A weekly recap of your whales, pipeline and wins. Send it to yourself, or to a channel your sales manager or CRO reads.' }
      : { done: !!S.webhook && S.schedule.freq !== 'off', title: 'Set up your Slack messages', open: 'slack', btn: 'Set up Slack',
          text: 'Schedule team Slack messages so your commercial, sales and marketing teams stay on top of every whale.' }
  ];
  const n = steps.filter(x => x.done).length;
  const all = n === steps.length;
  // Harpoon doesn't work without these, so there's no skipping: the panel only goes once all three are done and closed
  // (the one exception: the Slack recap is optional when it's just you)
  const hide = (all && S.welcomeHidden) || new URLSearchParams(location.search).has('cover');
  el.hidden = hide;
  if (hide) return;
  const now = steps.findIndex(x => !x.done);
  el.innerHTML = `
    ${all ? '<button class="ob-x" type="button" data-ob="hide">Close</button>' : ''}
    <div class="ob-head">
      <div class="ob-txt">
        <h2>${all ? 'All hands on deck, Captain! 🎉' : 'Welcome to Harpoon, Captain!'}</h2>
        <p>${all ? (solo ? "You're all set. Your whales are on the board, ready for your next pipeline meeting." : "You're all set. Your whales are on the board and the crew gets briefed in Slack.")
                 : `Three steps and you're hunting. It's free.${mode === 'demo' ? ' Until then, these are demo whales (no real whales were harmed).' : ''}`}</p>
        <div class="ob-who" role="group" aria-label="Who is Harpoon for?"><span>Setting up for</span>
          <button type="button" class="chip" data-who="team" aria-pressed="${!solo}">👥 My team</button>
          <button type="button" class="chip" data-who="solo" aria-pressed="${solo}">🙋 Just me (SDR, BDR, AE)</button>
        </div>
      </div>
      <div class="ob-prog"><span>${n} of ${steps.length} done</span><div class="ob-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${n}" aria-label="Getting started"><i style="--p:${Math.round(n / steps.length * 100)}%"></i></div></div>
    </div>
    <ol class="ob-steps">${steps.map((x, i) => `
      <li class="${x.done ? 'done' : i === now ? 'now' : ''}">
        <h3><span class="ob-n">${x.done ? '✓' : i + 1}</span>${x.title}${x.optional ? ' <span class="ob-opt">Optional</span>' : ''}</h3>
        <p>${x.text}</p>
        ${x.done ? `<span class="ok">${x.optional && S.slackSkipped && !S.webhook ? 'Skipped. Add it any time in Settings.' : 'Done'}</span>`
                 : `<div class="ob-acts"><button class="btn small${i === now ? ' primary pulse' : ''}" type="button" data-open="${x.open}">${x.btn}</button>${x.optional ? '<button class="ob-skip" type="button" data-ob="skip">Skip for now</button>' : ''}</div>`}
      </li>`).join('')}
    </ol>`;
  el.querySelectorAll('[data-who]').forEach(b => b.onclick = async () => { S.hunting = b.dataset.who; await saveS(); render(); });
  const skip = el.querySelector('[data-ob="skip"]');
  if (skip) skip.onclick = async () => { S.slackSkipped = true; await saveS(); renderOnboard(); };
  if (all) el.querySelector('[data-ob="hide"]').onclick = async () => {
    S.welcomeHidden = true; await saveS(); renderOnboard(); renderBanners();
    say('Happy hunting, Captain!');
  };
}

function renderBanners() {
  const b = [];
  if (!IS_EXT && !new URLSearchParams(location.search).has('clean')) b.push(`<div class="banner demo">👋 This is the online demo, with made-up companies. Install the Chrome extension to connect your own HubSpot and Slack. <a class="btn small" href="${REPO}#install-it-no-coding-needed-about-5-minutes" target="_blank" rel="noopener">How to install</a></div>`);
  else if (mode === 'demo' && $('onboard').hidden) b.push(`<div class="banner demo">Demo mode: these are made-up companies, and no real whales were harmed. Connect HubSpot in Settings to see your own. <button class="btn small primary pulse" type="button" data-open="settings">Connect HubSpot</button></div>`);
  const nChg = Object.keys(watch.changes || {}).length;
  if (nChg) b.push(`<div class="banner chgb">🔔 <span><b>${nChg} whale${nChg > 1 ? 's' : ''} changed</b> since you last looked. Hover a tagged tile to see what changed.</span> <button class="btn small" type="button" data-act="seen-all">Mark all seen</button></div>`);
  if (errorMsg) b.push(`<div class="banner err">⚠️ ${esc(errorMsg)} <button class="btn small" type="button" data-open="settings">Settings</button></div>`);
  warnings.forEach(w => b.push(`<div class="banner warn">⚠️ ${esc(w)}</div>`));
  if (notifyState.lastError && !(notifyState.lastSent > notifyState.lastErrorAt)) b.push(`<div class="banner err">📭 The last scheduled Slack notification didn't go out: ${esc(notifyState.lastError)}</div>`);
  $('banners').innerHTML = b.join('');
}

function renderStats() {
  const N = accounts.length, c = s => accounts.filter(a => a.s === s).length;
  const W = c('won'), Y = c('amber'), R = c('red'), G = c('grey');
  const hot = accounts.filter(a => heat(a, S) === 'hot').length, cold = accounts.filter(a => heat(a, S) === 'cold').length;
  const pipe = accounts.filter(a => a.s === 'amber' && a.deal).reduce((s, a) => s + (a.deal.amount || 0), 0);
  const wonAmt = accounts.filter(a => a.s === 'won' && a.won).reduce((s, a) => s + (a.won.amount || 0), 0);
  const pct = x => N ? Math.round(x / N * 100) : 0;
  const w = x => (N ? x / N * 100 : 0) + '%';
  $('stats').innerHTML = `
    <div class="stat cap" title="Ranked by priority, starting from #1"><span class="k"><img class="kicon" src="icons/icon32.png" alt="">Whales to hunt</span><span class="v">${N}</span>
      <div class="bar" role="img" aria-label="${W} won, ${Y} being contacted, ${R} not contacted, ${G} not linked"><i style="width:${w(W)};background:var(--won)"></i><i style="width:${w(Y)};background:var(--amber)"></i><i style="width:${w(R)};background:var(--red)"></i><i style="width:${w(G)};background:var(--grey)"></i></div>
      <span class="hint hover-only">Ranked by priority, starting from #1</span></div>
    <div class="stat"><span class="k"><span class="dot" style="background:var(--won)"></span>Won</span><span class="v">${W} <small>${pct(W)}%</small></span></div>
    <div class="stat"><span class="k"><span class="dot" style="background:var(--amber)"></span>Being contacted</span><span class="v">${Y} <small>${pct(Y)}%</small></span><span class="hint">🔥 ${hot} hot · 🥶 ${cold} going cold</span></div>
    <div class="stat"><span class="k"><span class="dot" style="background:var(--red)"></span>Not contacted</span><span class="v">${R} <small>${pct(R)}%</small></span></div>
    <div class="stat"><span class="k">Open pipeline</span><span class="v">${money(pipe, S.currency) || S.currency + '0'}</span></div>
    <div class="stat"><span class="k">Won revenue</span><span class="v">${money(wonAmt, S.currency) || S.currency + '0'}</span></div>`;
}

const initials = o => o ? o.replace(/\./g, '').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() : '';
const dealStage = a => a.s === 'won' ? 'Closed won' : a.s === 'grey' ? '' : (a.deal ? a.deal.stage : 'No deal yet');
const touches = a => a.t == null ? '' : `✉️ ${a.e}  📞 ${a.c}  🤝 ${a.m}`;
const monthYear = ts => ts ? new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
const fullDate = ts => ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';

function visible() {
  return accounts
    .filter(a => (filter === 'all' || a.s === filter || heat(a, S) === filter) && a.name.toLowerCase().includes(query))
    .sort((x, y) => (S.sort === 'az' ? x.name.localeCompare(y.name) : x.rank - y.rank));
}

function tileInner(a) {
  const h = heat(a, S), ds = dealStage(a);
  const stg = ds ? `<span class="stg">${a.s === 'won' ? '🏆 ' : ''}${esc(ds)}${a.s === 'won' && a.won && a.won.amount ? ' · ' + money(a.won.amount, S.currency) : ''}</span>` : '';
  const right = a.s === 'grey' ? '<span>Link it</span>' : (a.owner ? `<span class="av" title="${esc(a.owner)}">${esc(initials(a.owner))}</span>` : '<span class="av none" title="No owner">?</span>');
  let sub;
  if (a.s === 'amber') sub = `<span class="em">${touches(a)}${a.last != null ? `${a.t != null ? ' · ' : ''}${a.last}d` : ''}</span>`;
  else if (a.s === 'won') sub = `<span>${a.won && a.won.date ? 'Won ' + monthYear(a.won.date) : 'Customer'}</span>`;
  else if (a.s === 'red') sub = `<span>${a.why === 'noowner' ? '😱 No owner' : '😳 Never contacted'}</span>`;
  else sub = `<span>${a.missing ? 'Gone from HubSpot' : 'Not in HubSpot yet'}</span>`;
  return `<span class="top"><span class="name"><span class="rk" title="Priority #${a.rank}">${a.rank}</span>${esc(a.name)}</span>${h ? `<span class="heat" title="${h === 'hot' ? 'Hot' : 'Going cold'}">${HEAT[h]}</span>` : ''}</span>
    <span class="sr">${LABEL[a.s]}</span>${stg}<span class="row">${sub}${right}</span>`;
}

function tileHTML(a) {
  const inner = tileInner(a);
  let el;
  if (a.s === 'grey') el = `<button type="button" class="tile s-grey" data-act="link">${inner}</button>`;
  else if (a.url) el = `<a class="tile s-${a.s}" href="${esc(a.url)}" target="_blank" rel="noopener">${inner}</a>`;
  else el = `<button type="button" class="tile s-${a.s}" data-act="open">${inner}</button>`;
  return `<div class="tw" data-key="${esc(a.key)}" draggable="true">${el}${watch.changes && watch.changes[a.key] ? `<span class="chg k-${changeKind(watch.changes[a.key])}" title="${esc(describeChange(watch.changes[a.key], a, S.currency))}" aria-label="Changed: ${esc(describeChange(watch.changes[a.key], a, S.currency))}">${esc(changeTag(watch.changes[a.key]))}</span>` : ''}<i class="cb k1"></i><i class="cb k2"></i><i class="cb k3"></i><i class="cb k4"></i><button class="x" type="button" data-act="remove" title="Throw it back (remove)" aria-label="Remove ${esc(a.name)}">×</button></div>`;
}

function companyLink(a) {
  if (a.url) return `<a class="co" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`;
  return `<button class="co" type="button" data-act="${a.s === 'grey' ? 'link' : 'open'}" data-key="${esc(a.key)}">${esc(a.name)}</button>`;
}

function renderBoard() {
  const list = visible();
  const empty = accounts.length === 0;
  $('empty').hidden = !empty;
  if (empty) {
    $('empty').innerHTML = `${logoSVG(false, 'aria-hidden="true"')}<h3>Your boat is empty</h3><p class="lbl2">Add your whales, most important first, to start the hunt.</p><button class="btn primary" type="button" data-open="add">+ Add accounts</button>`;
  }
  const tiles = S.view !== 'list' || document.body.classList.contains('tv'); // TV mode always shows tiles
  $('grid').hidden = !tiles || empty;
  $('tablewrap').hidden = tiles || empty;
  if (tiles) { $('grid').innerHTML = list.map(tileHTML).join(''); requestAnimationFrame(celebrateWins); }
  else {
    $('tablewrap').innerHTML = `<table class="list-t"><thead><tr><th>#</th><th>Status</th><th>Company</th><th></th><th>Owner</th><th>Lifecycle</th><th>Deal stage</th><th>Touches</th><th class="num">Last touch</th><th class="num">Value</th><th></th></tr></thead><tbody>${
      list.map(a => `<tr data-key="${esc(a.key)}"><td><input class="rkin" type="number" min="1" max="${accounts.length}" value="${a.rank}" aria-label="Priority of ${esc(a.name)}" title="Type a new number to re-rank"></td><td><span class="pill" style="background:var(--${a.s}-bg);color:var(--${a.s})"><span class="dot" style="background:currentColor"></span>${LABEL[a.s]}</span></td>
        <td>${companyLink(a)}</td><td>${HEAT[heat(a, S)]}</td><td>${a.owner ? esc(a.owner) : (a.s === 'grey' ? '–' : '😱 No owner')}</td><td>${esc(a.life || '–')}</td><td>${esc(dealStage(a) || '–')}</td>
        <td>${a.s === 'amber' && a.t != null ? touches(a) : '–'}</td><td class="num">${a.last != null ? ago(a.last) : '–'}</td>
        <td class="num">${a.s === 'won' && a.won && a.won.amount ? money(a.won.amount, S.currency) : a.deal && a.deal.amount ? money(a.deal.amount, S.currency) : '–'}</td>
        <td><button class="btn small ghost" type="button" data-act="remove">Throw back</button></td></tr>`).join('')}</tbody></table>`;
  }
  const G = accounts.filter(a => a.s === 'grey').length;
  $('count').textContent = empty ? '' : `Showing ${list.length} of ${accounts.length} whales · ${S.sort === 'az' ? 'sorted A–Z' : 'ranked by priority (drag a tile, or type a number in List view, to re-rank)'}${G ? ` · ${G} not linked to HubSpot yet` : ''}`;
}

function renderLog() {
  const all = accounts.flatMap(a => (a.log || []).map(x => ({ ...x, a }))).filter(x => x.ts).sort((x, y) => y.ts - x.ts);
  const rows = all.slice(0, 10).map(x => `<tr><td>${companyLink(x.a)}</td><td>${LOGT[x.type] || x.type}</td><td>${esc(x.who || '–')}</td><td class="num">${ago(daysSince(x.ts))}</td></tr>`).join('');
  $('shiplog').innerHTML = `<h3>🧭 Ship's log <small>latest touches on your target accounts, pulled from HubSpot</small></h3>
    ${rows ? `<div class="tablewrap"><table class="log-t"><thead><tr><th>Company</th><th>Activity</th><th>Who</th><th class="num">When</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="lbl2">No emails, calls or meetings logged on your target accounts yet. When your team logs them in HubSpot, they'll show up here.</p>`}
    <span class="small">Your team logs touches in HubSpot as usual. Harpoon reads them and never changes anything.</span>`;
}

function renderStatus() {
  let t;
  if (mode === 'demo') t = 'Demo data';
  else if (refreshing) t = 'Refreshing from HubSpot…';
  else t = lastUpdated ? `Updated ${agoMin(lastUpdated)}` : 'Not loaded yet';
  $('updated').innerHTML = `${esc(t)}${mode === 'live' && !refreshing ? ' <button class="btn small ghost" type="button" id="refreshBtn" aria-label="Refresh from HubSpot">↻ Refresh</button>' : ''}`;
  $('tvUpdated').textContent = mode === 'demo' ? 'Demo data' : (lastUpdated ? 'Updated ' + agoMin(lastUpdated) : '');
}
function agoMin(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hour${h > 1 ? 's' : ''} ago` : ago(Math.floor(h / 24));
}

// ---------- hover card ----------
// a thin progress strip for the deal stage (no labels: the stage name is in the row above)
function stageStrip(a) {
  const deal = dealStage(a);
  const stages = a.s === 'won' ? (a.won && a.won.stages) : (a.deal && a.deal.stages);
  const idx = stages ? stages.indexOf(deal) : -1;
  if (!stages || idx < 0 || stages.length > 8) return '';
  return `<div class="steps ${a.s === 'won' ? 'won' : ''}" style="grid-template-columns:repeat(${stages.length},1fr)" title="${esc(stages.join(' → '))}">${stages.map((s, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
}

// the hover card: kept short on purpose, the tile and the ship's log carry the rest
function card(a) {
  const h = heat(a, S);
  let out = `<h4><span>#${a.rank} ${esc(a.name)}</span><span>${HEAT[h]}</span></h4>`;
  const chg = watch.changes && watch.changes[a.key];
  if (chg) out += `<div class="chgline k-${changeKind(chg)}">${esc(describeChange(chg, a, S.currency))} <span>· ${agoMin(chg.at)}</span></div>`;
  if (a.s === 'amber') {
    out += `<div class="sub" style="color:var(--amber)">Being contacted${a.t ? ` · ${a.t} touches` : ''}</div>`;
    out += `<dl><dt>Owner</dt><dd>${esc(a.owner || '–')}</dd><dt>Last touch</dt><dd>${ago(a.last)}</dd><dt>Deal</dt><dd>${a.deal ? (a.deal.amount ? moneyFull(a.deal.amount, S.currency) : 'Open') : 'None yet'}</dd>${a.deal ? `<dt>Stage</dt><dd>${esc(a.deal.stage)}</dd>` : ''}</dl>`;
    out += stageStrip(a);
  } else if (a.s === 'won') {
    out += `<div class="sub" style="color:var(--won)">🏆 Won${a.won && a.won.date ? ' · ' + fullDate(a.won.date) : ''}</div>`;
    out += `<dl><dt>Amount</dt><dd>${a.won && a.won.amount ? moneyFull(a.won.amount, S.currency) : '–'}</dd><dt>Owner</dt><dd>${esc(a.owner || '–')}</dd></dl>`;
  } else if (a.s === 'red') {
    out += `<div class="sub" style="color:var(--red)">Not contacted</div><div class="why" style="background:var(--red-bg)">${a.why === 'noowner'
      ? '😱 Nobody owns it yet. Give it an owner in HubSpot.'
      : `😳 ${esc(a.owner)} owns it, but nothing is logged yet.`}</div>`;
  } else {
    out += `<div class="sub" style="color:var(--grey)">Not linked to HubSpot</div>`;
  }
  out += `<div class="foot">${a.s === 'grey' ? 'Click to link it →' : a.url ? 'Click to open in HubSpot →' : 'Opens in HubSpot once connected'}</div>`;
  return out;
}

function showCard(tw) {
  const a = accounts.find(x => x.key === tw.dataset.key); if (!a) return;
  const pop = $('pop'), page = $('page');
  pop.innerHTML = card(a); pop.hidden = false;
  const pr = page.getBoundingClientRect(), tr = tw.getBoundingClientRect();
  let left = tr.right - pr.left + 8;
  if (left + 250 > pr.width) left = tr.left - pr.left - 248;
  if (left < 8) left = Math.max(8, tr.left - pr.left);
  const ph = pop.offsetHeight;
  let top = tr.top - pr.top;
  if (tr.top + ph > window.innerHeight - 10) top = tr.bottom - pr.top - ph; // would run off the bottom: grow upwards
  pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
}

// ---------- actions ----------
let toastTimer;
function say(msg, undo) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="undoBtn">Undo</button>' : ''}`;
  t.hidden = false;
  if (undo) $('undoBtn').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 7000 : 4200);
}

async function removeAccount(key) {
  const a = accounts.find(x => x.key === key); if (!a) return;
  if (mode === 'demo') {
    const before = JSON.parse(JSON.stringify(demoState));
    if ((demoState.added || []).includes(key)) demoState.added = demoState.added.filter(k => k !== key);
    else demoState.removed = [...new Set([...(demoState.removed || []), key])];
    // a linked demo account is stored under its original key
    Object.entries(demoState.links || {}).forEach(([orig, k]) => { if (k === key) demoState.removed = [...new Set([...(demoState.removed || []), orig])]; });
    await saveDemo(); render(); badge();
    say(`Threw back ${a.name}.`, async () => { demoState = before; await saveDemo(); render(); badge(); });
  } else {
    const before = targets.slice(), beforeAcc = accounts.slice();
    targets = targets.filter(t => t.key !== key); accounts = accounts.filter(x => x.key !== key);
    await saveTargets(); render(); badge();
    say(`Threw back ${a.name}.`, async () => { targets = before; accounts = beforeAcc; await saveTargets(); render(); badge(); });
  }
}

function openDemoNote(key) {
  const a = accounts.find(x => x.key === key);
  say(`With HubSpot connected, this opens ${a ? a.name : 'the company'} in HubSpot, with every email, call and meeting on it. These are demo whales, so there's nothing to open yet.`);
}

// ---------- add accounts ----------
let rows = [], searching = false;
const normName = s => s.toLowerCase().replace(/\b(ltd|limited|inc|llc|plc|gmbh|group)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const isDomain = s => /\./.test(s) && !/\s/.test(s);
const onList = hit => accounts.some(a => (hit.id && a.id === hit.id) || a.key === hit.key);

async function find(raw) { return mode === 'live' ? hubspot.searchCompany(S.token, raw) : demoSearch(raw); }

async function runLines(lines) {
  if (searching) return;
  lines = [...new Set(lines.map(l => l.trim()).filter(Boolean))].slice(0, CAP);
  rows = []; searching = true; drawResults();
  $('findBtn').disabled = true;
  try {
    for (let i = 0; i < lines.length; i++) {
      $('findProgress').textContent = `Searching ${i + 1} of ${lines.length}…`;
      const raw = lines[i];
      let hits = [];
      try { hits = await find(raw); } catch (e) { $('findProgress').textContent = e.message; if (e.code === 'auth') break; }
      const exact = hits.length === 1 && (isDomain(raw) || normName(hits[0].name) === normName(raw));
      rows.push({ raw, hits, exact, choice: exact ? 0 : (hits.length ? '' : 'grey') });
      drawResults();
      if (mode === 'live') await new Promise(r => setTimeout(r, 260)); // HubSpot allows ~4 searches a second
    }
    $('findProgress').textContent = lines.length ? `Done: ${lines.length} checked.` : '';
  } finally { searching = false; $('findBtn').disabled = false; drawResults(); }
}

function rowState(r) {
  if (r.exact && onList(r.hits[0])) return 'already';
  if (r.choice === 'skip' || r.choice === '') return 'skip';
  if (r.choice === 'grey') return accounts.some(a => a.unlinked && normName(a.name) === normName(r.raw)) ? 'already' : 'grey';
  const hit = r.hits[r.choice];
  return hit && onList(hit) ? 'already' : 'add';
}

function drawResults() {
  if (!rows.length) { $('results').innerHTML = ''; updateCount(); return; }
  $('results').innerHTML = `<div class="tablewrap"><table><thead><tr><th>You typed</th><th>Match in HubSpot</th><th>What happens</th></tr></thead><tbody>${rows.map((r, i) => {
    const h = r.hits;
    if (r.exact && onList(h[0])) return `<tr><td>${esc(r.raw)}</td><td>${esc(h[0].name)}${h[0].domain ? ' · ' + esc(h[0].domain) : ''}</td><td><span class="tag" style="background:var(--grey-bg);color:var(--grey)">Already on board</span></td></tr>`;
    if (r.exact) return `<tr><td>${esc(r.raw)}</td><td><b>${esc(h[0].name)}</b>${h[0].domain ? ' · ' + esc(h[0].domain) : ''}</td><td><span class="tag" style="background:var(--won-bg);color:var(--won)">✅ Found</span> ${h[0].owner ? 'Owner ' + esc(h[0].owner) : 'No owner yet, so it starts red'}</td></tr>`;
    if (h.length) return `<tr><td>${esc(r.raw)}</td><td><select data-i="${i}" aria-label="Pick the right company for ${esc(r.raw)}"><option value="">Pick one…</option>${h.map((x, j) => `<option value="${j}" ${String(r.choice) === String(j) ? 'selected' : ''}>${esc(x.name)}${x.domain ? ' · ' + esc(x.domain) : ''}</option>`).join('')}<option value="grey" ${r.choice === 'grey' ? 'selected' : ''}>None of these: add as Not linked</option><option value="skip" ${r.choice === 'skip' ? 'selected' : ''}>Skip it</option></select></td><td><span class="tag" style="background:var(--amber-bg);color:var(--amber)">⚠️ ${h.length > 1 ? `${h.length} look alike` : 'Close match'}</span> Pick the right one</td></tr>`;
    return `<tr><td>${esc(r.raw)}</td><td><select data-i="${i}" aria-label="What to do with ${esc(r.raw)}"><option value="grey" ${r.choice === 'grey' ? 'selected' : ''}>Add it as Not linked</option><option value="skip" ${r.choice === 'skip' ? 'selected' : ''}>Skip it</option></select></td><td><span class="tag" style="background:var(--grey-bg);color:var(--grey)">❓ Lost at sea</span> Not in HubSpot. Link it later from the board</td></tr>`;
  }).join('')}</tbody></table></div>`;
  $('results').querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
    const v = sel.value; rows[+sel.dataset.i].choice = (v === '' || v === 'grey' || v === 'skip') ? v : Number(v); updateCount();
  }));
  updateCount();
}

function updateCount() {
  const x = rows.filter(r => rowState(r) === 'add' || rowState(r) === 'grey').length;
  const total = accounts.length + x;
  const btn = $('confirmAdd');
  if (total > CAP) $('placeCount').innerHTML = `<span class="joke">🐋 "Easy, captain. This boat holds 100 whales. Throw one back before you hunt another."</span> (${total} of ${CAP})`;
  else $('placeCount').innerHTML = `${accounts.length} whales + ${x} new = <b>${total}</b>`;
  btn.disabled = searching || !x || total > CAP;
  btn.textContent = x ? `Add ${x} to Harpoon` : 'Add to Harpoon';
}

async function confirmAdd() {
  const picks = rows.map(r => ({ r, st: rowState(r) })).filter(p => p.st === 'add' || p.st === 'grey');
  if (accounts.length + picks.length > CAP) return;
  if (mode === 'demo') {
    demoState.added = demoState.added || [];
    picks.forEach(({ r, st }) => demoState.added.push(st === 'grey' ? 'u:' + r.raw : r.hits[r.choice].key));
    await saveDemo();
  } else {
    picks.forEach(({ r, st }) => {
      if (st === 'grey') targets.push({ key: 'u:' + r.raw, id: null, name: r.raw });
      else { const h = r.hits[r.choice]; targets.push({ key: 'hs:' + h.id, id: h.id, name: h.name }); }
    });
    await saveTargets();
  }
  $('addDlg').close();
  rows = []; drawResults(); $('addText').value = ''; $('findProgress').textContent = '';
  say(`Added ${picks.length}. Welcome aboard!`);
  if (mode === 'live') refresh(); else { render(); badge(); }
}

function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  const cells = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(c => c.trim()); };
  const head = cells(lines[0] || '').map(c => c.toLowerCase());
  const di = head.findIndex(c => c.includes('domain') || c.includes('website'));
  const ci = head.findIndex(c => c.includes('company') || c === 'name');
  const hasHead = di >= 0 || ci >= 0;
  return (hasHead ? lines.slice(1) : lines).map(l => { const c = cells(l); return (di >= 0 && c[di]) ? c[di] : c[ci >= 0 ? ci : 0]; }).filter(Boolean);
}

function showPane(p) {
  document.querySelectorAll('#addTabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.pane === p));
  document.querySelectorAll('#addDlg .pane').forEach(el => { el.hidden = el.dataset.pane !== p; });
}

// ---------- link one account ----------
let linkKey = null, linkHits = [];
function openLink(key) {
  const a = accounts.find(x => x.key === key); if (!a) return;
  linkKey = key; linkHits = [];
  $('linkIntro').textContent = `Find the HubSpot company record for "${a.name}". Try the company's website for the most exact match.`;
  $('linkQ').value = a.name; $('linkResults').innerHTML = '';
  $('linkDlg').showModal();
  linkSearch();
}
async function linkSearch() {
  const q = $('linkQ').value.trim(); if (!q) return;
  $('linkResults').innerHTML = '<p class="lbl2">Searching…</p>';
  try { linkHits = await find(q); } catch (e) { $('linkResults').innerHTML = `<p class="errline">${esc(e.message)}</p>`; return; }
  $('linkResults').innerHTML = linkHits.length
    ? `<div class="tablewrap"><table><tbody>${linkHits.map((h, i) => `<tr><td><b>${esc(h.name)}</b>${h.domain ? ' · ' + esc(h.domain) : ''}</td><td>${h.owner ? 'Owner ' + esc(h.owner) : 'No owner'}</td><td class="num">${onList(h) ? '<span class="tag" style="background:var(--grey-bg);color:var(--grey)">Already on board</span>' : `<button class="btn small primary" type="button" data-pick="${i}">Link this one</button>`}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="lbl2">❓ Lost at sea: nothing in HubSpot matches. Try the website, or a shorter name.</p>';
}
async function pickLink(i) {
  const h = linkHits[i], a = accounts.find(x => x.key === linkKey); if (!h || !a) return;
  if (mode === 'demo') {
    if (a.key.startsWith('u:') && (demoState.added || []).includes(a.key)) {
      demoState.added = demoState.added.map(k => k === a.key ? h.key : k);
    } else {
      demoState.links = { ...(demoState.links || {}), [a.key]: h.key };
    }
    await saveDemo(); render(); badge();
  } else {
    targets = targets.map(t => t.key === a.key ? { key: 'hs:' + h.id, id: h.id, name: h.name } : t);
    await saveTargets(); refresh();
  }
  $('linkDlg').close();
  say(`Linked ${a.name} to ${h.name}.`);
}

// ---------- share to Slack ----------
function openShare() {
  const r = buildRundown(accounts, S, { full: true, demo: mode === 'demo' });
  $('sharePreview').innerHTML = rundownToHTML(r);
  const ready = IS_EXT && S.webhook;
  $('sendNow').disabled = !ready;
  $('sendNow').textContent = 'Send to Slack now';
  $('shareNote').innerHTML = !IS_EXT ? '<p class="banner demo">This is the online demo, so nothing can be sent. Install the extension to post to your Slack.</p>'
    : !S.webhook ? '<p class="banner warn">Add your Slack webhook link in Settings first. <button class="btn small" type="button" data-open="settings">Open Settings</button></p>' : '';
  $('shareWhere').textContent = ready ? 'Posts to the channel your webhook belongs to.' : '';
  $('shareIntro').textContent = S.hunting === 'solo'
    ? 'Your recap. Send it to Slack (to yourself, or a channel your sales manager or CRO reads), or copy it into an email or Teams.'
    : 'This is exactly what your team will see in Slack. Or copy it into an email or Teams.';
  drawSchedule();
  drawSnap();
  $('shareDlg').showModal();
}
function drawSnap() { drawSnapshot($('snapCanvas'), accounts, S, { hideNames: $('snapHide').checked, demo: mode === 'demo' }); }
function drawSchedule() {
  document.querySelectorAll('input[name="freq"]').forEach(r => { r.checked = r.value === S.schedule.freq; });
  $('shareTime').value = S.schedule.time;
  $('shareTime').disabled = S.schedule.freq === 'off';
  const due = nextDue(S.schedule);
  $('shareNext').textContent = !due ? '' : `Next one${S.webhook ? '' : ' (once Slack is connected)'}: ${new Date(due).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}
async function sendNow() {
  const btn = $('sendNow'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = buildRundown(accounts, S, { full: true, demo: mode === 'demo' });
    await sendSlack(S.webhook, rundownToSlack(r, S));
    $('shareDlg').close();
    say('Sent to Slack. All hands on deck!');
  } catch (e) {
    $('shareNote').innerHTML = `<p class="errline">${esc(e.message)}</p>`;
  } finally { btn.disabled = false; btn.textContent = 'Send to Slack now'; }
}

// ---------- settings ----------
function openSettings() {
  $('webNote').innerHTML = IS_EXT ? '' : '<p class="banner demo">This is the online demo. Connecting HubSpot and Slack only works in the Chrome extension.</p>';
  ['tokenIn', 'testHs', 'disconnect', 'hookIn', 'testSlack'].forEach(id => { $(id).disabled = !IS_EXT; });
  $('tokenIn').value = S.token; $('hookIn').value = S.webhook;
  $('disconnect').hidden = !S.token;
  $('mentionsIn').checked = !!S.mentions;
  $('hotT').value = S.hotTouches; $('hotD').value = S.hotDays; $('coldD').value = S.coldDays;
  $('curIn').value = S.currency; $('skinIn').value = S.skin; $('huntIn').value = S.hunting || 'team';
  $('demoSec').hidden = mode !== 'demo';
  $('hsResult').innerHTML = mode === 'live' ? '<p class="okline">✅ Connected to HubSpot.</p>' : '';
  $('slackResult').innerHTML = '';
  drawIds();
  $('settingsDlg').showModal();
}
function drawIds() {
  const owners = [...new Set(accounts.map(a => a.owner).filter(Boolean))].sort();
  $('idsList').innerHTML = owners.length ? owners.map(o => `<label for="sid-${esc(o)}">${esc(o)}</label><input class="field" id="sid-${esc(o)}" data-owner="${esc(o)}" placeholder="Slack member ID, like U012AB3CD" value="${esc((S.slackIds || {})[o] || '')}">`).join('')
    : '<span class="small">Owners appear here once your accounts are loaded.</span><span></span>';
  $('idsList').querySelectorAll('input').forEach(inp => inp.addEventListener('change', async () => {
    S.slackIds = { ...(S.slackIds || {}), [inp.dataset.owner]: inp.value.trim() }; await saveS();
  }));
}
async function setSchedule(freq, time) {
  S.schedule = { freq: freq ?? S.schedule.freq, time: time ?? S.schedule.time };
  await saveS();
  if (IS_EXT) { try { await chrome.runtime.sendMessage({ type: 'reschedule' }); } catch { /* ignore */ } }
  render(); if ($('shareDlg').open) drawSchedule();
}
async function testHs() {
  const token = $('tokenIn').value.trim();
  if (!token) { $('hsResult').innerHTML = '<p class="errline">Paste your HubSpot access token first.</p>'; return; }
  $('hsResult').innerHTML = '<p class="lbl2">Testing the connection…</p>'; $('testHs').disabled = true;
  try {
    const r = await hubspot.testConnection(token);
    const list = r.checks.map(c => `<span>${c.ok ? '✅' : '❌'} ${esc(c.label)}${c.ok ? '' : c.code === 'scope' ? ': missing a scope in the private app' : ': not reachable'}</span>`).join('');
    const companiesOk = r.checks[0] && r.checks[0].ok;
    $('hsResult').innerHTML = `<div class="${companiesOk ? 'okline' : 'errline'}">${companiesOk ? `✅ Land ho! Connected. Harpoon can read ${r.companies != null ? r.companies.toLocaleString('en-GB') + ' companies' : 'your companies'}.` : "❌ Harpoon can't read companies with this token."}</div><div class="checks">${list}</div>`;
    if (companiesOk) {
      const wasDemo = mode === 'demo';
      S.token = token; await saveS();
      $('disconnect').hidden = false;
      await load(); render();
      if (wasDemo && accounts.length === 0) say('Connected! Now add your target accounts.');
      refresh();
    }
  } catch (e) {
    $('hsResult').innerHTML = `<p class="errline">❌ ${esc(e.message)}</p>`;
  } finally { $('testHs').disabled = false; }
}
async function disconnect() {
  S.token = ''; await saveS();
  await store.remove('cache');
  warnings = []; errorMsg = '';
  $('tokenIn').value = ''; $('disconnect').hidden = true;
  $('hsResult').innerHTML = '<p class="lbl2">Disconnected. Your target list is kept in this Chrome in case you reconnect. Showing demo data.</p>';
  await load(); render(); badge();
}
async function testSlack() {
  const hook = $('hookIn').value.trim();
  $('slackResult').innerHTML = '<p class="lbl2">Sending a test message…</p>'; $('testSlack').disabled = true;
  try {
    await sendSlack(hook, ':whale: Ahoy! Harpoon is now connected to this channel. Your target account notifications will land here.');
    S.webhook = hook; await saveS(); renderOnboard();
    $('slackResult').innerHTML = '<p class="okline">✅ Message in a bottle delivered. Check your Slack channel.</p>';
    setSchedule();
  } catch (e) {
    $('slackResult').innerHTML = `<p class="errline">❌ ${esc(e.message)}</p>`;
  } finally { $('testSlack').disabled = false; }
}

// ---------- TV mode ----------
let tvTimers = [], wakeLock = null, mouseTimer;
async function tvStart() {
  $('tvDlg').close();
  document.body.classList.add('tv');
  try { await document.documentElement.requestFullscreen(); } catch { /* fine without */ }
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed here */ }
  const tick = () => { $('tvClock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); renderStatus(); };
  tick();
  tvTimers.push(setInterval(tick, 20000));
  tvTimers.push(setInterval(() => { if (mode === 'live') refresh(); }, 10 * 60000));
  renderBoard();
  window.scrollTo(0, 0);
}
function tvStop() {
  if (!document.body.classList.contains('tv')) return;
  document.body.classList.remove('tv', 'mouse');
  tvTimers.forEach(clearInterval); tvTimers = [];
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderBoard();
}
document.addEventListener('visibilitychange', async () => {
  if (document.body.classList.contains('tv') && document.visibilityState === 'visible' && !wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
});



// ---------- 🏆 deal won: the harpoon strikes and the confetti flies ----------
const celebrated = new Set(); // each win gets its big moment once per visit (hover the tile to see it again)
const CONFETTI = ['#6E3BD8', '#9A72F0', '#178A4C', '#F2B705', '#D23B3B', '#B06A00', '#43B3E0'];
const HARPOON_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(135 60 60)"><path d="M5 60H103" stroke="#6E3BD8" stroke-width="7" stroke-linecap="round"/><path d="M8 55.5H16V64.5H8Z" fill="#6E3BD8"/><path d="M119 60C114 52 107 45.5 97.5 39.5C101 45 104 50.5 106 56.5H99V63.5H106.5L104.5 68.5C110 66.5 115 63.5 119 60Z" fill="#6E3BD8" stroke="#6E3BD8" stroke-width="1.4" stroke-linejoin="round"/></g></svg>`;
function celebrate(tw, delay = 0) {
  if (!tw || calmMotion()) return;
  setTimeout(() => {
    const h = document.createElement('span'); h.className = 'strike'; h.innerHTML = HARPOON_SVG; tw.appendChild(h);
    const tile = tw.querySelector('.tile');
    setTimeout(() => {
      if (tile) { tile.classList.remove('thud'); void tile.offsetWidth; tile.classList.add('thud'); }
      for (let i = 0; i < 46; i++) {
        const c = document.createElement('i'); c.className = 'confetti';
        const ang = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 110;
        c.style.cssText = `background:${CONFETTI[i % CONFETTI.length]};--dx:${(Math.cos(ang) * dist).toFixed(0)}px;--dy:${(Math.sin(ang) * dist * .8 - 50).toFixed(0)}px;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;animation-delay:${Math.round(Math.random() * 120)}ms;${i % 3 === 0 ? 'border-radius:50%;width:7px;height:7px;' : ''}`;
        tw.appendChild(c); setTimeout(() => c.remove(), 1900);
      }
    }, 380);
    setTimeout(() => h.remove(), 2600);
  }, delay);
}
function celebrateWins() {
  let n = 0;
  Object.entries(watch.changes || {}).forEach(([key, c]) => {
    if (changeKind(c) !== 'won' || celebrated.has(key)) return;
    const tw = document.querySelector(`.tw[data-key="${CSS.escape(key)}"]`); if (!tw) return;
    celebrated.add(key);
    if (n === 0) { const a = accounts.find(x => x.key === key); if (a) say(`🏆 Deal won: ${a.name}! Harpoon struck true.`); }
    celebrate(tw, 500 + n++ * 900);
  });
}
function calmMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

// ---------- re-ranking ----------
async function moveTo(key, rank) {
  const from = accounts.findIndex(a => a.key === key);
  if (from < 0 || !rank || isNaN(rank)) { render(); return; }
  const to = Math.max(1, Math.min(accounts.length, rank)) - 1;
  if (from === to) { render(); return; }
  const [a] = accounts.splice(from, 1); accounts.splice(to, 0, a);
  if (mode === 'demo') { demoState.order = accounts.map(x => x.origKey || x.key); await store.set({ demo: demoState }); }
  else { const byKey = Object.fromEntries(targets.map(t => [t.key, t])); targets = accounts.map(x => byKey[x.key]).filter(Boolean).concat(targets.filter(t => !accounts.some(x => x.key === t.key))); await saveTargets(); }
  render();
  say(`${a.name} is now #${to + 1}.`);
}

// ---------- the logo's party trick ----------
let quipBusy = false, quipIdx = -1;
function quips() {
  const r = buildRundown(accounts, S, { full: false });
  const reds = accounts.filter(x => x.s === 'red').length;
  const lines = [
    'Hey! Not me. Harpoon the accounts!',
    "I'm the mascot, not a target account.",
    'Whale, whale, whale. Shouldn\'t you be prospecting?',
    'That tickles. Now go and book a meeting.',
    'Easy, captain. Save it for the big fish.',
    "I'm on your side. Your pipeline isn't.",
    'Nice aim. Now try it on a cold account.',
    'Ow. That\'s going in the ship\'s log.'
  ];
  if (r.next) lines.push(`Ouch! Go and harpoon ${r.next.name} instead. They're #${r.next.rank}.`);
  if (reds) lines.push(`${reds} whale${reds > 1 ? 's' : ''} nobody's contacted, and you're aiming at me?`);
  return lines;
}
function harpoonTheWhale(logo) {
  if (quipBusy) return;
  quipBusy = true;
  logo.classList.remove('go'); void logo.offsetWidth; logo.classList.add('go');
  const lines = quips();
  let i; do { i = Math.floor(Math.random() * lines.length); } while (lines.length > 1 && i === quipIdx);
  quipIdx = i;
  const old = document.querySelector('.quip'); if (old) old.remove();
  setTimeout(() => {
    const b = document.createElement('div'); b.className = 'quip'; b.setAttribute('role', 'status'); b.textContent = lines[i];
    logo.closest('.brandmark').appendChild(b);
    setTimeout(() => { b.remove(); }, 3200);
  }, 950);
  setTimeout(() => { logo.classList.remove('go'); quipBusy = false; }, 1700);
}

// ---------- wiring ----------
function bind() {
  $('addBtn').onclick = () => { showPane('paste'); updateCount(); $('addDlg').showModal(); };
  $('shareBtn').onclick = openShare;
  $('settingsBtn').onclick = openSettings;
  $('tvBtn').onclick = () => $('tvDlg').showModal();
  $('tvStart').onclick = tvStart;
  $('tvExit').onclick = tvStop;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') tvStop(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) tvStop(); });
  document.addEventListener('mousemove', () => {
    if (!document.body.classList.contains('tv')) return;
    document.body.classList.add('mouse'); clearTimeout(mouseTimer); mouseTimer = setTimeout(() => document.body.classList.remove('mouse'), 2500);
  });

  // close buttons + click on backdrop
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });

  // anything with data-open (banners, empty state, share note)
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (!o) return;
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    if (o.dataset.open === 'settings') openSettings();
    if (o.dataset.open === 'add') $('addBtn').click();
    if (o.dataset.open === 'settings' && o.closest('.onboard')) setTimeout(() => $('tokenIn').focus(), 50);
    if (o.dataset.open === 'slack') {
      if (!S.webhook) { openSettings(); setTimeout(() => { $('hookIn').closest('.set-sec').scrollIntoView({ block: 'start' }); $('hookIn').focus(); }, 50); }
      else openShare();
    }
  });

  // schedule (inside the Share window)
  document.querySelectorAll('input[name="freq"]').forEach(r => r.onchange = async () => {
    await setSchedule(r.value);
    say(r.value === 'off' ? 'Automatic notifications off. You can still send one any time.'
      : !S.webhook ? `Saved: ${scheduleLabel(S.schedule)}. Connect Slack in Settings so it can go out.`
      : `Scheduled: ${scheduleLabel(S.schedule)}. Harpoon will brief the crew.`);
  });
  $('shareTime').onchange = () => { if ($('shareTime').value) setSchedule(undefined, $('shareTime').value); };

  // sort
  document.querySelectorAll('#sortSeg button').forEach(b => b.onclick = async () => { S.sort = b.dataset.sort; await saveS(); render(); });

  // re-rank: drag a tile onto another, or type a number in list view
  let dragKey = null;
  $('grid').addEventListener('dragstart', e => { const tw = e.target.closest('.tw'); if (!tw) return; dragKey = tw.dataset.key; tw.classList.add('dragging'); $('pop').hidden = true; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragKey); } catch { /* ignore */ } });
  $('grid').addEventListener('dragend', () => { dragKey = null; document.querySelectorAll('.tw.dragging, .tw.drop-before').forEach(x => x.classList.remove('dragging', 'drop-before')); });
  $('grid').addEventListener('dragover', e => { const tw = e.target.closest('.tw'); if (!tw || !dragKey) return; e.preventDefault(); document.querySelectorAll('.tw.drop-before').forEach(x => x.classList.remove('drop-before')); if (tw.dataset.key !== dragKey) tw.classList.add('drop-before'); });
  $('grid').addEventListener('drop', e => { const tw = e.target.closest('.tw'); if (!tw || !dragKey) return; e.preventDefault(); const to = accounts.find(a => a.key === tw.dataset.key); if (to) moveTo(dragKey, to.rank); });
  $('tablewrap').addEventListener('change', e => { if (!e.target.classList.contains('rkin')) return; const key = e.target.closest('tr').dataset.key; moveTo(key, parseInt(e.target.value, 10)); });

  // the logo: hover and the whale gets harpooned, with a quip
  document.querySelectorAll('.brandmark .logo').forEach(l => {
    l.addEventListener('mouseenter', () => harpoonTheWhale(l));
    l.addEventListener('click', () => harpoonTheWhale(l));
  });

  // filters, search, view
  document.querySelectorAll('.controls .chip.f').forEach(b => b.onclick = () => {
    filter = b.dataset.f; document.querySelectorAll('.controls .chip.f').forEach(x => x.setAttribute('aria-pressed', x === b)); renderBoard();
  });
  $('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderBoard(); });
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = async () => { S.view = b.dataset.view; await saveS(); $('pop').hidden = true; render(); });
  $('updated').addEventListener('click', e => { if (e.target.id === 'refreshBtn') refresh(); });

  // board clicks + hover cards
  const board = $('page');
  board.addEventListener('click', e => {
    const act = e.target.closest('[data-act]'); if (!act) return;
    const key = act.dataset.key || (act.closest('[data-key]') && act.closest('[data-key]').dataset.key);
    if (act.dataset.act === 'remove') { e.preventDefault(); removeAccount(key); }
    if (act.dataset.act === 'link') openLink(key);
    if (act.dataset.act === 'open') openDemoNote(key);
    if (act.dataset.act === 'seen-all') markSeen(Object.keys(watch.changes || {}));
  });
    let overTw = null;
  $('grid').addEventListener('mouseover', e => {
    const tw = e.target.closest('.tw'); if (!tw) return; showCard(tw);
    if (tw !== overTw) { overTw = tw; const c = watch.changes && watch.changes[tw.dataset.key]; if (changeKind(c) === 'won') celebrate(tw); }
  });
  $('grid').addEventListener('mouseleave', () => { overTw = null; });
  $('grid').addEventListener('focusin', e => { const tw = e.target.closest('.tw'); if (tw) showCard(tw); });
  const hideCard = () => { $('pop').hidden = true; };
  $('grid').addEventListener('mouseout', e => { const from = e.target.closest('.tw'); if (from && (!e.relatedTarget || !from.contains(e.relatedTarget))) { hideCard(); markSeen(from.dataset.key); } });
  $('grid').addEventListener('mouseleave', hideCard);
  $('grid').addEventListener('click', hideCard);
  window.addEventListener('scroll', hideCard, { passive: true });
  window.addEventListener('blur', hideCard);
  document.addEventListener('visibilitychange', hideCard);
  $('grid').addEventListener('focusout', () => { $('pop').hidden = true; });

  // add accounts
  document.querySelectorAll('#addTabs button').forEach(b => b.onclick = () => showPane(b.dataset.pane));
  $('findBtn').onclick = () => runLines($('addText').value.split(/\r?\n/));
  $('pullBtn').onclick = async () => {
    $('pullBtn').disabled = true;
    try {
      const hits = mode === 'live' ? await hubspot.targetAccounts(S.token) : await demoTargetAccounts();
      rows = hits.map(h => ({ raw: h.name, hits: [h], exact: true, choice: 0 }));
      if (!hits.length) $('results').innerHTML = '<p class="lbl2">No companies are ticked as "Target account" in your HubSpot yet.</p>';
      else drawResults();
    } catch (e) { $('results').innerHTML = `<p class="errline">${esc(e.message)}</p>`; }
    finally { $('pullBtn').disabled = false; }
  };
  $('csvFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { const vals = parseCSV(rd.result); $('addText').value = vals.join('\n'); showPane('paste'); runLines(vals); };
    rd.readAsText(f);
    e.target.value = '';
  });
  $('confirmAdd').onclick = confirmAdd;

  // link
  $('linkFind').onclick = linkSearch;
  $('linkQ').addEventListener('keydown', e => { if (e.key === 'Enter') linkSearch(); });
  $('linkResults').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) pickLink(+b.dataset.pick); });

  // share
  $('sendNow').onclick = sendNow;
  $('snapHide').onchange = drawSnap;
  $('snapCopy').onclick = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': snapshotBlob($('snapCanvas')) })]); say('Image copied. Paste it into Slack, an email, Teams or LinkedIn.'); }
    catch { say("Couldn't copy the image here. Use Download image instead."); }
  };
  $('snapSave').onclick = async () => {
    const blob = await snapshotBlob($('snapCanvas'));
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `harpoon-whales-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say('Saved to your Downloads folder.');
  };
  $('copyRecap').onclick = async () => {
    const text = $('sharePreview').innerText.trim();
    try { await navigator.clipboard.writeText(text); say('Copied. Paste it into an email, Teams or your 1:1 notes.'); }
    catch { const r = document.createRange(); r.selectNodeContents($('sharePreview')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); say('Selected. Press Cmd+C (or Ctrl+C) to copy.'); }
  };

  // settings
  $('testHs').onclick = testHs;
  $('disconnect').onclick = disconnect;
  $('testSlack').onclick = testSlack;
  $('mentionsIn').onchange = async () => { S.mentions = $('mentionsIn').checked; await saveS(); };
  const num = (id, key, min, max) => $(id).onchange = async () => {
    const v = Math.max(min, Math.min(max, parseInt($(id).value, 10) || S[key])); $(id).value = v; S[key] = v; await saveS(); render();
  };
  num('hotT', 'hotTouches', 1, 99); num('hotD', 'hotDays', 1, 365); num('coldD', 'coldDays', 1, 999);
  $('curIn').onchange = async () => { S.currency = $('curIn').value; await saveS(); render(); };
  $('skinIn').onchange = async () => { S.skin = $('skinIn').value; document.body.dataset.skin = S.skin; await saveS(); };
  $('huntIn').onchange = async () => { S.hunting = $('huntIn').value; await saveS(); render(); };
  $('resetDemo').onclick = async () => { demoState = {}; await saveDemo(); render(); badge(); say('Demo board reset: Moby Dick and the other 19 whales are back.'); };
}
