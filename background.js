// Harpoon's background worker:
//  - clicking the whale in the toolbar opens the board in its own full-size tab (or jumps to it)
//  - sends the scheduled Slack notification (daily or weekly), catching up if Chrome was closed
//  - keeps the red number on the toolbar whale up to date: how many whales changed status since you last looked
//    (checks HubSpot once an hour while Chrome is open)
//  - handles "Open the target account list in Harpoon" links from Slack

import * as store from './lib/store.js';
import { nextDue, buildRundown, rundownToSlack, trackChanges, stateOf } from './lib/model.js';
import { demoAccounts, demoWatch } from './lib/demo.js';
import * as hubspot from './lib/hubspot.js';
import { sendSlack } from './lib/slack.js';

const BOARD = chrome.runtime.getURL('board.html');
const ALARM = 'harpoon-notify';
const WATCH = 'harpoon-watch'; // hourly look at HubSpot for whales that changed status

async function openBoard() {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [BOARD] });
    const tab = ctx.find(c => c.tabId >= 0);
    if (tab) {
      await chrome.tabs.update(tab.tabId, { active: true });
      if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch { /* older Chrome: just open a new tab */ }
  await chrome.tabs.create({ url: BOARD });
}

chrome.action.onClicked.addListener(openBoard);

// The badge: how many whales changed status (won, contacted, not contacted, hot, cold) since you last looked.
async function setBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: '#D23B3B' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({ title: count ? `Harpoon: ${count} whale${count > 1 ? 's' : ''} changed status. Open the board to see what changed.` : 'Harpoon' });
}

async function badgeFromStore() {
  const settings = await store.loadSettings();
  if (settings.token) { const { watch = {} } = await store.get('watch'); return setBadge(Object.keys(watch.changes || {}).length); }
  const { demo = {} } = await store.get('demo');
  return setBadge(Object.keys(demoWatch(demoAccounts(demo), demo, a => stateOf(a, settings)).changes).length);
}

async function currentAccounts(settings) {
  if (settings.token) {
    const { targets = [] } = await store.get('targets');
    const r = await hubspot.refresh(settings.token, targets);
    const { watch: stored } = await store.get('watch');
    const watch = trackChanges(r.accounts, stored || {}, settings);
    await store.set({ cache: { at: Date.now(), accounts: r.accounts, warnings: r.warnings, portal: r.portal }, watch });
    return { accounts: r.accounts, demo: false };
  }
  const { demo = {} } = await store.get('demo');
  return { accounts: demoAccounts(demo), demo: true };
}

async function sendScheduled() {
  const settings = await store.loadSettings();
  if (!settings.webhook || settings.schedule.freq === 'off') return;
  const { accounts, demo } = await currentAccounts(settings);
  const r = buildRundown(accounts, settings, { full: settings.schedule.freq === 'weekly', demo });
  await sendSlack(settings.webhook, rundownToSlack(r, settings));
  await store.set({ notify: { ...(await store.get('notify')).notify, lastSent: Date.now() } });
  await badgeFromStore();
}

// Once an hour: read HubSpot, note any whale that changed status, update the badge. Live mode only.
async function watchCheck() {
  const settings = await store.loadSettings();
  if (!settings.token) return;
  try { await currentAccounts(settings); } catch { /* offline or HubSpot hiccup: try again next hour */ }
  await badgeFromStore();
}
const startWatch = () => chrome.alarms.create(WATCH, { periodInMinutes: 60, delayInMinutes: 1 });

async function reschedule() {
  const settings = await store.loadSettings();
  await chrome.alarms.clear(ALARM);
  const due = nextDue(settings.schedule);
  const { notify = {} } = await store.get('notify');
  await store.set({ notify: { ...notify, nextDue: due } });
  if (due) await chrome.alarms.create(ALARM, { when: due });
}

// If Chrome was closed when a notification was due, send it as soon as Chrome opens again.
async function catchUp() {
  const { notify = {} } = await store.get('notify');
  if (notify.nextDue && Date.now() > notify.nextDue + 60000 && !(notify.lastSent > notify.nextDue)) {
    try { await sendScheduled(); } catch (e) { await store.set({ notify: { ...notify, lastError: String(e.message || e), lastErrorAt: Date.now() } }); }
  }
  await reschedule();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WATCH) { await watchCheck(); return; }
  if (alarm.name !== ALARM) return;
  try { await sendScheduled(); }
  catch (e) {
    const { notify = {} } = await store.get('notify');
    await store.set({ notify: { ...notify, lastError: String(e.message || e), lastErrorAt: Date.now() } });
  }
  await reschedule();
});

chrome.runtime.onStartup.addListener(async () => { startWatch(); await badgeFromStore(); await catchUp(); });
chrome.runtime.onInstalled.addListener(async () => {
  await reschedule();
  startWatch();
  await badgeFromStore();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'reschedule') { reschedule().then(() => reply({ ok: true })); return true; }
  if (msg.type === 'badge') { setBadge(msg.count || 0).then(() => reply({ ok: true })); return true; }
  if (msg.type === 'open-board') {
    openBoard().then(() => { if (sender.tab && sender.tab.id >= 0) chrome.tabs.remove(sender.tab.id); reply({ ok: true }); });
    return true;
  }
});
