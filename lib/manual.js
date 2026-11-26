// Manual mode: no CRM needed. You keep each whale's status, owner, deal value and deal stage up to date
// yourself, right on the board. Stored in this Chrome only (storage key 'manual': the list, in priority order).
// Used by the board page and by the background scheduler (for the Slack notification).

// HubSpot's default sales pipeline (the open stages), so a manual board talks the same language
// as HubSpot if you connect it later. You can change them in Settings to match how your team works.
export const HUBSPOT_STAGES = ['Appointment scheduled', 'Qualified to buy', 'Presentation scheduled', 'Decision maker bought-in', 'Contract sent'];

export const MANUAL_STATUS = ['won', 'amber', 'red']; // Won, Being contacted, Not contacted (no "Not linked" without a CRM)

/** One saved manual record ({ key, name, s, heat, owner, amount, stage, wonAt }) as a board account.
 *  heat: 'hot' (talking a lot) or 'cold' (contacted, but gone quiet), only while it's being contacted. */
export function manualAccount(r, stages) {
  const s = MANUAL_STATUS.includes(r.s) ? r.s : 'red';
  const amount = Number(r.amount) || null;
  const list = stages && stages.length ? stages : HUBSPOT_STAGES;
  const owner = String(r.owner || '').trim() || null;
  const a = {
    key: r.key, id: null, name: r.name, domain: '', url: null, unlinked: false, manual: true,
    owner, life: '', e: null, c: null, m: null, t: null, last: null, // no touch data without a CRM
    deal: null, won: null, log: [], s, why: null,
    heat: s === 'amber' && (r.heat === 'hot' || r.heat === 'cold') ? r.heat : ''
  };
  if (s === 'red') a.why = owner ? 'nocontact' : 'noowner';
  if (s === 'amber' && (amount || r.stage)) a.deal = { amount: amount || 0, stage: r.stage || '', stages: list, idx: list.indexOf(r.stage) };
  if (s === 'won') a.won = { date: r.wonAt || null, amount, stages: null };
  return a;
}

export const manualAccounts = (list, S) => (list || []).map(r => manualAccount(r, S && S.stages));

export const newManualKey = () => 'm:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
