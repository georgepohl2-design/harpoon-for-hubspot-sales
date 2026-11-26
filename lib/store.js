// Tiny storage wrapper. Inside the Chrome extension it uses chrome.storage.local
// (kept on this computer only). Opened as a plain web page (the online demo),
// it falls back to localStorage so the board still works.

import { HUBSPOT_STAGES } from './manual.js';

export const IS_EXT = !!(globalThis.chrome && chrome.runtime && chrome.runtime.id && chrome.storage);

const PREFIX = 'harpoon:';

export async function get(keys) {
  const list = [].concat(keys);
  if (IS_EXT) return chrome.storage.local.get(list);
  const out = {};
  for (const k of list) {
    try {
      const v = localStorage.getItem(PREFIX + k);
      if (v !== null) out[k] = JSON.parse(v);
    } catch { /* private window or blocked storage: carry on without it */ }
  }
  return out;
}

export async function set(obj) {
  if (IS_EXT) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* ignore */ }
  }
}

export async function remove(keys) {
  const list = [].concat(keys);
  if (IS_EXT) return chrome.storage.local.remove(list);
  for (const k of list) {
    try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ }
  }
}

export const DEFAULT_SETTINGS = {
  token: '',
  webhook: '',
  schedule: { freq: 'weekly', time: '09:00' },  // 'daily' (weekdays) | 'weekly' (Mondays) | 'off'
  hotTouches: 8,
  hotDays: 14,
  coldDays: 21,
  currency: '£',
  mentions: true,
  slackIds: {},      // owner name -> Slack member ID, for real @-mentions
  hunting: 'team',   // 'team' (a sales / marketing / commercial team) or 'solo' (one SDR, BDR, AE or BD person)
  slackSkipped: false,
  source: '',        // where the whales come from: '' (not chosen: demo until HubSpot is connected), 'hubspot' or 'manual' (no CRM)
  stages: HUBSPOT_STAGES, // manual mode's deal stages (HubSpot's defaults until you change them)
  view: 'tiles',
  skin: 'cream'
};

export async function loadSettings() {
  const { settings } = await get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}), schedule: { ...DEFAULT_SETTINGS.schedule, ...((settings || {}).schedule || {}) } };
}

export async function saveSettings(s) {
  await set({ settings: s });
}
