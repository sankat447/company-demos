/* Bir Festival Ops Console — vanilla, no build. Username/password admin auth
   with a 4-tier hierarchy; talks only to the admin API (/admin/*). */
'use strict';
const CFG = window.BIR_CONFIG;
const SESSION_KEY = 'bir.admin.session.v2';
const TIER_NAMES = { 1: 'Superadmin', 2: 'Admin', 3: 'Manager', 4: 'Coordinator' };
const CAPS = {
  'analytics.read': [1, 2, 3, 4], 'admin.manage': [1, 2, 3],
  'faq.write': [1, 2, 3], 'pass.revoke': [1, 2], 'flystatus.set': [1, 2],
  'schedule.manage': [1, 2, 3], 'stalls.manage': [1, 2, 3], 'lodging.manage': [1, 2, 3],
  'volunteers.manage': [1, 2, 3], 'incidents.manage': [1, 2, 3, 4], 'announce.write': [1, 2],
  'pricing.manage': [1, 2], 'orders.manage': [1, 2], 'users.manage': [1, 2], 'catalog.manage': [1, 2, 3],
  'wristband.manage': [1, 2, 3, 4], 'audit.read': [1, 2],
};
const ROLE_GROUPS = ['partner', 'volunteer', 'organiser-lite', 'admin-hospitality', 'safety-officer'];
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
  // hide panels the tier can't use (write-only panels stay hidden for read-only
  // tiers; every tier keeps the monitor + incident-triage views)
  const GATE = { admins: 'admin.manage', schedule: 'schedule.manage', announce: 'announce.write', pricing: 'pricing.manage', orders: 'orders.manage', refunds: 'orders.manage', people: 'users.manage', catalog: 'catalog.manage', wristbands: 'wristband.manage', audit: 'audit.read' };
  $$('.nav-item').forEach((b) => {
    const need = GATE[b.dataset.view];
    b.style.display = need && !cap(need) ? 'none' : '';
  });
  refreshFlyChip(); setView('overview');
}
$('#refresh').addEventListener('click', () => setView(currentView));
$$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let currentView = 'overview';
const TITLES = {
  overview: 'Overview', visitors: 'Visitors & tickets', incidents: 'Incidents',
  schedule: 'Schedule', stalls: 'Stalls', lodging: 'Lodging', volunteers: 'Volunteers',
  fly: 'Fly-status', announce: 'Announcements', kb: 'Knowledge & AI',
  passes: 'Passes', orders: 'Orders', refunds: 'Refunds', pricing: 'Prices', people: 'People', admins: 'Admins',
  catalog: 'Catalog & gates', wristbands: 'Wristbands', audit: 'Audit log',
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
  const [agg, d] = await Promise.all([api('GET', '/admin/stalls'), api('GET', '/admin/stalls/list')]);
  const items = d.items; const w = cap('stalls.manage');
  const orders = agg.items.reduce((n, s) => n + (s.ordersEstimate || 0), 0);
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Stalls', items.length, `${items.filter((s) => s.paid).length} fees paid`)}
      ${kpiCard('Est. orders (3 days)', orders.toLocaleString('en-IN'), 'across all stalls')}
      ${kpiCard('Fees billed', inr(items.reduce((n, s) => n + s.feeInr, 0)), `${items.filter((s) => !s.paid).length} unpaid`)}
    </div>
    ${w ? `<div class="card mgr" style="margin-top:16px"><div class="section-title" id="stall-title">Add stall</div>
      <input id="stall-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Stall name</span><input id="stall-stallName" placeholder="Kangra Kitchen"></label>
        <label class="field"><span>Vendor phone <span class="hint">(new vendor only — creates their login)</span></span><input id="stall-phone" placeholder="9876500000"></label>
        <label class="field"><span>Category</span><input id="stall-category" placeholder="Local food · siddu & dham"></label>
        <label class="field"><span>Stage</span><select id="stall-stage"><option value="pending">pending</option><option value="approved">approved</option><option value="rejected">rejected</option></select></label>
        <label class="field"><span>Allocation label</span><input id="stall-allocationLabel" placeholder="Food Street · Stall F-12"></label>
        <label class="field"><span>Fee (₹)</span><input id="stall-feeInr" type="number" min="0" placeholder="3500"></label>
        <label class="field row" style="align-items:center;gap:8px"><input id="stall-paid" type="checkbox"><span>Fee paid</span></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="stall-save">Save stall</button><button class="btn ghost" id="stall-clear">Clear</button></div>
    </div>` : ''}
    <div class="card" style="margin-top:16px"><div class="section-title">Food street (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Stall</th><th>Category</th><th>Stage</th><th>Allocation</th><th>Fee</th>${w ? '<th>Actions</th>' : ''}</tr></thead><tbody>
        ${items.length ? items.map((s) => `<tr data-id="${esc(s.id)}"><td>${esc(s.stallName)}</td><td>${esc(s.category || '')}</td><td><span class="pill ${s.stage === 'approved' ? 'good' : s.stage === 'rejected' ? 'bad' : 'info'}">${esc(s.stage || '—')}</span></td><td class="mono">${esc(s.allocationLabel || '')}</td><td class="mono">${inr(s.feeInr)} ${s.paid ? '<span class="pill good">paid</span>' : '<span class="pill bad">due</span>'}</td>${w ? `<td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${w ? 6 : 5}" class="empty">No stalls yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
  if (w) wireCrud(v, {
    kind: 'stall', path: '/admin/stalls', view: 'stalls', items, noun: 'stall',
    collect: () => {
      const stallName = $('#stall-stallName').value.trim();
      if (!stallName) { toast('Stall name is required', 'bad'); return null; }
      return { stallName, phone: $('#stall-phone').value.trim(), category: $('#stall-category').value.trim(), stage: $('#stall-stage').value, allocationLabel: $('#stall-allocationLabel').value.trim(), feeInr: Number($('#stall-feeInr').value) || 0, paid: $('#stall-paid').checked };
    },
    fill: (s) => { $('#stall-stallName').value = s.stallName || ''; $('#stall-phone').value = ''; $('#stall-category').value = s.category || ''; $('#stall-stage').value = s.stage || 'pending'; $('#stall-allocationLabel').value = s.allocationLabel || ''; $('#stall-feeInr').value = s.feeInr || ''; $('#stall-paid').checked = !!s.paid; },
    clear: () => { ['stallName', 'phone', 'category', 'allocationLabel', 'feeInr'].forEach((f) => $('#stall-' + f).value = ''); $('#stall-stage').value = 'pending'; $('#stall-paid').checked = false; },
  });
};

VIEWS.lodging = async (v) => {
  const [agg, d, poolD] = await Promise.all([api('GET', '/admin/lodging'), api('GET', '/admin/rooms'), api('GET', '/admin/lodging/pool').catch(() => ({ items: [] }))]);
  const rooms = d.items; const w = cap('lodging.manage'); const pool = poolD.items || [];
  const assigned = rooms.filter((r) => r.guestName).length;
  const checkedIn = rooms.filter((r) => r.checkedIn).length;
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Rooms', rooms.length, `${new Set(rooms.map((r) => r.hotelName)).size} hotels · ${rooms.reduce((n, r) => n + r.capacity, 0)} beds`)}
      ${kpiCard('Need lodging', agg.pool.needLodging, `of ${agg.pool.total} registrants`)}
      ${kpiCard('Allocated', assigned, `${rooms.length - assigned} rooms free`)}
      ${kpiCard('Checked in', checkedIn, `of ${assigned} allocations`)}
    </div>
    ${w ? `<div class="card mgr" style="margin-top:16px"><div class="section-title" id="room-title">Add room</div>
      <input id="room-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Hotel</span><input id="room-hotelName" placeholder="Deodar Homestay"></label>
        <label class="field"><span>Room label</span><input id="room-roomLabel" placeholder="Cottage 2"></label>
        <label class="field"><span>Type</span><input id="room-type" placeholder="twin"></label>
        <label class="field"><span>Capacity</span><input id="room-capacity" type="number" min="1" placeholder="2"></label>
        <label class="field"><span>Status</span><select id="room-status"><option value="active">active</option><option value="held">held</option><option value="offline">offline</option></select></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="room-save">Save room</button><button class="btn ghost" id="room-clear">Clear</button></div>
    </div>` : ''}
    ${pool.length ? `<div class="card" style="margin-top:16px"><div class="section-title">Needs lodging (${pool.length}) · ${poolD.allocated || 0} allocated</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Registrant</th><th>Activity</th><th>Gender</th><th>Nights</th><th>Status</th></tr></thead><tbody>
        ${pool.map((p) => `<tr><td>${esc(p.name || p.regId)}</td><td>${esc(p.itemId)}</td><td>${esc(p.gender || '—')}</td><td class="mono">${p.nights}</td><td>${p.allocated ? '<span class="pill good">allocated</span>' : '<span class="pill warn">waiting</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint">Allocate a room below and enter the registrant’s name — that room shows them as allocated here.</p>
    </div>` : ''}
    <div class="card" style="margin-top:16px"><div class="section-title">Room inventory (${rooms.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Hotel</th><th>Room</th><th>Type</th><th>Cap</th><th>Status</th><th>Guest</th><th>Check-in</th>${w ? '<th>Actions</th>' : ''}</tr></thead><tbody>
        ${rooms.length ? rooms.map((r) => `<tr data-id="${esc(r.id)}"><td>${esc(r.hotelName)}</td><td>${esc(r.roomLabel)}</td><td>${esc(r.type)}</td><td class="mono">${r.capacity}</td><td><span class="pill ${r.status === 'active' ? 'good' : 'warn'}">${esc(r.status)}</span></td><td>${r.guestName ? esc(r.guestName) : '<span class="pill">free</span>'}</td><td>${r.guestName ? (r.checkedIn ? '<span class="pill good">in</span>' : '<span class="pill warn">awaiting</span>') : '—'}</td>${w ? `<td><div class="row wrap"><button class="btn ghost sm rm-alloc">Allocate</button><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${w ? 8 : 7}" class="empty">No rooms. Add inventory above or run seed-rooms.</td></tr>`}
      </tbody></table></div>
    </div>`;
  if (w) {
    wireCrud(v, {
      kind: 'room', path: '/admin/rooms', view: 'lodging', items: rooms, noun: 'room',
      collect: () => {
        const hotelName = $('#room-hotelName').value.trim(); const roomLabel = $('#room-roomLabel').value.trim();
        if (!hotelName || !roomLabel) { toast('Hotel and room label are required', 'bad'); return null; }
        return { hotelName, roomLabel, type: $('#room-type').value.trim() || 'twin', capacity: Number($('#room-capacity').value) || 2, status: $('#room-status').value };
      },
      fill: (r) => { $('#room-hotelName').value = r.hotelName || ''; $('#room-roomLabel').value = r.roomLabel || ''; $('#room-type').value = r.type || ''; $('#room-capacity').value = r.capacity || ''; $('#room-status').value = r.status || 'active'; },
      clear: () => { ['hotelName', 'roomLabel', 'type', 'capacity'].forEach((f) => $('#room-' + f).value = ''); $('#room-status').value = 'active'; },
    });
    $$('.rm-alloc', v).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id; const room = rooms.find((r) => r.id === id) || {};
      const guestName = prompt(`Assign a guest to ${room.hotelName} ${room.roomLabel} (blank to clear):`, room.guestName || '');
      if (guestName === null) return;
      const checkedIn = guestName.trim() ? confirm('Mark this guest as checked in now? (Cancel = awaiting check-in)') : false;
      try { await api('POST', `/admin/rooms/${encodeURIComponent(id)}/allocate`, { guestName: guestName.trim(), checkedIn }); toast(guestName.trim() ? 'Room allocated' : 'Allocation cleared', 'good'); setView('lodging'); }
      catch (e) { toast(e.message, 'bad'); }
    }));
  }
};

VIEWS.volunteers = async (v) => {
  const [agg, d] = await Promise.all([api('GET', '/admin/volunteers'), api('GET', '/admin/volunteers/list')]);
  const vols = d.items; const w = cap('volunteers.manage');
  const totalShifts = vols.reduce((n, x) => n + x.shifts.length, 0);
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Volunteers', vols.length, `${vols.filter((x) => x.idVerified).length} ID-verified`)}
      ${kpiCard('Shifts assigned', totalShifts, 'across the roster')}
      ${kpiCard('Attendance records', agg.attendanceRecords, 'check-ins logged')}
    </div>
    ${w ? `<div class="card mgr" style="margin-top:16px"><div class="section-title" id="vol-title">Add volunteer</div>
      <input id="vol-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Name</span><input id="vol-name" placeholder="Tenzin Dorje"></label>
        <label class="field"><span>Phone <span class="hint">(new volunteer only — creates their login)</span></span><input id="vol-phone" placeholder="9876500000"></label>
        <label class="field"><span>Team</span><input id="vol-team" placeholder="Gate & Access"></label>
        <label class="field row" style="align-items:center;gap:8px"><input id="vol-idVerified" type="checkbox"><span>ID verified</span></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="vol-save">Save volunteer</button><button class="btn ghost" id="vol-clear">Clear</button></div>
    </div>` : ''}
    <div class="card" style="margin-top:16px"><div class="section-title">Roster (${vols.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th><th>Team</th><th>Shifts</th><th>ID</th>${w ? '<th>Actions</th>' : ''}</tr></thead><tbody>
        ${vols.length ? vols.map((x) => `<tr data-id="${esc(x.id)}"><td>${esc(x.name || '')}</td><td>${esc(x.team || '')}</td><td>${x.shifts.length ? x.shifts.map((s) => `<span class="pill info" title="${esc(s.date)} ${esc(s.role)}">${esc(s.zone || s.role || 'shift')}${w ? ` <a class="sh-del" data-vol="${esc(x.id)}" data-sh="${esc(s.id)}" title="remove">✕</a>` : ''}</span>`).join(' ') : '<span class="mono" style="color:var(--faint)">none</span>'}</td><td>${x.idVerified ? '<span class="pill good">yes</span>' : '<span class="pill">no</span>'}</td>${w ? `<td><div class="row wrap"><button class="btn ghost sm vol-shift">+ shift</button><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${w ? 5 : 4}" class="empty">No volunteers yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
  if (w) {
    wireCrud(v, {
      kind: 'vol', path: '/admin/volunteers', view: 'volunteers', items: vols, noun: 'volunteer',
      collect: () => {
        const name = $('#vol-name').value.trim();
        if (!name) { toast('Name is required', 'bad'); return null; }
        return { name, phone: $('#vol-phone').value.trim(), team: $('#vol-team').value.trim(), idVerified: $('#vol-idVerified').checked };
      },
      fill: (x) => { $('#vol-name').value = x.name || ''; $('#vol-phone').value = ''; $('#vol-team').value = x.team || ''; $('#vol-idVerified').checked = !!x.idVerified; },
      clear: () => { $('#vol-name').value = ''; $('#vol-phone').value = ''; $('#vol-team').value = ''; $('#vol-idVerified').checked = false; },
    });
    $$('.vol-shift', v).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id;
      const date = prompt('Shift date (YYYY-MM-DD):', '2026-11-21'); if (!date) return;
      const zone = prompt('Zone / checkpoint:', 'Chogan Gate A'); if (zone === null) return;
      const role = prompt('Role:', 'Scanner') || 'Steward';
      try { await api('POST', `/admin/volunteers/${encodeURIComponent(id)}/shift`, { date, zone, role }); toast('Shift added', 'good'); setView('volunteers'); }
      catch (e) { toast(e.message, 'bad'); }
    }));
    $$('.sh-del', v).forEach((a) => a.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('Remove this shift?')) return;
      try { await api('DELETE', `/admin/volunteers/${encodeURIComponent(a.dataset.vol)}/shift/${encodeURIComponent(a.dataset.sh)}`); toast('Shift removed', 'good'); setView('volunteers'); }
      catch (e) { toast(e.message, 'bad'); }
    }));
  }
};

VIEWS.incidents = async (v) => {
  const d = await api('GET', '/admin/incidents');
  const w = cap('incidents.manage');
  const STATUS = ['open', 'acknowledged', 'in-progress', 'resolved'];
  const tone = { open: 'bad', acknowledged: 'warn', 'in-progress': 'info', resolved: 'good' };
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Incidents', d.total, 'reported from the field')}
      ${kpiCard('Open', d.open, 'need attention')}
      ${kpiCard('Resolved', d.byStatus.resolved || 0, 'closed out')}
      ${kpiCard('Latest', d.items[0] ? fmtTime(d.items[0].ts) : '—', d.items[0] ? esc(d.items[0].zone || '') : 'none yet')}
    </div>
    ${Object.keys(d.byCategory).length ? `<div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="section-title">By category</div>${bars(Object.entries(d.byCategory).map(([k, n]) => ({ label: k, value: n })), 'slate')}</div>
      <div class="card"><div class="section-title">By status</div>${bars(STATUS.filter((s) => d.byStatus[s]).map((s) => ({ label: s, value: d.byStatus[s] })), 'pine')}</div>
    </div>` : ''}
    <div class="card" style="margin-top:16px"><div class="section-title">Incident log ${w ? '· triage' : ''}</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Category</th><th>Zone</th><th>Note</th><th>Status</th>${w ? '<th>Triage</th>' : '<th>Assignee</th>'}</tr></thead><tbody>
        ${d.items.length ? d.items.map((i) => `<tr data-id="${esc(i.id)}"><td class="mono">${fmtTime(i.ts)}</td><td><span class="pill info">${esc(i.category || '')}</span></td><td>${esc(i.zone || '')}</td><td>${esc(i.note || '')}${i.resolutionNote ? `<div class="hint" style="color:var(--good)">↳ ${esc(i.resolutionNote)}</div>` : ''}</td><td><span class="pill ${tone[i.status] || ''}">${esc(i.status)}</span></td>${w
      ? `<td><div class="row wrap" style="gap:6px"><select class="inc-status">${STATUS.map((s) => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select><input class="inc-assignee" placeholder="assignee" value="${esc(i.assignee || '')}" style="width:96px"><button class="btn ghost sm inc-save">Update</button></div></td>`
      : `<td>${esc(i.assignee || '—')}</td>`}</tr>`).join('') : `<tr><td colspan="6" class="empty">No incidents reported — all clear.</td></tr>`}
      </tbody></table></div>
    </div>`;
  if (w) $$('.inc-save', v).forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr'); const id = tr.dataset.id;
    const status = tr.querySelector('.inc-status').value;
    const assignee = tr.querySelector('.inc-assignee').value.trim();
    const body = { status, assignee };
    if (status === 'resolved') { const note = prompt('Resolution note (optional):', ''); if (note) body.resolutionNote = note; }
    b.disabled = true;
    try { await api('POST', `/admin/incidents/${encodeURIComponent(id)}`, body); toast('Incident updated', 'good'); setView('incidents'); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  }));
};

VIEWS.schedule = async (v) => {
  if (!cap('schedule.manage')) { v.innerHTML = notPermitted('schedule'); return; }
  const d = await api('GET', '/admin/schedule'); const items = d.items;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title" id="sched-title">Add session</div>
      <input id="sched-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Day</span><input id="sched-day" type="date" value="2026-11-21"></label>
        <label class="field"><span>Venue</span><input id="sched-venue" placeholder="Chogan Ground"></label>
        <label class="field"><span>Title (English)</span><input id="sched-titleEn" placeholder="Folk music of Kangra"></label>
        <label class="field"><span>Title (Hindi)</span><input id="sched-titleHi" placeholder="कांगड़ा का लोक संगीत"></label>
        <label class="field"><span>Start time</span><input id="sched-time" type="time" value="18:00"></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="sched-save">Save session</button><button class="btn ghost" id="sched-clear">Clear</button></div>
      <p class="hint">Sessions appear on the festival schedule in the app. Times are Asia/Kolkata.</p>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Programme (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Day</th><th>Start</th><th>Title</th><th>Venue</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((s) => `<tr data-id="${esc(s.id)}"><td class="mono">${esc(s.day)}</td><td class="mono">${s.startsAt ? fmtTime(s.startsAt) : '—'}</td><td>${esc(s.titleEn)}${s.titleHi ? `<div class="hint">${esc(s.titleHi)}</div>` : ''}</td><td>${esc(s.venue || '')}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No sessions yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
  wireCrud(v, {
    kind: 'sched', path: '/admin/schedule', view: 'schedule', items, noun: 'session',
    collect: () => {
      const titleEn = $('#sched-titleEn').value.trim(); const day = $('#sched-day').value;
      if (!titleEn || !day) { toast('Day and English title are required', 'bad'); return null; }
      return { day, venue: $('#sched-venue').value.trim(), titleEn, titleHi: $('#sched-titleHi').value.trim(), startsAt: epochFrom(day, $('#sched-time').value) };
    },
    fill: (s) => { $('#sched-day').value = s.day || ''; $('#sched-venue').value = s.venue || ''; $('#sched-titleEn').value = s.titleEn || ''; $('#sched-titleHi').value = s.titleHi || ''; $('#sched-time').value = s.startsAt ? hhmmFrom(s.startsAt) : '18:00'; },
    clear: () => { ['venue', 'titleEn', 'titleHi'].forEach((f) => $('#sched-' + f).value = ''); },
  });
};

VIEWS.announce = async (v) => {
  if (!cap('announce.write')) { v.innerHTML = notPermitted('announcements'); return; }
  const d = await api('GET', '/admin/announcements'); const items = d.items;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title" id="ann-title">Post announcement</div>
      <input id="ann-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Title (English)</span><input id="ann-titleEn" placeholder="Gates open at 8 AM"></label>
        <label class="field"><span>Title (Hindi)</span><input id="ann-titleHi" placeholder="गेट सुबह 8 बजे खुलेंगे"></label>
      </div>
      <label class="field"><span>Body (English)</span><textarea id="ann-bodyEn" placeholder="Please arrive early; parking fills quickly."></textarea></label>
      <label class="field"><span>Body (Hindi)</span><textarea id="ann-bodyHi" placeholder="कृपया जल्दी पहुँचें।"></textarea></label>
      <div class="grid g-2">
        <label class="field"><span>Level</span><select id="ann-level"><option value="info">info</option><option value="alert">alert</option></select></label>
        <label class="field row" style="align-items:center;gap:8px"><input id="ann-active" type="checkbox" checked><span>Active (visible in app)</span></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="ann-save">Post</button><button class="btn ghost" id="ann-clear">Clear</button></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Announcements (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Level</th><th>Title</th><th>Body</th><th>State</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((a) => `<tr data-id="${esc(a.id)}"><td><span class="pill ${a.level === 'alert' ? 'bad' : 'info'}">${esc(a.level)}</span></td><td>${esc(a.titleEn)}${a.titleHi ? `<div class="hint">${esc(a.titleHi)}</div>` : ''}</td><td>${esc(a.bodyEn)}</td><td>${a.active ? '<span class="pill good">active</span>' : '<span class="pill">hidden</span>'}</td><td class="mono">${fmtTime(a.updatedAt)}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No announcements.</td></tr>'}
      </tbody></table></div>
    </div>`;
  wireCrud(v, {
    kind: 'ann', path: '/admin/announcements', view: 'announce', items, noun: 'announcement',
    collect: () => {
      const titleEn = $('#ann-titleEn').value.trim(); const bodyEn = $('#ann-bodyEn').value.trim();
      if (!titleEn || !bodyEn) { toast('English title and body are required', 'bad'); return null; }
      return { titleEn, titleHi: $('#ann-titleHi').value.trim(), bodyEn, bodyHi: $('#ann-bodyHi').value.trim(), level: $('#ann-level').value, active: $('#ann-active').checked };
    },
    fill: (a) => { $('#ann-titleEn').value = a.titleEn || ''; $('#ann-titleHi').value = a.titleHi || ''; $('#ann-bodyEn').value = a.bodyEn || ''; $('#ann-bodyHi').value = a.bodyHi || ''; $('#ann-level').value = a.level || 'info'; $('#ann-active').checked = a.active !== false; },
    clear: () => { ['titleEn', 'titleHi', 'bodyEn', 'bodyHi'].forEach((f) => $('#ann-' + f).value = ''); $('#ann-level').value = 'info'; $('#ann-active').checked = true; },
  });
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

VIEWS.orders = async (v) => {
  if (!cap('orders.manage')) { v.innerHTML = notPermitted('orders'); return; }
  const d = await api('GET', '/admin/orders'); const items = d.items;
  const shortId = (s) => (s.length > 18 ? s.slice(0, 18) + '…' : s);
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Orders', items.length, `${d.confirmed} confirmed`)}
      ${kpiCard('Revenue (confirmed)', inr(d.revenueInr), 'gross, before refunds')}
      ${kpiCard('Adjusted', items.filter((o) => ['CANCELLED', 'COMP'].includes(o.status)).length, 'cancelled / comped')}
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Orders (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Order</th><th>Buyer</th><th>Item</th><th>Amount</th><th>Status</th><th>When</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((o) => `<tr data-id="${esc(o.orderId)}"><td class="mono" title="${esc(o.orderId)}">${esc(shortId(o.orderId))}</td><td class="mono">${esc((o.sub || '').slice(0, 8))}</td><td>${esc(o.kind)}·${esc(o.itemId)}</td><td class="mono">${inr(o.amountInr)}</td><td><span class="pill ${o.status === 'CONFIRMED' ? 'good' : o.status === 'PENDING' ? 'warn' : 'bad'}">${esc(o.status)}</span></td><td class="mono">${fmtTime(o.createdAt)}</td><td><div class="row wrap">${o.status === 'CONFIRMED' ? '<button class="btn ghost sm ord-refund">Request refund</button><button class="btn ghost sm ord-cancel">Cancel</button>' : '<span class="pill">—</span>'}</div></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No orders yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
  $$('.ord-refund', v).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    const reason = prompt('Refund reason (shown in the refund queue):', 'flight grounded'); if (reason === null) return;
    try { await api('POST', `/admin/orders/${encodeURIComponent(id)}/refund-request`, { reason }); toast('Refund requested — see Refunds', 'good'); setView('refunds'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
  $$('.ord-cancel', v).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    if (!confirm('Mark this order CANCELLED?')) return;
    try { await api('POST', `/admin/orders/${encodeURIComponent(id)}/status`, { status: 'CANCELLED' }); toast('Order cancelled', 'good'); setView('orders'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
};

VIEWS.refunds = async (v) => {
  if (!cap('orders.manage')) { v.innerHTML = notPermitted('refunds'); return; }
  const d = await api('GET', '/admin/refunds'); const items = d.items;
  const shortId = (s) => (s.length > 16 ? s.slice(0, 16) + '…' : s);
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Pending refunds', d.pending, 'to process')}
      ${kpiCard('Pending amount', inr(d.pendingInr), 'owed to buyers')}
      ${kpiCard('Total requests', items.length, 'all time')}
    </div>
    <div class="card mgr" style="margin-top:16px"><div class="section-title">How refunds work</div>
      <p class="hint">Refunds are processed <b>manually</b> through Paytm / your settlement process — this queue is the record. Raise a request from <b>Orders</b>, refund out-of-band, then mark it done here with the Paytm reference.</p>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Refund queue (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Order</th><th>Buyer</th><th>Amount</th><th>Reason</th><th>Status</th><th>Requested</th><th>Ref</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((r) => `<tr data-id="${esc(r.orderId)}"><td class="mono" title="${esc(r.orderId)}">${esc(shortId(r.orderId))}</td><td class="mono">${esc((r.sub || '').slice(0, 8))}</td><td class="mono">${inr(r.amountInr)}</td><td>${esc(r.reason)}</td><td><span class="pill ${r.status === 'PROCESSED' ? 'good' : 'warn'}">${esc(r.status)}</span></td><td class="mono">${fmtTime(r.requestedAt)}</td><td class="mono">${esc(r.processedRef || '—')}</td><td>${r.status === 'PROCESSED' ? '<span class="pill good">done</span>' : '<button class="btn ghost sm rf-proc">Mark processed</button>'}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">No refund requests.</td></tr>'}
      </tbody></table></div>
    </div>`;
  $$('.rf-proc', v).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    const reference = prompt('Paytm / settlement refund reference:', ''); if (reference === null) return;
    const note = prompt('Note (optional):', '') || '';
    try { await api('POST', `/admin/refunds/${encodeURIComponent(id)}/process`, { reference, note }); toast('Refund marked processed', 'good'); setView('refunds'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
};

VIEWS.pricing = async (v) => {
  if (!cap('pricing.manage')) { v.innerHTML = notPermitted('prices'); return; }
  const [it, ti] = await Promise.all([api('GET', '/admin/items'), api('GET', '/admin/tiers')]);
  const items = it.items; const tiers = ti.items;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title" id="tier-title">Add ticket tier</div>
      <input id="tier-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Id</span><input id="tier-idf" placeholder="day-pass"></label>
        <label class="field"><span>Title (English)</span><input id="tier-titleEn" placeholder="Day pass"></label>
        <label class="field"><span>Title (Hindi)</span><input id="tier-titleHi"></label>
        <label class="field"><span>Price (₹)</span><input id="tier-priceInr" type="number" min="0"></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="tier-save">Save tier</button><button class="btn ghost" id="tier-clear">Clear</button></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Ticket tiers (${tiers.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Id</th><th>Title</th><th>Price</th><th>Actions</th></tr></thead><tbody>
        ${tiers.length ? tiers.map((t) => `<tr data-id="${esc(t.id)}"><td class="mono">${esc(t.id)}</td><td>${esc(t.titleEn)}</td><td class="mono">${inr(t.priceInr)}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No ticket tiers.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="card mgr" style="margin-top:16px"><div class="section-title" id="itc-title">Add / edit activity fee</div>
      <input id="itc-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Item id</span><input id="itc-itemId" placeholder="paragliding"></label>
        <label class="field"><span>Title (English)</span><input id="itc-titleEn"></label>
        <label class="field"><span>Fee (₹) — 0 = free</span><input id="itc-feeInr" type="number" min="0"></label>
        <label class="field"><span>Capacity (0 = unlimited)</span><input id="itc-capacity" type="number" min="0"></label>
        <label class="field row" style="align-items:center;gap:8px"><input id="itc-gateChecked" type="checkbox"><span>Gate-checked</span></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="itc-save">Save item</button><button class="btn ghost" id="itc-clear">Clear</button></div>
      <p class="hint">Fee is server-authoritative: a paid activity (fee &gt; 0) can only be entered after payment; fee 0 makes it free-to-register.</p>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Activities (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Item</th><th>Fee</th><th>Gate</th><th>Cap</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((i) => `<tr data-id="${esc(i.id)}"><td>${esc(i.titleEn || i.id)}<div class="hint mono">${esc(i.id)}</div></td><td class="mono">${i.feeInr ? inr(i.feeInr) : '<span class="pill good">free</span>'}</td><td>${i.gateChecked ? '<span class="pill info">gated</span>' : '—'}</td><td class="mono">${i.capacity || '∞'}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No activities. Run seed-itemcfg.</td></tr>'}
      </tbody></table></div>
    </div>`;
  wireCrud(v, {
    kind: 'tier', path: '/admin/tiers', view: 'pricing', items: tiers, noun: 'tier',
    collect: () => {
      const id = $('#tier-idf').value.trim(); const titleEn = $('#tier-titleEn').value.trim();
      if (!id && !titleEn) { toast('Id or title required', 'bad'); return null; }
      return { id: id || undefined, titleEn, titleHi: $('#tier-titleHi').value.trim(), priceInr: Number($('#tier-priceInr').value) || 0 };
    },
    fill: (t) => { $('#tier-idf').value = t.id || ''; $('#tier-titleEn').value = t.titleEn || ''; $('#tier-titleHi').value = t.titleHi || ''; $('#tier-priceInr').value = t.priceInr || ''; },
    clear: () => { ['idf', 'titleEn', 'titleHi', 'priceInr'].forEach((f) => $('#tier-' + f).value = ''); },
  });
  wireCrud(v, {
    kind: 'itc', path: '/admin/items', view: 'pricing', items, noun: 'activity',
    collect: () => {
      const itemId = $('#itc-itemId').value.trim();
      if (!itemId) { toast('Item id is required', 'bad'); return null; }
      return { itemId, titleEn: $('#itc-titleEn').value.trim(), feeInr: Number($('#itc-feeInr').value) || 0, capacity: Number($('#itc-capacity').value) || 0, gateChecked: $('#itc-gateChecked').checked };
    },
    fill: (i) => { $('#itc-itemId').value = i.id || ''; $('#itc-titleEn').value = i.titleEn || ''; $('#itc-feeInr').value = i.feeInr || ''; $('#itc-capacity').value = i.capacity || ''; $('#itc-gateChecked').checked = !!i.gateChecked; },
    clear: () => { ['itemId', 'titleEn', 'feeInr', 'capacity'].forEach((f) => $('#itc-' + f).value = ''); $('#itc-gateChecked').checked = false; },
  });
};

VIEWS.people = async (v) => {
  if (!cap('users.manage')) { v.innerHTML = notPermitted('people'); return; }
  const group = VIEWS.people._group || '';
  const d = await api('GET', '/admin/users' + (group ? `?group=${encodeURIComponent(group)}` : ''));
  const users = d.items;
  const chip = (g) => `<button class="chip ${group === g ? 'on' : ''}" data-grp="${g}">${g || 'all'}</button>`;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title">Add a person — creates a real app login</div>
      <div class="grid g-2">
        <label class="field"><span>Phone (10-digit)</span><input id="usr-phone" placeholder="9876500000"></label>
        <label class="field"><span>Name</span><input id="usr-name" placeholder="Priya Sharma"></label>
      </div>
      <label class="field"><span>Roles</span></label>
      <div class="row wrap" id="usr-roles" style="margin-top:-6px">
        ${ROLE_GROUPS.map((g) => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${g}" style="margin-right:6px;vertical-align:middle">${g}</label>`).join('')}
      </div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="usr-create">Create login</button></div>
      <p class="hint">Sign-in is OTP-only (phone). Assigning a role here is what gives a vendor/volunteer their console — no spreadsheet import needed.</p>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">People ${group ? `· ${esc(group)}` : ''}</div>
      <div class="row wrap" style="margin-bottom:12px">${['', ...ROLE_GROUPS].map(chip).join('')}</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Phone</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${users.length ? users.map((u) => `<tr data-u="${esc(u.username)}"><td class="mono">${esc(u.phone || u.username)}</td><td>${esc(u.name || '')}</td><td>${u.enabled ? '<span class="pill good">active</span>' : '<span class="pill bad">disabled</span>'}</td><td><div class="row wrap"><button class="btn ghost sm pe-roles">Roles</button><button class="btn ghost sm pe-toggle">${u.enabled ? 'Disable' : 'Enable'}</button><button class="btn ghost sm pe-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No users in this view.</td></tr>'}
      </tbody></table></div>
    </div>`;
  $$('.chip[data-grp]', v).forEach((b) => b.addEventListener('click', () => { VIEWS.people._group = b.dataset.grp; setView('people'); }));
  $('#usr-create').addEventListener('click', async () => {
    const phone = $('#usr-phone').value.trim();
    if (!phone) return toast('Phone is required', 'bad');
    const groups = $$('#usr-roles input:checked', v).map((c) => c.value);
    const b = $('#usr-create'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Creating…';
    try { await api('POST', '/admin/users', { phone, name: $('#usr-name').value.trim(), groups }); toast('Login created', 'good'); setView('people'); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Create login'; }
  });
  $$('.pe-roles', v).forEach((b) => b.addEventListener('click', async () => {
    const u = b.closest('tr').dataset.u;
    const roles = prompt(`Set roles for ${u} (space-separated from: ${ROLE_GROUPS.join(' ')}):`, group || '');
    if (roles === null) return;
    const groups = roles.split(/\s+/).filter((g) => ROLE_GROUPS.includes(g));
    try { await api('POST', `/admin/users/${encodeURIComponent(u)}/groups`, { groups }); toast('Roles updated', 'good'); setView('people'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
  $$('.pe-toggle', v).forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr'); const u = tr.dataset.u; const enable = b.textContent === 'Enable';
    try { await api('POST', `/admin/users/${encodeURIComponent(u)}/enabled`, { enabled: enable }); toast(enable ? 'Enabled' : 'Disabled', 'good'); setView('people'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
  $$('.pe-del', v).forEach((b) => b.addEventListener('click', async () => {
    const u = b.closest('tr').dataset.u;
    if (!confirm(`Delete the login for ${u}? This removes their app access.`)) return;
    try { await api('DELETE', `/admin/users/${encodeURIComponent(u)}`); toast('Login deleted', 'good'); setView('people'); }
    catch (e) { toast(e.message, 'bad'); }
  }));
};

VIEWS.catalog = async (v) => {
  if (!cap('catalog.manage')) { v.innerHTML = notPermitted('catalog'); return; }
  const [c, g] = await Promise.all([api('GET', '/admin/catalog'), api('GET', '/admin/gates')]);
  const items = c.items; const gates = g.items;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title" id="cat-title">Add competition / activity</div>
      <input id="cat-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Title (English)</span><input id="cat-title-en" placeholder="Miss Himachal"></label>
        <label class="field"><span>Title (Hindi)</span><input id="cat-titleHi"></label>
        <label class="field"><span>Category</span><input id="cat-categoryId" placeholder="competitions"></label>
        <label class="field"><span>Venue</span><input id="cat-venue" placeholder="Chogan Ground"></label>
        <label class="field"><span>Dates (comma-sep YYYY-MM-DD)</span><input id="cat-dates" placeholder="2026-11-22"></label>
        <label class="field"><span>Reg mode</span><select id="cat-regMode"><option value="register">register</option><option value="waitlist">waitlist</option><option value="view-only">view-only</option></select></label>
        <label class="field"><span>Fee (₹) — 0 = free</span><input id="cat-feeInr" type="number" min="0"></label>
        <label class="field"><span>Capacity (0 = unlimited)</span><input id="cat-capacity" type="number" min="0"></label>
        <label class="field row" style="align-items:center;gap:8px"><input id="cat-gateChecked" type="checkbox"><span>Gate-checked (needs entitlement)</span></label>
      </div>
      <label class="field"><span>Summary (English)</span><textarea id="cat-summary"></textarea></label>
      <label class="field"><span>Rules (English)</span><textarea id="cat-rules"></textarea></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="cat-save">Save &amp; publish</button><button class="btn ghost" id="cat-clear">Clear</button></div>
      <p class="hint">Saving regenerates the app’s catalog and invalidates the CDN — the item appears in the app with no deploy. Fee/gating also update server-side pricing.</p>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Catalog (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Title</th><th>Category</th><th>Fee</th><th>Gate</th><th>Cap</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((i) => `<tr data-id="${esc(i.id)}"><td>${esc(i.title)}<div class="hint mono">${esc(i.id)}</div></td><td>${esc(i.categoryId)}</td><td class="mono">${i.feeInr ? inr(i.feeInr) : '<span class="pill good">free</span>'}</td><td>${i.gateChecked ? '<span class="pill info">gated</span>' : '—'}</td><td class="mono">${i.capacity || '∞'}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No catalog items.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="card mgr" style="margin-top:16px"><div class="section-title">Gates / checkpoints</div>
      <div class="row"><input id="gate-label" placeholder="North Gate" style="flex:1"><button class="btn primary" id="gate-add">Add gate</button></div>
      <div class="row wrap" style="margin-top:12px">
        ${gates.length ? gates.map((x) => `<span class="pill info" style="display:inline-flex;align-items:center;gap:6px">${esc(x.label)} <a class="gate-del" data-id="${esc(x.id)}" title="remove" style="cursor:pointer">✕</a></span>`).join(' ') : '<span class="hint">Using the built-in gates. Add one to take over.</span>'}
      </div>
    </div>`;
  wireCrud(v, {
    kind: 'cat', path: '/admin/catalog', view: 'catalog', items, noun: 'competition',
    collect: () => {
      const title = $('#cat-title-en').value.trim();
      if (!title) { toast('Title is required', 'bad'); return null; }
      return { title, titleHi: $('#cat-titleHi').value.trim(), categoryId: $('#cat-categoryId').value.trim() || 'competitions', venue: $('#cat-venue').value.trim(), dates: $('#cat-dates').value.trim(), regMode: $('#cat-regMode').value, feeInr: Number($('#cat-feeInr').value) || 0, capacity: Number($('#cat-capacity').value) || 0, gateChecked: $('#cat-gateChecked').checked, summary: $('#cat-summary').value.trim(), rules: $('#cat-rules').value.trim() };
    },
    fill: (i) => { $('#cat-id').value = i.id; $('#cat-title-en').value = i.title || ''; $('#cat-titleHi').value = i.titleHi || ''; $('#cat-categoryId').value = i.categoryId || ''; $('#cat-feeInr').value = i.feeInr || ''; $('#cat-capacity').value = i.capacity || ''; $('#cat-gateChecked').checked = !!i.gateChecked; $('#cat-regMode').value = i.regMode || 'register'; },
    clear: () => { ['title-en', 'titleHi', 'categoryId', 'venue', 'dates', 'feeInr', 'capacity', 'summary', 'rules'].forEach((f) => $('#cat-' + f).value = ''); $('#cat-gateChecked').checked = false; $('#cat-regMode').value = 'register'; },
  });
  $('#gate-add').addEventListener('click', async () => {
    const label = $('#gate-label').value.trim(); if (!label) return;
    try { await api('POST', '/admin/gates', { label }); toast('Gate added', 'good'); setView('catalog'); } catch (e) { toast(e.message, 'bad'); }
  });
  $$('.gate-del', v).forEach((a) => a.addEventListener('click', async () => {
    if (!confirm('Remove this gate?')) return;
    try { await api('DELETE', '/admin/gates/' + encodeURIComponent(a.dataset.id)); toast('Gate removed', 'good'); setView('catalog'); } catch (e) { toast(e.message, 'bad'); }
  }));
};

VIEWS.wristbands = async (v) => {
  if (!cap('wristband.manage')) { v.innerHTML = notPermitted('wristbands'); return; }
  const d = await api('GET', '/admin/wristbands');
  const items = d.items;
  v.innerHTML = `
    <div class="card mgr"><div class="section-title" id="wb-title">Register a wristband</div>
      <input id="wb-id" type="hidden">
      <div class="grid g-2">
        <label class="field"><span>Band id</span><input id="wb-bandId" placeholder="KID-042"></label>
        <label class="field"><span>Child name</span><input id="wb-childName"></label>
        <label class="field"><span>Age band</span><input id="wb-ageBand" placeholder="child"></label>
        <label class="field"><span>Guardian name</span><input id="wb-guardianName"></label>
        <label class="field"><span>Guardian phone</span><input id="wb-guardianPhone" placeholder="+9198…"></label>
        <label class="field"><span>Zone</span><input id="wb-zone"></label>
      </div>
      <label class="field"><span>Notes</span><textarea id="wb-notes"></textarea></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="wb-save">Save band</button><button class="btn ghost" id="wb-clear">Clear</button></div>
      <p class="hint">Staff look these up offline by band id at the gate to reach a lost child’s guardian.</p>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Registered bands (${items.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Band</th><th>Child</th><th>Guardian</th><th>Phone</th><th>Zone</th><th>Actions</th></tr></thead><tbody>
        ${items.length ? items.map((b) => `<tr data-id="${esc(b.bandId)}"><td class="mono">${esc(b.bandId)}</td><td>${esc(b.childName)}${b.ageBand ? ` · ${esc(b.ageBand)}` : ''}</td><td>${esc(b.guardianName || '—')}</td><td class="mono">${esc(b.guardianPhone)}</td><td>${esc(b.zone || '')}</td><td><div class="row wrap"><button class="btn ghost sm ed-edit">Edit</button><button class="btn ghost sm ed-del">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No wristbands registered.</td></tr>'}
      </tbody></table></div>
    </div>`;
  wireCrud(v, {
    kind: 'wb', path: '/admin/wristbands', view: 'wristbands', items: items.map((b) => ({ ...b, id: b.bandId })), noun: 'wristband',
    collect: () => {
      const bandId = $('#wb-bandId').value.trim(); const childName = $('#wb-childName').value.trim(); const guardianPhone = $('#wb-guardianPhone').value.trim();
      if (!bandId || !childName || !guardianPhone) { toast('Band id, child name and guardian phone are required', 'bad'); return null; }
      return { bandId, childName, ageBand: $('#wb-ageBand').value.trim(), guardianName: $('#wb-guardianName').value.trim(), guardianPhone, zone: $('#wb-zone').value.trim(), notes: $('#wb-notes').value.trim() };
    },
    fill: (b) => { $('#wb-bandId').value = b.bandId || ''; $('#wb-childName').value = b.childName || ''; $('#wb-ageBand').value = b.ageBand || ''; $('#wb-guardianName').value = b.guardianName || ''; $('#wb-guardianPhone').value = b.guardianPhone || ''; $('#wb-zone').value = b.zone || ''; $('#wb-notes').value = b.notes || ''; },
    clear: () => { ['bandId', 'childName', 'ageBand', 'guardianName', 'guardianPhone', 'zone', 'notes'].forEach((f) => $('#wb-' + f).value = ''); },
  });
};

VIEWS.audit = async (v) => {
  if (!cap('audit.read')) { v.innerHTML = notPermitted('audit'); return; }
  const d = await api('GET', '/admin/audit'); const rows = d.items;
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Audit entries', rows.length, 'sensitive actions')}
      ${kpiCard('Actors', new Set(rows.map((r) => r.actor)).size, 'distinct admins')}
      ${kpiCard('Latest', rows[0] ? fmtTime(rows[0].ts) : '—', rows[0] ? esc(rows[0].action) : 'none yet')}
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title">Audit log (${rows.length})</div>
      <p class="hint" style="margin-bottom:10px">Who did what, when — pass revocations, fly-status calls, order/refund actions, admin &amp; user governance. Newest first.</p>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Actor</th><th>Tier</th><th>Action</th><th>Detail</th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => `<tr><td class="mono">${fmtTime(r.ts)}</td><td class="mono">${esc(r.actor)}</td><td><span class="tier-badge t${r.tier}">T${r.tier}</span></td><td><span class="pill info">${esc(r.action)}</span></td><td>${esc(r.detail || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No audit entries yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
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
const CAP_LABELS = {
  'analytics.read': 'monitoring', 'admin.manage': 'manage lower tiers', 'faq.write': 'knowledge & FAQ',
  'pass.revoke': 'revoke passes', 'flystatus.set': 'fly-status', 'schedule.manage': 'schedule',
  'stalls.manage': 'stalls', 'lodging.manage': 'lodging', 'volunteers.manage': 'volunteers',
  'incidents.manage': 'incident triage', 'announce.write': 'announcements',
  'pricing.manage': 'prices', 'orders.manage': 'orders & refunds', 'users.manage': 'app users & roles', 'catalog.manage': 'catalog & gates',
  'wristband.manage': 'wristbands', 'audit.read': 'audit log',
};
function tierCaps(t) {
  return Object.entries(CAPS).filter(([, ts]) => ts.includes(t)).map(([k]) => CAP_LABELS[k]).filter(Boolean).join(' · ');
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

/* generic create/edit/delete wiring for the management views. Each view builds
   a form (#{kind}-* inputs, a hidden #{kind}-id, #{kind}-save/#{kind}-clear) and
   a table whose rows carry data-id + .ed-edit/.ed-del buttons. */
function wireCrud(root, o) {
  const idEl = $('#' + o.kind + '-id');
  const titleEl = $('#' + o.kind + '-title');
  const defTitle = titleEl ? titleEl.textContent : '';
  const resetForm = () => { o.clear(); if (idEl) idEl.value = ''; if (titleEl) titleEl.textContent = defTitle; };
  const saveBtn = $('#' + o.kind + '-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const body = o.collect(); if (!body) return;
    if (idEl && idEl.value) body.id = idEl.value;
    saveBtn.disabled = true; const label = saveBtn.textContent; saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
    try { await api('POST', o.path, body); toast(`${cap0(o.noun)} saved`, 'good'); setView(o.view); }
    catch (e) { toast(e.message, 'bad'); saveBtn.disabled = false; saveBtn.textContent = label; }
  });
  const clearBtn = $('#' + o.kind + '-clear');
  if (clearBtn) clearBtn.addEventListener('click', resetForm);
  $$('.ed-edit', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('tr').dataset.id; const row = o.items.find((x) => String(x.id) === String(id));
    if (!row) return;
    o.fill(row); if (idEl) idEl.value = id; if (titleEl) titleEl.textContent = 'Edit ' + o.noun;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $$('.ed-del', root).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    if (!confirm(`Delete this ${o.noun}? This cannot be undone.`)) return;
    try { await api('DELETE', `${o.path}/${encodeURIComponent(id)}`); toast(`${cap0(o.noun)} deleted`, 'good'); setView(o.view); }
    catch (e) { toast(e.message, 'bad'); }
  }));
}
const cap0 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function notPermitted(what) {
  return `<div class="card"><h3>Not available</h3><p class="hint">Your tier cannot manage ${esc(what)}.</p></div>`;
}
// Festival times are Asia/Kolkata (UTC+05:30). Convert to/from epoch seconds.
function epochFrom(day, hhmm) {
  if (!day) return 0;
  const ms = Date.parse(`${day}T${hhmm || '00:00'}:00+05:30`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
function hhmmFrom(s) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(s * 1000));
    return `${p.find((x) => x.type === 'hour').value}:${p.find((x) => x.type === 'minute').value}`;
  } catch { return '18:00'; }
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
