/* Bir Festival Ops Console — vanilla, no build. Username/password admin auth
   with a 4-tier hierarchy; talks only to the admin API (/admin/*). */
'use strict';
const CFG = window.BIR_CONFIG;
const SESSION_KEY = 'bir.admin.session.v2';
const TIER_NAMES = { 1: 'Superadmin', 2: 'Admin', 3: 'Manager', 4: 'Coordinator' };
const CAPS = {
  'analytics.read': [1, 2, 3, 4], 'faq.write': [1, 2, 3],
  'pass.revoke': [1, 2], 'flystatus.set': [1, 2], 'admin.manage': [1, 2, 3],
};
const state = { token: null, admin: null };

/* helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const cap = (c) => state.admin && (CAPS[c] || []).includes(state.admin.tier);
const canManageTier = (t) => state.admin && (state.admin.tier === 1 ? t >= 1 : t > state.admin.tier);
function toast(msg, kind = '') {
  const t = $('#toast'); t.className = 'toast ' + kind; t.textContent = msg;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3400);
}
function decodeJwt(tok) {
  try { const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(p + '==='.slice((p.length + 3) % 4))))); } catch { return null; }
}
function fmtTime(s) {
  if (!s) return '—';
  try { return new Date(s * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(s); }
}

/* API */
async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (state.token) opt.headers.authorization = 'Bearer ' + state.token;
  if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(CFG.restBase + path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && state.token) { signOut('Your session expired — please sign in again.'); throw new Error('session expired'); }
  if (!r.ok) throw new Error(j.detail || j.error || `${method} ${path} → ${r.status}`);
  return j;
}

/* auth */
function persist() { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, admin: state.admin })); } catch {} }
function loginError(msg) { const e = $('#login-error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault(); loginError('');
  const b = $('#do-login'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const j = await api('POST', '/admin/auth/login', { username: $('#username').value.trim(), password: $('#password').value });
    state.token = j.token; state.admin = { ...j.admin, tier: Number(j.admin.tier) }; persist(); enterApp();
  } catch (e) { loginError(e.message === 'session expired' ? 'Please try again.' : e.message); }
  finally { b.disabled = false; b.textContent = 'Sign in'; }
});
$('#show-bootstrap').addEventListener('click', () => { $('#login-form').classList.add('hidden'); $('#bootstrap-form').classList.remove('hidden'); loginError(''); });
$('#bs-back').addEventListener('click', () => { $('#bootstrap-form').classList.add('hidden'); $('#login-form').classList.remove('hidden'); loginError(''); });
$('#bootstrap-form').addEventListener('submit', async (ev) => {
  ev.preventDefault(); loginError('');
  const b = $('#do-bootstrap'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Creating…';
  try {
    await api('POST', '/admin/auth/bootstrap', { username: $('#bs-username').value.trim(), password: $('#bs-password').value, name: $('#bs-name').value.trim() });
    const j = await api('POST', '/admin/auth/login', { username: $('#bs-username').value.trim(), password: $('#bs-password').value });
    state.token = j.token; state.admin = { ...j.admin, tier: Number(j.admin.tier) }; persist(); enterApp();
  } catch (e) { loginError(e.message); }
  finally { b.disabled = false; b.textContent = 'Create & sign in'; }
});

function signOut(msg) {
  state.token = null; state.admin = null;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  $('#bootstrap-form').classList.add('hidden'); $('#login-form').classList.remove('hidden');
  $('#password').value = ''; loginError(msg || '');
}
$('#signout').addEventListener('click', () => signOut());

/* shell */
function enterApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#who').textContent = `${state.admin.name || state.admin.username} · ${TIER_NAMES[state.admin.tier]}`;
  // hide panels the tier can't use
  $$('.nav-item').forEach((b) => {
    const v = b.dataset.view;
    const hidden = (v === 'admins' && !cap('admin.manage'));
    b.style.display = hidden ? 'none' : '';
  });
  refreshFlyChip(); setView('overview');
}
$('#refresh').addEventListener('click', () => setView(currentView));
$$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let currentView = 'overview';
const TITLES = {
  overview: 'Overview', visitors: 'Visitors & tickets', stalls: 'Stalls', lodging: 'Lodging',
  volunteers: 'Volunteers', incidents: 'Incidents', fly: 'Fly-status', kb: 'Knowledge & AI',
  passes: 'Passes', admins: 'Admins', reference: 'Schedule & tiers',
};
async function setView(name) {
  currentView = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#crumb').textContent = TITLES[name] || name;
  const v = $('#view'); v.innerHTML = '<p class="empty"><span class="spinner"></span> Loading…</p>';
  try { await VIEWS[name](v); } catch (e) { v.innerHTML = `<div class="card"><h3>Couldn't load</h3><p class="hint">${esc(e.message)}</p></div>`; }
}
async function refreshFlyChip() {
  try { const s = await api('GET', '/admin/summary'); const f = s.fly; const c = $('#fly-chip'); c.className = 'chip ' + (f ? f.state : ''); c.textContent = 'fly-status: ' + (f ? f.state : '—'); } catch {}
}

/* ---------------------------------- views --------------------------------- */
const VIEWS = {};

VIEWS.overview = async (v) => {
  const s = await api('GET', '/admin/summary');
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Fly-status', s.fly ? s.fly.state : '—', s.fly && s.fly.refundsAutoQueued ? 'refunds auto-queued' : 'official call', s.fly ? s.fly.state : '')}
      ${kpiCard('Registrations', s.registrations.total, `${s.registrations.needLodging} need lodging`)}
      ${kpiCard('Ticket revenue', inr(s.orders.revenueInr), `${s.orders.confirmed} confirmed · ${s.orders.pending} pending`)}
      ${kpiCard('Gate scans', s.engagement.scans, `${s.content.revocations} passes revoked`)}
    </div>
    <div class="grid g-4" style="margin-top:16px">
      ${kpiCard('Stalls', s.stalls.total, `${s.stalls.paid}/${s.stalls.total} fees paid`)}
      ${kpiCard('Lodging rooms', s.lodging.rooms, `${s.lodging.capacity} beds · ${s.lodging.hotels} hotels`)}
      ${kpiCard('Volunteers', s.volunteers.total, `${s.volunteers.idVerified} ID-verified · ${s.volunteers.shifts} shifts`)}
      ${kpiCard('Incidents', s.incidents.total, `${s.content.faqs} FAQs · ${s.content.schedule} events`)}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card">
        <div class="section-title">Registrations by status</div>
        ${bars(Object.entries(s.registrations.byStatus).map(([k, n]) => ({ label: k, value: n })), 'pine')}
      </div>
      <div class="card">
        <div class="section-title">Quick actions</div>
        <p class="hint" style="margin-bottom:10px">${cap('flystatus.set') ? 'Set the official fly-status — fans out to every device.' : 'Fly-status is read-only for your tier.'}</p>
        <div class="fly-btns">
          ${['flying', 'hold', 'closed'].map((st) => `<button class="fly-btn ${st} ${s.fly && s.fly.state === st ? 'on' : ''}" data-fly="${st}" ${cap('flystatus.set') ? '' : 'disabled'}>${st.toUpperCase()}</button>`).join('')}
        </div>
        <div class="stack" style="margin-top:14px">
          <input id="ov-ask" placeholder="Ask the assistant what a visitor would…">
          <button class="btn primary" id="ov-ask-btn">Ask</button>
          <div id="ov-reply"></div>
        </div>
      </div>
    </div>`;
  wireFlyButtons(v);
  $('#ov-ask-btn').addEventListener('click', () => runAsk($('#ov-ask').value, $('#ov-reply')));
  $('#ov-ask').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk($('#ov-ask').value, $('#ov-reply')); });
};

VIEWS.visitors = async (v) => {
  const d = await api('GET', '/admin/visitors');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Registrations', d.registrations.total, 'across all activities')}
      ${kpiCard('Tickets confirmed', d.tickets.confirmed, `${d.tickets.total} orders total`)}
      ${kpiCard('Ticket revenue', inr(d.tickets.revenueInr), 'confirmed orders')}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="section-title">Registrations by activity</div>${d.registrations.byItem.length ? bars(d.registrations.byItem.map((x) => ({ label: x.item, value: x.total })), 'slate') : '<p class="empty">No registrations yet.</p>'}</div>
      <div class="card"><div class="section-title">Registration status</div>${bars(Object.entries(d.registrations.byStatus).map(([k, n]) => ({ label: k, value: n })), 'pine')}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Ticket sales by tier</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Tier</th><th>Sold</th><th>Revenue</th></tr></thead><tbody>
        ${d.tickets.byTier.length ? d.tickets.byTier.map((t) => `<tr><td>${esc(t.tier)}</td><td class="mono">${t.count}</td><td class="mono">${inr(t.revenueInr)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">No confirmed ticket orders yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.stalls = async (v) => {
  const d = await api('GET', '/admin/stalls'); const st = d.items;
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Stalls', st.length, `${st.filter((s) => s.paid).length} fees paid`)}
      ${kpiCard('Est. orders (3 days)', st.reduce((n, s) => n + s.ordersEstimate, 0).toLocaleString('en-IN'), 'across all stalls')}
      ${kpiCard('Fees billed', inr(st.reduce((n, s) => n + s.feeInr, 0)), `${st.filter((s) => !s.paid).length} unpaid`)}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Food street (${st.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Stall</th><th>Category</th><th>Stage</th><th>Allocation</th><th>Fee</th><th>Est. orders</th><th>Footfall</th></tr></thead><tbody>
        ${st.length ? st.map((s) => `<tr><td>${esc(s.stallName)}</td><td>${esc(s.category || '')}</td><td><span class="pill ${s.stage === 'approved' ? 'good' : 'info'}">${esc(s.stage || '—')}</span></td><td class="mono">${esc(s.allocationLabel || '')}</td><td class="mono">${inr(s.feeInr)} ${s.paid ? '<span class="pill good">paid</span>' : '<span class="pill bad">due</span>'}</td><td class="mono">${s.ordersEstimate.toLocaleString('en-IN')}</td><td>${footfallBar(s.footfallIndex)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No stalls.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.lodging = async (v) => {
  const d = await api('GET', '/admin/lodging');
  const comp = d.partners.reduce((n, p) => n + p.complimentaryRooms, 0);
  const checkedIn = d.partners.reduce((n, p) => n + p.checkedIn, 0);
  const alloc = d.partners.reduce((n, p) => n + p.allocations, 0);
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Rooms', d.hotels.reduce((n, h) => n + h.rooms, 0), `${d.hotels.reduce((n, h) => n + h.capacity, 0)} beds · ${d.hotels.length} hotels`)}
      ${kpiCard('Need lodging', d.pool.needLodging, `of ${d.pool.total} registrants`)}
      ${kpiCard('Complimentary', comp, 'partner rooms')}
      ${kpiCard('Checked in', checkedIn, `of ${alloc} allocations`)}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="section-title">Beds by hotel</div>${bars(d.hotels.map((h) => ({ label: h.hotel, value: h.capacity })), 'mar')}</div>
      <div class="card"><div class="section-title">Hospitality partners</div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Hotel</th><th>Comp.</th><th>Allocated</th><th>Checked in</th></tr></thead><tbody>
          ${d.partners.length ? d.partners.map((p) => `<tr><td>${esc(p.hotelName || '')}</td><td class="mono">${p.complimentaryRooms}</td><td class="mono">${p.allocations}</td><td class="mono">${p.checkedIn}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No partners.</td></tr>'}
        </tbody></table></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Room inventory</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Hotel</th><th>Rooms</th><th>Beds</th><th>Active</th></tr></thead><tbody>
        ${d.hotels.map((h) => `<tr><td>${esc(h.hotel)}</td><td class="mono">${h.rooms}</td><td class="mono">${h.capacity}</td><td class="mono">${h.active}/${h.rooms}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
};

VIEWS.volunteers = async (v) => {
  const d = await api('GET', '/admin/volunteers');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Volunteers', d.total, `${d.idVerified} ID-verified`)}
      ${kpiCard('Shifts assigned', d.items.reduce((n, x) => n + x.shifts, 0), 'across the roster')}
      ${kpiCard('Attendance records', d.attendanceRecords, 'check-ins logged')}
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Roster (${d.total})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th><th>Team</th><th>Shifts</th><th>ID verified</th></tr></thead><tbody>
        ${d.items.length ? d.items.map((x) => `<tr><td>${esc(x.name || '')}</td><td>${esc(x.team || '')}</td><td class="mono">${x.shifts}</td><td>${x.idVerified ? '<span class="pill good">yes</span>' : '<span class="pill">no</span>'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No volunteers.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.incidents = async (v) => {
  const d = await api('GET', '/admin/incidents');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Incidents', d.total, 'reported from the field')}
      ${kpiCard('Categories', Object.keys(d.byCategory).length, 'distinct types')}
      ${kpiCard('Latest', d.items[0] ? fmtTime(d.items[0].ts) : '—', d.items[0] ? esc(d.items[0].zone || '') : 'none yet')}
    </div>
    ${Object.keys(d.byCategory).length ? `<div class="card" style="margin-top:16px"><div class="section-title">By category</div>${bars(Object.entries(d.byCategory).map(([k, n]) => ({ label: k, value: n })), 'slate')}</div>` : ''}
    <div class="card" style="margin-top:16px"><div class="section-title">Incident log</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Category</th><th>Zone</th><th>Note</th></tr></thead><tbody>
        ${d.items.length ? d.items.map((i) => `<tr><td class="mono">${fmtTime(i.ts)}</td><td><span class="pill info">${esc(i.category || '')}</span></td><td>${esc(i.zone || '')}</td><td>${esc(i.note || '')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No incidents reported — all clear.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.fly = async (v) => {
  const s = await api('GET', '/admin/summary'); const fly = s.fly;
  const tone = fly ? { flying: 'good', hold: 'warn', closed: 'bad' }[fly.state] : '';
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Current</div>
        <div class="stat"><span class="k">State</span><span class="v"${tone ? ` style="color:var(--${tone})"` : ''}>${fly ? fly.state : '—'}</span></div>
        <p class="mono" style="color:var(--faint);font-size:12px;margin-top:8px">updated ${fly ? fmtTime(fly.updatedAt) : '—'}${fly && fly.refundsAutoQueued ? ' · refunds auto-queued' : ''}</p>
      </div>
      <div class="card">
        <div class="section-title">Declare</div>
        ${cap('flystatus.set') ? `<div class="stack">
          <label class="field"><span>Reason (English)</span><input id="fly-en" placeholder="e.g. High winds at Billing"></label>
          <label class="field"><span>Reason (Hindi)</span><input id="fly-hi" placeholder="बिलिंग में तेज़ हवाएँ"></label>
          <div class="fly-btns">${['flying', 'hold', 'closed'].map((st) => `<button class="fly-btn ${st}" data-fly="${st}">${st.toUpperCase()}</button>`).join('')}</div>
          <p class="hint">Closing flying auto-queues refunds and fans the status out to every device.</p>
        </div>` : '<p class="hint">Only <b>Superadmin</b> and <b>Admin</b> tiers can declare fly-status.</p>'}
      </div>
    </div>`;
  wireFlyButtons(v);
};

VIEWS.kb = async (v) => {
  const d = await api('GET', '/admin/faq'); const faqs = d.items || [];
  const writable = cap('faq.write');
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Add / update FAQ</div>
        <div class="stack">
          <label class="field"><span>Question</span><input id="faq-q" placeholder="Where can I park?" ${writable ? '' : 'disabled'}></label>
          <label class="field"><span>Answer</span><textarea id="faq-a" placeholder="Paid parking at the Billing landing field; free shuttle every 20 min." ${writable ? '' : 'disabled'}></textarea></label>
          <input id="faq-id" type="hidden">
          <div class="row"><button class="btn primary" id="faq-save" ${writable ? '' : 'disabled'}>Save FAQ</button><button class="btn ghost" id="faq-clear">Clear</button></div>
          <p class="hint">${writable ? 'FAQs take effect on the next question — no deploy.' : 'Your tier can view but not edit FAQs.'}</p>
        </div>
      </div>
      <div class="card">
        <div class="section-title">Test the assistant</div>
        <div class="stack"><input id="kb-ask" placeholder="Ask what a visitor would ask…"><button class="btn primary" id="kb-ask-btn">Ask</button><div id="kb-reply"></div></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Live FAQs (${faqs.length})</div>
      <div id="faq-list" class="grid" style="gap:10px">${faqs.length ? faqs.map((f) => faqCard(f, writable)).join('') : '<p class="empty">No FAQs yet.</p>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Knowledge base documents</div>
      <p class="hint">Drop festival rules &amp; instructions (Markdown / text) into the knowledge bucket — the assistant ingests and cites them automatically.</p>
      <div class="codebox" style="margin-top:10px">aws s3 cp festival-rules.md s3://${esc(CFG.kbBucket)}/kb/festival-rules.md --profile rhoai-demo</div>
    </div>`;
  if (writable) {
    $('#faq-save').addEventListener('click', saveFaq);
    $('#faq-clear').addEventListener('click', () => { $('#faq-q').value = ''; $('#faq-a').value = ''; $('#faq-id').value = ''; });
    wireFaqCards(v);
  }
  $('#kb-ask-btn').addEventListener('click', () => runAsk($('#kb-ask').value, $('#kb-reply')));
  $('#kb-ask').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk($('#kb-ask').value, $('#kb-reply')); });
};

VIEWS.passes = async (v) => {
  const d = await api('GET', '/admin/revocations'); const revs = d.items || [];
  const canRev = cap('pass.revoke');
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Revoke a pass</div>
        <div class="stack">
          <label class="field"><span>Pass ID (jti)</span><input id="rev-jti" placeholder="the pass jti to revoke" ${canRev ? '' : 'disabled'}></label>
          <button class="btn danger" id="rev-btn" ${canRev ? '' : 'disabled'}>Revoke pass</button>
          <p class="hint">Revoking fans out to every device; the offline gate scanner rejects it on next sync.${canRev ? '' : ' <b>Your tier can view but not revoke.</b>'}</p>
        </div>
      </div>
      <div class="card"><div class="stat"><span class="k">Revoked passes</span><span class="v">${revs.length}</span></div><p class="hint" style="margin-top:8px">Total in the revocation feed devices pull.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Revocation feed</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Pass jti</th><th>Revoked</th><th>By</th></tr></thead><tbody>
        ${revs.length ? revs.map((r) => `<tr><td class="mono">${esc(r.jti)}</td><td>${fmtTime(r.revokedAt)}</td><td class="mono">${esc(r.revokedBy || '')}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">No revoked passes.</td></tr>'}
      </tbody></table></div>
    </div>`;
  if (canRev) $('#rev-btn').addEventListener('click', async () => {
    const jti = $('#rev-jti').value.trim(); if (!jti) return;
    const b = $('#rev-btn'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Revoking…';
    try { await api('POST', '/admin/revoke', { jti }); toast('Pass revoked — fanning out to devices', 'good'); setView('passes'); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Revoke pass'; }
  });
};

VIEWS.admins = async (v) => {
  if (!cap('admin.manage')) { v.innerHTML = '<div class="card"><h3>Not available</h3><p class="hint">Your tier cannot manage admins.</p></div>'; return; }
  const d = await api('GET', '/admin/admins');
  const tierOpts = [1, 2, 3, 4].filter((t) => canManageTier(t)).map((t) => `<option value="${t}">Tier ${t} · ${TIER_NAMES[t]}</option>`).join('');
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  d.admins.forEach((a) => byTier[a.tier].push(a));
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Create admin</div>
        <div class="stack">
          <label class="field"><span>Full name</span><input id="na-name" placeholder="e.g. Priya Sharma"></label>
          <label class="field"><span>Username</span><input id="na-user" autocapitalize="none" spellcheck="false" placeholder="priya"></label>
          <label class="field"><span>Tier</span><select id="na-tier">${tierOpts}</select></label>
          <label class="field"><span>Temporary password (min 8)</span><input id="na-pw" type="text" placeholder="they can change it later"></label>
          <button class="btn primary" id="na-create">Create admin</button>
          <p class="hint">You can create admins below your tier${state.admin.tier === 1 ? ' (and other Superadmins)' : ''}. Give them the username + this password.</p>
        </div>
      </div>
      <div class="card">
        <div class="section-title">The hierarchy</div>
        <div class="hier">
          ${[1, 2, 3, 4].map((t) => `<div class="hier-row"><span class="tier-badge t${t}">T${t}</span><b>${TIER_NAMES[t]}</b><span class="hier-count">${byTier[t].length}</span></div><p class="hier-caps">${tierCaps(t)}</p>`).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Admins (${d.admins.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Username</th><th>Name</th><th>Tier</th><th>Status</th><th>Created by</th><th>Actions</th></tr></thead><tbody>
        ${d.admins.sort((a, b) => a.tier - b.tier).map(adminRow).join('')}
      </tbody></table></div>
    </div>`;
  $('#na-create').addEventListener('click', createAdmin);
  wireAdminRows(v);
};

/* -------------------------------- helpers -------------------------------- */
function kpiCard(k, val, sub = '', flyCls = '') {
  const color = { flying: 'good', hold: 'warn', closed: 'bad' }[flyCls];
  const big = String(val).length > 7;
  return `<div class="card kpi"><span class="k">${esc(k)}</span><span class="v"${color ? ` style="color:var(--${color})"` : ''}${big ? ' style="font-size:1.4rem"' : ''}>${esc(val)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
}
function bars(data, tone = 'pine') {
  const rows = data.filter((d) => d.value != null); if (!rows.length) return '<p class="empty">No data.</p>';
  const max = Math.max(...rows.map((d) => d.value), 1);
  return `<div class="bars">${rows.map((d) => `<div class="bar-row"><span class="lbl">${esc(d.label)}</span><span class="bar-track"><span class="bar-fill ${tone}" style="width:${Math.max(3, Math.round((d.value / max) * 100))}%"></span></span><span class="num">${Number(d.value).toLocaleString('en-IN')}</span></div>`).join('')}</div>`;
}
function footfallBar(pct) {
  const p = Math.max(0, Math.min(100, pct || 0)); const tone = p >= 80 ? 'mar' : p >= 50 ? '' : 'slate';
  return `<span class="bar-track" style="display:inline-block;width:64px;vertical-align:middle"><span class="bar-fill ${tone}" style="width:${p}%"></span></span> <span class="mono">${p}</span>`;
}
function tierCaps(t) {
  const c = Object.entries(CAPS).filter(([, ts]) => ts.includes(t)).map(([k]) => ({ 'analytics.read': 'monitoring', 'faq.write': 'knowledge & FAQ', 'pass.revoke': 'revoke passes', 'flystatus.set': 'fly-status', 'admin.manage': 'manage lower tiers' }[k]));
  return c.join(' · ');
}
function faqCard(f, writable) {
  return `<div class="faq" data-id="${esc(f.id)}"><div class="q">${esc(f.question)}</div><div class="a">${esc(f.answer)}</div>${writable ? '<div class="faq-actions"><button class="btn ghost sm faq-edit">Edit</button><button class="btn ghost sm faq-del">Delete</button></div>' : ''}</div>`;
}
function wireFaqCards(root) {
  $$('.faq', root).forEach((card) => {
    const id = card.dataset.id;
    const edit = card.querySelector('.faq-edit'); const del = card.querySelector('.faq-del');
    if (edit) edit.addEventListener('click', () => { $('#faq-id').value = id; $('#faq-q').value = card.querySelector('.q').textContent; $('#faq-a').value = card.querySelector('.a').textContent; window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (del) del.addEventListener('click', async () => { if (!confirm('Delete this FAQ?')) return; try { await api('DELETE', '/admin/faq/' + encodeURIComponent(id)); toast('FAQ deleted', 'good'); setView('kb'); } catch (e) { toast(e.message, 'bad'); } });
  });
}
async function saveFaq() {
  const question = $('#faq-q').value.trim(); const answer = $('#faq-a').value.trim(); const id = $('#faq-id').value.trim();
  if (!question || !answer) return toast('Question and answer are required', 'bad');
  const b = $('#faq-save'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Saving…';
  try { await api('POST', '/admin/faq', id ? { id, question, answer } : { question, answer }); toast('FAQ saved — live now', 'good'); setView('kb'); }
  catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Save FAQ'; }
}
function wireFlyButtons(root) {
  $$('.fly-btn', root).forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', async () => {
      const s = btn.dataset.fly;
      if (s === 'closed' && !confirm('Close flying? This auto-queues refunds for affected bookings.')) return;
      const en = ($('#fly-en') && $('#fly-en').value.trim()) || defaultReason(s, 'en');
      const hi = ($('#fly-hi') && $('#fly-hi').value.trim()) || defaultReason(s, 'hi');
      btn.disabled = true;
      try { await api('POST', '/admin/fly', { state: s, reasonEn: en, reasonHi: hi }); toast(`Fly-status set to ${s} — fanning out`, 'good'); refreshFlyChip(); setView(currentView); }
      catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    });
  });
}
function defaultReason(s, lang) {
  const m = { flying: { en: 'Clear skies over Billing', hi: 'बिलिंग के ऊपर साफ़ आसमान' }, hold: { en: 'Conditions under review', hi: 'परिस्थितियों की समीक्षा जारी' }, closed: { en: 'Flying closed for safety', hi: 'सुरक्षा के लिए उड़ान बंद' } };
  return m[s][lang];
}
async function runAsk(message, target) {
  message = (message || '').trim(); if (!message) return;
  target.innerHTML = '<p class="hint"><span class="spinner"></span> Thinking…</p>';
  try { const r = await api('POST', '/admin/ask', { message }); target.innerHTML = `${r.grounded ? '<span class="pill good">grounded in KB</span>' : '<span class="pill">general</span>'}<div class="reply" style="margin-top:8px">${esc(r.reply)}</div>`; }
  catch (e) { target.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

/* admins panel */
function adminRow(a) {
  const acts = a.manageable
    ? `<button class="btn ghost sm ad-pw" data-u="${esc(a.username)}">Reset password</button>
       <button class="btn ghost sm ad-active" data-u="${esc(a.username)}" data-active="${a.active}">${a.active ? 'Disable' : 'Enable'}</button>
       <button class="btn ghost sm ad-del" data-u="${esc(a.username)}">Delete</button>`
    : (a.username === state.admin.username ? '<span class="pill info">you</span>' : '<span class="pill">—</span>');
  return `<tr>
    <td class="mono">${esc(a.username)}</td><td>${esc(a.name || '')}</td>
    <td><span class="tier-badge t${a.tier}">T${a.tier}</span> ${esc(a.tierName || TIER_NAMES[a.tier])}</td>
    <td>${a.active ? '<span class="pill good">active</span>' : '<span class="pill bad">disabled</span>'}</td>
    <td class="mono">${esc(a.createdBy || '')}</td><td><div class="row wrap">${acts}</div></td>
  </tr>`;
}
function wireAdminRows(root) {
  $$('.ad-pw', root).forEach((b) => b.addEventListener('click', async () => {
    const pw = prompt(`New password for ${b.dataset.u} (min 8 chars):`); if (!pw) return;
    try { await api('POST', `/admin/admins/${encodeURIComponent(b.dataset.u)}/password`, { password: pw }); toast('Password reset', 'good'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
  $$('.ad-active', root).forEach((b) => b.addEventListener('click', async () => {
    const active = b.dataset.active !== 'true';
    try { await api('POST', `/admin/admins/${encodeURIComponent(b.dataset.u)}/active`, { active }); toast(active ? 'Enabled' : 'Disabled', 'good'); setView('admins'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
  $$('.ad-del', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete admin ${b.dataset.u}? This cannot be undone.`)) return;
    try { await api('DELETE', `/admin/admins/${encodeURIComponent(b.dataset.u)}`); toast('Admin deleted', 'good'); setView('admins'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
}
async function createAdmin() {
  const name = $('#na-name').value.trim(); const username = $('#na-user').value.trim();
  const tier = Number($('#na-tier').value); const password = $('#na-pw').value;
  if (!username || password.length < 8) return toast('Username and a password (min 8) are required', 'bad');
  const b = $('#na-create'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Creating…';
  try { await api('POST', '/admin/admins', { name, username, tier, password }); toast(`${TIER_NAMES[tier]} "${username}" created`, 'good'); setView('admins'); }
  catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Create admin'; }
}

/* boot */
(function boot() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.token) {
      const c = decodeJwt(s.token);
      if (c && c.exp * 1000 > Date.now()) { state.token = s.token; state.admin = { ...s.admin, tier: Number(s.admin.tier) }; enterApp(); return; }
    }
  } catch {}
  $('#login').classList.remove('hidden');
})();
