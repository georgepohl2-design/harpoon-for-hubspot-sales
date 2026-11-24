// The snapshot: one tidy 1200 x 675 picture of the hunt (whales, contacted, won, pipeline, top 5),
// for a 1:1, a sales manager or CRO, or a LinkedIn post. Drawn on a canvas, so it never leaves the computer
// unless you copy or save it.

import { money } from './model.js';
import { logoSVG } from './logo.js';

const C = {
  bg: '#FAF5EA', card: '#FFFDF8', ink: '#1F1A2E', muted: '#686175', line: '#E9E2D5', violet: '#6E3BD8',
  won: '#178A4C', amber: '#B06A00', red: '#D23B3B', grey: '#A39CA8'
};
const DOT = { won: C.won, amber: C.amber, red: C.red, grey: C.grey };
const W = 1200, H = 675, PAD = 56;

let logoImg = null;
function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { logoImg = img; res(img); };
    img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSVG(false, 'width="240" height="240"'));
  });
}

function round(ctx, x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
const stageOf = a => a.s === 'won' ? 'Closed won' : a.s === 'grey' ? 'Not linked yet' : a.deal ? a.deal.stage : a.s === 'red' ? 'Not contacted yet' : 'No deal yet';

/** Draws the snapshot. hideNames swaps company names for "Whale #n", for posting in public. */
export async function drawSnapshot(canvas, accounts, S, { hideNames = false, demo = false } = {}) {
  try { await document.fonts.ready; } catch { /* fine */ }
  const logo = await loadLogo();
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  const display = 'Fredoka, "Avenir Next Rounded", system-ui, sans-serif';
  const body = 'Inter, system-ui, -apple-system, sans-serif';

  const N = accounts.length, count = s => accounts.filter(a => a.s === s).length;
  const won = count('won'), amber = count('amber'), red = count('red'), grey = count('grey');
  const pipe = accounts.filter(a => a.s === 'amber' && a.deal).reduce((n, a) => n + (a.deal.amount || 0), 0);
  const wonAmt = accounts.filter(a => a.s === 'won' && a.won).reduce((n, a) => n + (a.won.amount || 0), 0);
  const contacted = N ? Math.round((won + amber) / N * 100) : 0;
  const solo = S.hunting === 'solo';

  // background
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // header: logo, name, date
  if (logo) ctx.drawImage(logo, PAD - 6, 34, 76, 76);
  ctx.fillStyle = C.violet; ctx.font = `700 36px ${display}`; ctx.textBaseline = 'middle';
  ctx.fillText('Harpoon', PAD + 80, 72);
  ctx.fillStyle = C.muted; ctx.font = `500 18px ${body}`; ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + (demo ? ' · demo data' : ''), W - PAD, 72);
  ctx.textAlign = 'left';

  // title
  ctx.fillStyle = C.ink; ctx.font = `600 42px ${display}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText(solo ? 'My whales this week' : 'Our whales this week', PAD, 170);

  // stat cards
  const stats = [
    ['Whales to hunt', String(N)],
    ['Contacted', contacted + '%'],
    ['Won', `${won}${wonAmt ? ' · ' + money(wonAmt, S.currency) : ''}`],
    ['Open pipeline', money(pipe, S.currency) || S.currency + '0']
  ];
  const gap = 16, cw = (W - PAD * 2 - gap * 3) / 4;
  stats.forEach(([k, v], i) => {
    const x = PAD + i * (cw + gap), y = 196;
    round(ctx, x, y, cw, 108, 18, C.card);
    ctx.fillStyle = C.muted; ctx.font = `600 17px ${body}`; ctx.fillText(k, x + 20, y + 36);
    ctx.fillStyle = C.ink; ctx.font = `600 40px ${display}`; ctx.fillText(fit(ctx, v, cw - 40), x + 20, y + 86);
  });

  // status bar: won / being contacted / not contacted / not linked
  const by = 326, bw = W - PAD * 2;
  round(ctx, PAD, by, bw, 14, 7, C.line);
  ctx.save(); ctx.beginPath(); ctx.roundRect(PAD, by, bw, 14, 7); ctx.clip();
  let x = PAD;
  [[won, C.won], [amber, C.amber], [red, C.red], [grey, C.grey]].forEach(([n, col]) => { if (!N || !n) return; const w = bw * n / N; ctx.fillStyle = col; ctx.fillRect(x, by, w, 14); x += w; });
  ctx.restore();
  ctx.font = `500 15px ${body}`; ctx.textBaseline = 'middle';
  let lx = PAD;
  [[`${won} won`, C.won], [`${amber} being contacted`, C.amber], [`${red} not contacted yet`, C.red]].forEach(([t, col]) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx + 6, by + 34, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.muted; ctx.fillText(t, lx + 18, by + 35); lx += ctx.measureText(t).width + 44;
  });

  // top 5 whales
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.muted; ctx.font = `700 14px ${body}`;
  ctx.fillText('TOP WHALES', PAD, 412);
  const top = accounts.slice(0, 5);
  top.forEach((a, i) => {
    const y = 432 + i * 40;
    round(ctx, PAD, y, W - PAD * 2, 34, 10, C.card);
    ctx.fillStyle = DOT[a.s] || C.grey; ctx.beginPath(); ctx.arc(PAD + 20, y + 17, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.muted; ctx.font = `700 15px ${body}`; ctx.textBaseline = 'middle';
    ctx.fillText('#' + (i + 1), PAD + 36, y + 18);
    ctx.fillStyle = C.ink; ctx.font = `600 18px ${body}`;
    ctx.fillText(fit(ctx, hideNames ? `Whale #${i + 1}` : a.name, 560), PAD + 80, y + 18);
    ctx.textAlign = 'right'; ctx.fillStyle = C.muted; ctx.font = `500 16px ${body}`;
    const amt = a.s === 'won' && a.won && a.won.amount ? money(a.won.amount, S.currency) : a.deal && a.deal.amount ? money(a.deal.amount, S.currency) : '';
    ctx.fillText(stageOf(a) + (amt ? ' · ' + amt : ''), W - PAD - 18, y + 18);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });

  // footer
  ctx.fillStyle = C.muted; ctx.font = `500 15px ${body}`;
  ctx.fillText('Made with Harpoon · free for HubSpot', PAD, H - 24);
  ctx.textAlign = 'right'; ctx.fillText('github.com/georgepohl2-design/harpoon-for-hubspot-sales', W - PAD, H - 24); ctx.textAlign = 'left';
}

export function snapshotBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
