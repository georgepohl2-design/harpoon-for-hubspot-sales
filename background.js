// Harpoon's background worker:
//  - clicking the whale in the toolbar opens the board in its own full-size tab (or jumps to it)
//  - sends the scheduled Slack notification (daily or weekly), catching up if Chrome was closed
//  - keeps the red number on the toolbar whale up to date
//  - handles "Open the target account list in Harpoon" links from Slack

import * as store from './lib/store.js';
import { nextDue, buildRundown, rundownToSlack } from './lib/model.js';
import { demoAccounts } from './lib/demo.js';
import * as hubspot from './lib/hubspot.js';
import { sendSlack } from './lib/slack.js';

const BOARD = chrome.runtime.getURL('board.html');
const ALARM = 'harpoon-notify';

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

async function setBadge(accounts) {
  const red = accounts.filter(a => a.s === 'red').length;
  await chrome.action.setBadgeBackgroundColor({ color: '#D23B3B' });
  await chrome.action.setBadgeText({ text: red ? String(red) : '' });
  await chrome.action.setTitle({ title: red ? `Harpoon: ${red} target account${red > 1 ? 's' : ''} nobody has contacted` : 'Harpoon' });
}

async function currentAccounts(settings) {
  if (settings.token) {
    const { targets = [] } = await store.get('targets');
    const r = await hubspot.refresh(settings.token, targets);
    await store.set({ cache: { at: Date.now(), accounts: r.accounts, warnings: r.warnings, portal: r.portal } });
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
  await setBadge(accounts);
}

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
  if (alarm.name !== ALARM) return;
  try { await sendScheduled(); }
  catch (e) {
    const { notify = {} } = await store.get('notify');
    await store.set({ notify: { ...notify, lastError: String(e.message || e), lastErrorAt: Date.now() } });
  }
  await reschedule();
});

chrome.runtime.onStartup.addListener(catchUp);
chrome.runtime.onInstalled.addListener(async () => {
  await reschedule();
  const { cache } = await store.get('cache');
  const settings = await store.loadSettings();
  if (cache && settings.token) await setBadge(cache.accounts || []);
  else { const { demo = {} } = await store.get('demo'); await setBadge(demoAccounts(demo)); }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'reschedule') { reschedule().then(() => reply({ ok: true })); return true; }
  if (msg.type === 'badge') { setBadge(msg.accounts || []).then(() => reply({ ok: true })); return true; }
  if (msg.type === 'open-board') {
    openBoard().then(() => { if (sender.tab && sender.tab.id >= 0) chrome.tabs.remove(sender.tab.id); reply({ ok: true }); });
    return true;
  }
});
