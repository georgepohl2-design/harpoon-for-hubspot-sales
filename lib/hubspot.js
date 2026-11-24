// Read-only HubSpot calls. Harpoon never creates, changes or deletes anything in HubSpot.
// Auth: a private app access token, kept in chrome.storage on this computer only.
//
// Scopes the private app needs (all read-only):
//   crm.objects.companies.read  - company name, website, owner, lifecycle stage, last contacted
//   crm.objects.deals.read      - deal stage, amount, close date
//   crm.objects.owners.read     - turning owner IDs into names
//   crm.objects.contacts.read   - HubSpot uses this one to unlock emails, calls and meetings

import { classify, daysSince, shortName, LIFECYCLE } from './model.js';

const API = 'https://api.hubapi.com';

export class HubSpotError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hs(token, path, { method = 'GET', body } = {}, tries = 0) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new HubSpotError("Couldn't reach HubSpot. Check your internet connection and try again.", 'network');
  }
  if (res.status === 429 && tries < 4) { await sleep(1100 * (tries + 1)); return hs(token, path, { method, body }, tries + 1); }
  if (res.status === 401) throw new HubSpotError('HubSpot turned down the access token. Paste it again in Settings, or make a new one.', 'auth');
  if (res.status === 403) throw new HubSpotError('The HubSpot private app is missing a permission (scope) for this.', 'scope');
  if (!res.ok) throw new HubSpotError(`HubSpot said no (error ${res.status}). Try again in a minute.`, 'http');
  return res.status === 204 ? null : res.json();
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ---------- connection test ----------

export async function testConnection(token) {
  const out = { ok: false, portalId: null, uiDomain: null, companies: null, checks: [] };
  const check = async (label, fn) => {
    try { await fn(); out.checks.push({ label, ok: true }); }
    catch (e) { out.checks.push({ label, ok: false, code: e.code }); if (e.code === 'auth' || e.code === 'network') throw e; }
  };
  await check('Companies', async () => {
    const r = await hs(token, '/crm/v3/objects/companies/search', { method: 'POST', body: { limit: 1, properties: ['name'] } });
    out.companies = r.total;
  });
  await check('Deals', () => hs(token, '/crm/v3/objects/deals/search', { method: 'POST', body: { limit: 1 } }));
  await check('Owners', () => hs(token, '/crm/v3/owners?limit=1'));
  await check('Emails, calls and meetings', () => hs(token, '/crm/v3/objects/calls/search', { method: 'POST', body: { limit: 1 } }));
  try {
    const info = await hs(token, '/account-info/v3/details');
    out.portalId = info.portalId; out.uiDomain = info.uiDomain || 'app.hubspot.com';
  } catch { /* links fall back to a HubSpot search */ }
  out.ok = out.checks.every(c => c.ok);
  return out;
}

// ---------- finding companies (for adding and linking accounts) ----------

const norm = s => s.toLowerCase().replace(/\b(ltd|limited|inc|llc|plc|gmbh|group)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const PROPS = ['name', 'domain', 'hubspot_owner_id'];

async function ownerNames(token) {
  const map = {};
  let after = '';
  for (let i = 0; i < 10; i++) {
    const r = await hs(token, `/crm/v3/owners?limit=500${after ? '&after=' + after : ''}`);
    (r.results || []).forEach(o => { map[o.id] = shortName(o.firstName, o.lastName, o.email); });
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return map;
}

let ownerCache = null;
async function owners(token) {
  if (!ownerCache || ownerCache.token !== token) ownerCache = { token, map: await ownerNames(token).catch(() => ({})) };
  return ownerCache.map;
}

const toHit = (r, om) => ({ id: r.id, key: 'hs:' + r.id, name: r.properties.name || '(no name)', domain: r.properties.domain || '', owner: om[r.properties.hubspot_owner_id] || null });

/** Website first (exact), then name (ignoring capitals, punctuation, Ltd/Inc). Returns up to 5 hits. */
export async function searchCompany(token, raw) {
  const s = raw.trim();
  const om = await owners(token);
  if (/\./.test(s) && !/\s/.test(s)) {
    const d = s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const r = await hs(token, '/crm/v3/objects/companies/search', { method: 'POST', body: {
      filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: d }] }], properties: PROPS, limit: 5 } });
    return (r.results || []).map(x => toHit(x, om));
  }
  const r = await hs(token, '/crm/v3/objects/companies/search', { method: 'POST', body: { query: s, properties: PROPS, limit: 10 } });
  const all = (r.results || []).map(x => toHit(x, om));
  const n = norm(s);
  const exact = all.filter(h => norm(h.name) === n);
  if (exact.length) return exact.slice(0, 5);
  return all.slice(0, 5);
}

/** Companies ticked "Target account" in HubSpot (part of HubSpot's ABM tools). */
export async function targetAccounts(token) {
  const om = await owners(token);
  const out = [];
  let after;
  for (let i = 0; i < 2; i++) {
    const r = await hs(token, '/crm/v3/objects/companies/search', { method: 'POST', body: {
      filterGroups: [{ filters: [{ propertyName: 'hs_is_target_account', operator: 'EQ', value: 'true' }] }],
      properties: PROPS, limit: 100, ...(after ? { after } : {}) } });
    (r.results || []).forEach(x => out.push(toHit(x, om)));
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return out;
}

// ---------- the full refresh ----------

/**
 * targets: [{ key, id, name }] (id null = not linked yet)
 * Returns { accounts, warnings, portal }.
 */
export async function refresh(token, targets) {
  const warnings = [];
  const linked = targets.filter(t => t.id);
  const ids = linked.map(t => String(t.id));
  const om = await owners(token);
  ownerCache = { token, map: om };

  let portal = { portalId: null, uiDomain: 'app.hubspot.com' };
  try { const info = await hs(token, '/account-info/v3/details'); portal = { portalId: info.portalId, uiDomain: info.uiDomain || 'app.hubspot.com' }; } catch { /* fine */ }

  // companies
  const companies = {};
  for (const part of chunks(ids, 100)) {
    const r = await hs(token, '/crm/v3/objects/companies/batch/read', { method: 'POST', body: {
      inputs: part.map(id => ({ id })), properties: ['name', 'domain', 'hubspot_owner_id', 'lifecyclestage', 'notes_last_contacted'] } });
    (r.results || []).forEach(c => { companies[c.id] = c.properties; });
  }

  // which deals / emails / calls / meetings belong to each company
  const assoc = async (to) => {
    const map = {};
    for (const part of chunks(ids, 1000)) {
      const r = await hs(token, `/crm/v4/associations/companies/${to}/batch/read`, { method: 'POST', body: { inputs: part.map(id => ({ id })) } });
      (r.results || []).forEach(x => { map[String(x.from.id)] = (x.to || []).map(t => String(t.toObjectId)); });
    }
    return map;
  };
  const deals = ids.length ? await assoc('deals').catch(e => { warnings.push('Deals could not be read: ' + e.message); return {}; }) : {};
  let engagements = { emails: {}, calls: {}, meetings: {} }, engagementsOk = true;
  if (ids.length) {
    try {
      engagements = { emails: await assoc('emails'), calls: await assoc('calls'), meetings: await assoc('meetings') };
    } catch (e) {
      engagementsOk = false;
      warnings.push(e.code === 'scope'
        ? 'Emails, calls and meetings are hidden: add the "crm.objects.contacts.read" scope to your HubSpot private app.'
        : 'Emails, calls and meetings could not be read: ' + e.message);
    }
  }

  // deal details + pipeline stage names
  const allDealIds = [...new Set(Object.values(deals).flat())];
  const dealProps = {};
  for (const part of chunks(allDealIds, 100)) {
    const r = await hs(token, '/crm/v3/objects/deals/batch/read', { method: 'POST', body: {
      inputs: part.map(id => ({ id })), properties: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline', 'hs_is_closed_won', 'hs_is_closed'] } });
    (r.results || []).forEach(d => { dealProps[d.id] = d.properties; });
  }
  const stages = {}; // stageId -> { label, order, pipeline, won, lost }
  const pipelines = {}; // pipelineId -> ordered labels (without closed-lost)
  if (allDealIds.length) {
    try {
      const r = await hs(token, '/crm/v3/pipelines/deals');
      (r.results || []).forEach(p => {
        const list = (p.stages || []).slice().sort((a, b) => a.displayOrder - b.displayOrder).map(s => {
          const closed = s.metadata && s.metadata.isClosed === 'true';
          const prob = s.metadata ? Number(s.metadata.probability) : NaN;
          const st = { id: s.id, label: s.label, order: s.displayOrder, pipeline: p.id, won: closed && prob === 1, lost: closed && prob === 0 };
          stages[s.id] = st; return st;
        });
        pipelines[p.id] = list.filter(s => !s.lost).map(s => s.label);
      });
    } catch (e) { warnings.push('Deal stage names could not be read: ' + e.message); }
  }

  // the touch log: the most recent few of each type per company
  // (HubSpot IDs grow over time, so the biggest IDs are the newest)
  const log = {};
  if (engagementsOk && ids.length) {
    const PER = 6;
    const newest = list => list.slice().sort((a, b) => (b.length - a.length) || (b > a ? 1 : b < a ? -1 : 0)).slice(0, PER);
    const types = { emails: 'email', calls: 'call', meetings: 'meeting' };
    for (const [obj, type] of Object.entries(types)) {
      const want = {}; // engagement id -> [company ids]
      Object.entries(engagements[obj]).forEach(([cid, list]) => newest(list).forEach(eid => (want[eid] ||= []).push(cid)));
      for (const part of chunks(Object.keys(want), 100)) {
        try {
          const r = await hs(token, `/crm/v3/objects/${obj}/batch/read`, { method: 'POST', body: {
            inputs: part.map(id => ({ id })), properties: ['hs_timestamp', 'hubspot_owner_id'] } });
          (r.results || []).forEach(x => {
            const ts = Date.parse(x.properties.hs_timestamp) || null;
            (want[x.id] || []).forEach(cid => (log[cid] ||= []).push({ type, ts, who: om[x.properties.hubspot_owner_id] || '' }));
          });
        } catch (e) { warnings.push(`Some ${obj} could not be read: ${e.message}`); break; }
      }
    }
  }

  const companyUrl = id => portal.portalId ? `https://${portal.uiDomain}/contacts/${portal.portalId}/company/${id}` : null;

  const accounts = targets.map(t => {
    if (!t.id) {
      const a = { key: t.key, id: null, name: t.name, domain: '', unlinked: true, owner: null, life: '', e: 0, c: 0, m: 0, t: 0, last: null, deal: null, won: null, log: [] };
      return Object.assign(a, classify(a));
    }
    const id = String(t.id), p = companies[id];
    if (!p) { // deleted or merged in HubSpot
      const a = { key: t.key, id: null, name: t.name, domain: '', unlinked: true, owner: null, life: '', e: 0, c: 0, m: 0, t: 0, last: null, deal: null, won: null, log: [], missing: true };
      return Object.assign(a, classify(a));
    }
    const e = engagementsOk ? (engagements.emails[id] || []).length : null;
    const c = engagementsOk ? (engagements.calls[id] || []).length : null;
    const m = engagementsOk ? (engagements.meetings[id] || []).length : null;
    const L = (log[id] || []).filter(x => x.ts).sort((a, b) => b.ts - a.ts);
    const lastTs = Math.max(Date.parse(p.notes_last_contacted) || 0, L[0] ? L[0].ts : 0) || null;

    // deals: the latest closed-won deal makes it green; otherwise show the biggest open deal
    const ds = (deals[id] || []).map(did => ({ id: did, ...(dealProps[did] || {}) })).filter(d => d.dealstage);
    const wonDeals = ds.filter(d => d.hs_is_closed_won === 'true' || (stages[d.dealstage] && stages[d.dealstage].won))
      .sort((a, b) => (Date.parse(b.closedate) || 0) - (Date.parse(a.closedate) || 0));
    const open = ds.filter(d => d.hs_is_closed !== 'true' && !(stages[d.dealstage] && (stages[d.dealstage].won || stages[d.dealstage].lost)))
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    let deal = null, won = null;
    if (open[0]) {
      const st = stages[open[0].dealstage];
      const list = st ? pipelines[st.pipeline] : null;
      deal = { name: open[0].dealname, amount: Number(open[0].amount) || 0, stage: st ? st.label : open[0].dealstage, stages: list || null, idx: list && st ? list.indexOf(st.label) : -1 };
    }
    if (wonDeals[0]) {
      const st = stages[wonDeals[0].dealstage];
      won = { date: Date.parse(wonDeals[0].closedate) || null, amount: Number(wonDeals[0].amount) || null, stages: st ? pipelines[st.pipeline] : null };
    } else if (p.lifecyclestage === 'customer') {
      won = { date: null, amount: null, stages: null };
    }

    const a = {
      key: t.key, id, name: p.name || t.name, domain: p.domain || '', unlinked: false, url: companyUrl(id),
      owner: om[p.hubspot_owner_id] || null,
      life: LIFECYCLE[p.lifecyclestage] || p.lifecyclestage || '',
      e, c, m, t: engagementsOk ? e + c + m : null,
      last: daysSince(lastTs), deal, won,
      log: L.slice(0, 6)
    };
    return Object.assign(a, classify(a));
  });

  return { accounts, warnings, portal };
}
