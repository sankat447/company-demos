/* Bir Festival Ops Console — vanilla, no build. Talks to the live stack:
   Cognito (OTP auth) → AppSync GraphQL + the HTTP API (/ai/*). */
'use strict';
const CFG = window.BIR_CONFIG;
const OPS_GROUPS = ['organiser-lite', 'safety-officer', 'admin-hospitality'];
const SESSION_KEY = 'bir.admin.session.v1';

const state = { idToken: null, refreshToken: null, phone: null, claims: null, groups: [] };

/* ------------------------------ tiny helpers ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (g) => state.groups.includes(g);
function toast(msg, kind = '') {
  const t = $('#toast');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}
function decodeJwt(tok) {
  try {
    const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p + '==='.slice((p.length + 3) % 4)))));
  } catch {
    return null;
  }
}
function fmtTime(epochSec) {
  if (!epochSec) return '—';
  try {
    return new Date(epochSec * 1000).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(epochSec);
  }
}

/* ------------------------------ Cognito auth ------------------------------ */
async function cognito(target, body) {
  const r = await fetch(`https://cognito-idp.${CFG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || (j.__type || '').split('#').pop() || 'authentication failed');
  return j;
}
const initiateOtp = (phone) =>
  cognito('InitiateAuth', { AuthFlow: 'CUSTOM_AUTH', ClientId: CFG.clientId, AuthParameters: { USERNAME: phone } });
const answerOtp = (phone, session, otp) =>
  cognito('RespondToAuthChallenge', {
    ChallengeName: 'CUSTOM_CHALLENGE', ClientId: CFG.clientId, Session: session,
    ChallengeResponses: { USERNAME: phone, ANSWER: otp },
  });

function setSession(idToken, refreshToken, phone) {
  state.idToken = idToken;
  if (refreshToken) state.refreshToken = refreshToken;
  state.phone = phone || state.phone;
  state.claims = decodeJwt(idToken) || {};
  const g = state.claims['cognito:groups'];
  state.groups = Array.isArray(g) ? g : g ? [g] : [];
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ idToken, refreshToken: state.refreshToken, phone: state.phone }));
  } catch {}
}
async function ensureToken() {
  const exp = (state.claims && state.claims.exp) || 0;
  if (exp * 1000 - Date.now() > 60000) return; // still valid
  if (!state.refreshToken) return; // let the call 401 → re-login
  try {
    const j = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CFG.clientId, AuthParameters: { REFRESH_TOKEN: state.refreshToken },
    });
    const r = j.AuthenticationResult;
    if (r && r.IdToken) setSession(r.IdToken, state.refreshToken, state.phone);
  } catch {}
}
function isOps() {
  return state.groups.some((g) => OPS_GROUPS.includes(g));
}

/* ------------------------------ live API ---------------------------------- */
async function gql(query, variables) {
  await ensureToken();
  const r = await fetch(CFG.graphql, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: state.idToken },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
async function rest(method, path, body) {
  await ensureToken();
  const opt = { method, headers: { authorization: 'Bearer ' + state.idToken } };
  if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(CFG.restBase + path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.error || `${method} ${path} → ${r.status}`);
  return j;
}

/* operations */
const Q_FLY = 'query{flyStatus{state reasonEn reasonHi updatedAt refundsAutoQueued}}';
const M_FLY = 'mutation($i:SetFlyStatusInput!){setFlyStatus(input:$i){state refundsAutoQueued updatedAt}}';
const Q_REVS = 'query{revocationsDelta(since:0){items{jti revokedAt} cursor}}';
const M_REVOKE = 'mutation($i:RevokePassInput!){revokePass(input:$i){accepted}}';
const Q_SCHED = 'query{scheduleDelta(since:0){items{id day venue startsAt titleEn titleHi data} cursor}}';
const Q_TIERS = 'query{ticketTiers{items{id titleEn titleHi priceInr description}}}';

const getFly = () => gql(Q_FLY).then((d) => d.flyStatus);
const setFly = (state_, reasonEn, reasonHi) =>
  gql(M_FLY, { i: { state: state_, reasonEn, reasonHi, declaredBy: state.phone || 'ops-console', idempotencyKey: `fly:${Date.now()}` } });
const getRevs = () => gql(Q_REVS).then((d) => d.revocationsDelta.items || []);
const revoke = (jti) => gql(M_REVOKE, { i: { jti, idempotencyKey: `revoke:${jti}` } });
const getSchedule = () => gql(Q_SCHED).then((d) => d.scheduleDelta.items || []);
const getTiers = () => gql(Q_TIERS).then((d) => (d.ticketTiers ? d.ticketTiers.items : []));
const listFaqs = () => rest('GET', '/ai/faq').then((d) => d.items || []);
const upsertFaq = (f) => rest('POST', '/ai/faq', f);
const deleteFaq = (id) => rest('DELETE', '/ai/faq/' + encodeURIComponent(id));
const ask = (message) => rest('POST', '/ai/assistant', { message });
const admin = (name) => rest('GET', '/admin/' + name);
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

/* ------------------------------ login wiring ------------------------------ */
let pendingSession = null;
function showLoginError(msg) {
  const e = $('#login-error');
  e.textContent = msg;
  e.classList.toggle('hidden', !msg);
}
$('#phone-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  showLoginError('');
  const phone = $('#phone').value.trim();
  const btn = $('#send-otp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    const j = await initiateOtp(phone);
    pendingSession = j.Session;
    state.phone = phone;
    $('#phone-form').classList.add('hidden');
    $('#otp-form').classList.remove('hidden');
    $('#otp').focus();
  } catch (e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Send code';
  }
});
$('#otp-back').addEventListener('click', () => {
  $('#otp-form').classList.add('hidden');
  $('#phone-form').classList.remove('hidden');
  showLoginError('');
});
$('#otp-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  showLoginError('');
  const otp = $('#otp').value.trim();
  const btn = $('#verify-otp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Verifying…';
  try {
    const j = await answerOtp(state.phone, pendingSession, otp);
    const r = j.AuthenticationResult;
    if (!r || !r.IdToken) throw new Error('Incorrect code — try again.');
    setSession(r.IdToken, r.RefreshToken, state.phone);
    if (!isOps()) {
      signOut();
      showLoginError('This account has no organiser role. Ask an admin to add you to organiser-lite, safety-officer, or admin-hospitality.');
      return;
    }
    enterApp();
  } catch (e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Verify & enter';
  }
});

function signOut() {
  state.idToken = state.refreshToken = state.claims = null;
  state.groups = [];
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#otp-form').classList.add('hidden');
  $('#phone-form').classList.remove('hidden');
  $('#otp').value = '';
}
$('#signout').addEventListener('click', signOut);

/* ------------------------------ app shell --------------------------------- */
function enterApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const roleLabel = state.groups.filter((g) => OPS_GROUPS.includes(g)).join(' · ') || 'organiser';
  $('#who').textContent = roleLabel;
  refreshFlyChip();
  setView('overview');
}
$('#refresh').addEventListener('click', () => setView(currentView));
$$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let currentView = 'overview';
const TITLES = {
  overview: 'Overview', visitors: 'Visitors & tickets', stalls: 'Stalls', lodging: 'Lodging',
  volunteers: 'Volunteers', incidents: 'Incidents', fly: 'Fly-status', kb: 'Knowledge & AI',
  passes: 'Passes', reference: 'Schedule & tiers',
};
async function setView(name) {
  currentView = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#crumb').textContent = TITLES[name] || name;
  const v = $('#view');
  v.innerHTML = '<p class="empty"><span class="spinner"></span> Loading…</p>';
  try {
    await VIEWS[name](v);
  } catch (e) {
    v.innerHTML = `<div class="card"><h3>Couldn't load</h3><p class="hint">${esc(e.message)}</p></div>`;
  }
}
async function refreshFlyChip() {
  try {
    const f = await getFly();
    const chip = $('#fly-chip');
    chip.className = 'chip ' + (f ? f.state : '');
    chip.textContent = 'fly-status: ' + (f ? f.state : '—');
  } catch {}
}

/* ------------------------------ views ------------------------------------- */
const VIEWS = {};

VIEWS.overview = async (v) => {
  const s = await admin('summary');
  const flyCls = s.fly ? s.fly.state : '';
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Fly-status', s.fly ? s.fly.state : '—', s.fly && s.fly.refundsAutoQueued ? 'refunds auto-queued' : 'official call', flyCls)}
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
        <p class="hint" style="margin-bottom:10px">${has('safety-officer') ? 'Set the official fly-status — fans out to every device.' : 'Fly-status is read-only for your role.'}</p>
        <div class="fly-btns">
          ${['flying', 'hold', 'closed'].map((st) => `<button class="fly-btn ${st} ${s.fly && s.fly.state === st ? 'on' : ''}" data-fly="${st}" ${has('safety-officer') ? '' : 'disabled'}>${st.toUpperCase()}</button>`).join('')}
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
  const d = await admin('visitors');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Registrations', d.registrations.total, 'across all activities')}
      ${kpiCard('Tickets confirmed', d.tickets.confirmed, `${d.tickets.total} orders total`)}
      ${kpiCard('Ticket revenue', inr(d.tickets.revenueInr), 'confirmed orders')}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card">
        <div class="section-title">Registrations by activity</div>
        ${d.registrations.byItem.length ? bars(d.registrations.byItem.map((x) => ({ label: x.item, value: x.total })), 'slate') : '<p class="empty">No registrations yet.</p>'}
      </div>
      <div class="card">
        <div class="section-title">Registration status</div>
        ${bars(Object.entries(d.registrations.byStatus).map(([k, n]) => ({ label: k, value: n })), 'pine')}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Ticket sales by tier</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Tier</th><th>Sold</th><th>Revenue</th></tr></thead><tbody>
        ${d.tickets.byTier.length ? d.tickets.byTier.map((t) => `<tr><td>${esc(t.tier)}</td><td class="mono">${t.count}</td><td class="mono">${inr(t.revenueInr)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">No confirmed ticket orders yet.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.stalls = async (v) => {
  const d = await admin('stalls');
  const st = d.items;
  const totalOrders = st.reduce((n, s) => n + s.ordersEstimate, 0);
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Stalls', st.length, `${st.filter((s) => s.paid).length} fees paid`)}
      ${kpiCard('Est. orders (3 days)', totalOrders.toLocaleString('en-IN'), 'across all stalls')}
      ${kpiCard('Fees billed', inr(st.reduce((n, s) => n + s.feeInr, 0)), `${st.filter((s) => !s.paid).length} unpaid`)}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Food street (${st.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Stall</th><th>Category</th><th>Stage</th><th>Allocation</th><th>Fee</th><th>Est. orders</th><th>Footfall</th></tr></thead><tbody>
        ${st.length ? st.map((s) => `<tr>
          <td>${esc(s.stallName)}</td><td>${esc(s.category || '')}</td>
          <td><span class="pill ${s.stage === 'approved' ? 'good' : 'info'}">${esc(s.stage || '—')}</span></td>
          <td class="mono">${esc(s.allocationLabel || '')}</td>
          <td class="mono">${inr(s.feeInr)} ${s.paid ? '<span class="pill good">paid</span>' : '<span class="pill bad">due</span>'}</td>
          <td class="mono">${s.ordersEstimate.toLocaleString('en-IN')}</td>
          <td>${footfallBar(s.footfallIndex)}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty">No stalls.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.lodging = async (v) => {
  const d = await admin('lodging');
  const beds = d.hotels.reduce((n, h) => n + h.capacity, 0);
  const comp = d.partners.reduce((n, p) => n + p.complimentaryRooms, 0);
  const checkedIn = d.partners.reduce((n, p) => n + p.checkedIn, 0);
  const alloc = d.partners.reduce((n, p) => n + p.allocations, 0);
  v.innerHTML = `
    <div class="grid g-4">
      ${kpiCard('Rooms', d.hotels.reduce((n, h) => n + h.rooms, 0), `${beds} beds · ${d.hotels.length} hotels`)}
      ${kpiCard('Need lodging', d.pool.needLodging, `of ${d.pool.total} registrants`)}
      ${kpiCard('Complimentary', comp, 'partner rooms')}
      ${kpiCard('Checked in', checkedIn, `of ${alloc} allocations`)}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card">
        <div class="section-title">Beds by hotel</div>
        ${bars(d.hotels.map((h) => ({ label: h.hotel, value: h.capacity })), 'mar')}
      </div>
      <div class="card">
        <div class="section-title">Hospitality partners</div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Hotel</th><th>Comp.</th><th>Allocated</th><th>Checked in</th></tr></thead><tbody>
          ${d.partners.length ? d.partners.map((p) => `<tr><td>${esc(p.hotelName || '')}</td><td class="mono">${p.complimentaryRooms}</td><td class="mono">${p.allocations}</td><td class="mono">${p.checkedIn}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No partners.</td></tr>'}
        </tbody></table></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Room inventory</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Hotel</th><th>Rooms</th><th>Beds</th><th>Active</th></tr></thead><tbody>
        ${d.hotels.map((h) => `<tr><td>${esc(h.hotel)}</td><td class="mono">${h.rooms}</td><td class="mono">${h.capacity}</td><td class="mono">${h.active}/${h.rooms}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
};

VIEWS.volunteers = async (v) => {
  const d = await admin('volunteers');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Volunteers', d.total, `${d.idVerified} ID-verified`)}
      ${kpiCard('Shifts assigned', d.items.reduce((n, x) => n + x.shifts, 0), 'across the roster')}
      ${kpiCard('Attendance records', d.attendanceRecords, 'check-ins logged')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Roster (${d.total})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th><th>Team</th><th>Shifts</th><th>ID verified</th></tr></thead><tbody>
        ${d.items.length ? d.items.map((x) => `<tr><td>${esc(x.name || '')}</td><td>${esc(x.team || '')}</td><td class="mono">${x.shifts}</td><td>${x.idVerified ? '<span class="pill good">yes</span>' : '<span class="pill">no</span>'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No volunteers.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.incidents = async (v) => {
  const d = await admin('incidents');
  v.innerHTML = `
    <div class="grid g-3">
      ${kpiCard('Incidents', d.total, 'reported from the field')}
      ${kpiCard('Categories', Object.keys(d.byCategory).length, 'distinct types')}
      ${kpiCard('Latest', d.items[0] ? fmtTime(d.items[0].ts) : '—', d.items[0] ? esc(d.items[0].zone || '') : 'none yet')}
    </div>
    ${Object.keys(d.byCategory).length ? `<div class="card" style="margin-top:16px"><div class="section-title">By category</div>${bars(Object.entries(d.byCategory).map(([k, n]) => ({ label: k, value: n })), 'slate')}</div>` : ''}
    <div class="card" style="margin-top:16px">
      <div class="section-title">Incident log</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Category</th><th>Zone</th><th>Note</th></tr></thead><tbody>
        ${d.items.length ? d.items.map((i) => `<tr><td class="mono">${fmtTime(i.ts)}</td><td><span class="pill info">${esc(i.category || '')}</span></td><td>${esc(i.zone || '')}</td><td>${esc(i.note || '')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No incidents reported — all clear.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

VIEWS.fly = async (v) => {
  const fly = await getFly().catch(() => null);
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Current</div>
        <div class="stat"><span class="k">State</span><span class="v ${fly ? fly.state : ''}" style="color:var(--${fly ? ({flying:'good',hold:'warn',closed:'bad'}[fly.state]||'text') : 'text'})">${fly ? fly.state : '—'}</span></div>
        <p class="hint" style="margin-top:10px">${fly && fly.reasonEn ? esc(fly.reasonEn) : ''}</p>
        <p class="mono" style="color:var(--faint);font-size:12px;margin-top:8px">updated ${fly ? fmtTime(fly.updatedAt) : '—'}${fly && fly.refundsAutoQueued ? ' · refunds auto-queued' : ''}</p>
      </div>
      <div class="card">
        <div class="section-title">Declare</div>
        ${has('safety-officer') ? `
        <div class="stack">
          <label class="field"><span>Reason (English)</span><input id="fly-en" placeholder="e.g. High winds at Billing"></label>
          <label class="field"><span>Reason (Hindi)</span><input id="fly-hi" placeholder="बिलिंग में तेज़ हवाएँ"></label>
          <div class="fly-btns">
            ${['flying', 'hold', 'closed'].map((s) => `<button class="fly-btn ${s}" data-fly="${s}">${s.toUpperCase()}</button>`).join('')}
          </div>
          <p class="hint">Closing flying auto-queues refunds for affected bookings and fans the status out to every device.</p>
        </div>` : '<p class="hint">Only the <b>safety-officer</b> role can declare fly-status.</p>'}
      </div>
    </div>`;
  wireFlyButtons(v);
};

VIEWS.kb = async (v) => {
  const faqs = await listFaqs().catch(() => []);
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Add / update FAQ</div>
        <div class="stack">
          <label class="field"><span>Question</span><input id="faq-q" placeholder="Where can I park?"></label>
          <label class="field"><span>Answer</span><textarea id="faq-a" placeholder="Paid parking is at the Billing landing field; free shuttle to the ground every 20 min."></textarea></label>
          <input id="faq-id" type="hidden">
          <div class="row"><button class="btn primary" id="faq-save">Save FAQ</button><button class="btn ghost" id="faq-clear">Clear</button></div>
          <p class="hint">FAQs take effect on the next question — no deploy. ${has('organiser-lite') || has('safety-officer') ? '' : '<b>Needs organiser role.</b>'}</p>
        </div>
      </div>
      <div class="card">
        <div class="section-title">Test the assistant</div>
        <div class="stack">
          <input id="kb-ask" placeholder="Ask what a visitor would ask…">
          <button class="btn primary" id="kb-ask-btn">Ask</button>
          <div id="kb-reply"></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Live FAQs (${faqs.length})</div>
      <div id="faq-list" class="grid" style="gap:10px">
        ${faqs.length ? faqs.map(faqCard).join('') : '<p class="empty">No FAQs yet — add the first one above.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Knowledge base documents</div>
      <p class="hint">Drop festival rules &amp; instructions (Markdown / text) into the knowledge bucket — the assistant ingests and cites them automatically.</p>
      <div class="codebox" style="margin-top:10px">aws s3 cp festival-rules.md s3://${esc(CFG.kbBucket)}/kb/festival-rules.md --profile rhoai-demo</div>
    </div>`;
  $('#faq-save').addEventListener('click', saveFaq);
  $('#faq-clear').addEventListener('click', () => { $('#faq-q').value = ''; $('#faq-a').value = ''; $('#faq-id').value = ''; });
  $('#kb-ask-btn').addEventListener('click', () => runAsk($('#kb-ask').value, $('#kb-reply')));
  $('#kb-ask').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk($('#kb-ask').value, $('#kb-reply')); });
  wireFaqCards(v);
};

VIEWS.passes = async (v) => {
  const revs = await getRevs().catch(() => []);
  v.innerHTML = `
    <div class="grid g-2">
      <div class="card">
        <div class="section-title">Revoke a pass</div>
        <div class="stack">
          <label class="field"><span>Pass ID (jti)</span><input id="rev-jti" placeholder="the pass jti to revoke"></label>
          <button class="btn danger" id="rev-btn" ${has('organiser-lite') || has('safety-officer') ? '' : 'disabled'}>Revoke pass</button>
          <p class="hint">Revoking fans out to every device; the offline gate scanner rejects this pass on its next sync. Use for lost or fraudulent passes.${has('organiser-lite') || has('safety-officer') ? '' : ' <b>Needs organiser role.</b>'}</p>
        </div>
      </div>
      <div class="card">
        <div class="stat"><span class="k">Revoked passes</span><span class="v">${revs.length}</span></div>
        <p class="hint" style="margin-top:8px">Total in the revocation feed devices pull.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Revocation feed</div>
      ${revs.length ? tableRevs(revs) : '<p class="empty">No revoked passes.</p>'}
    </div>`;
  $('#rev-btn').addEventListener('click', async () => {
    const jti = $('#rev-jti').value.trim();
    if (!jti) return;
    const b = $('#rev-btn'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Revoking…';
    try {
      await revoke(jti);
      toast('Pass revoked — fanning out to devices', 'good');
      setView('passes');
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Revoke pass'; }
  });
};

VIEWS.reference = async (v) => {
  const [sched, tiers] = await Promise.all([getSchedule().catch(() => []), getTiers().catch(() => [])]);
  v.innerHTML = `
    <div class="card">
      <div class="section-title">Ticket tiers</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Tier</th><th>English</th><th>Hindi</th><th>Price ₹</th></tr></thead><tbody>
        ${tiers.length ? tiers.map((t) => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.titleEn)}</td><td>${esc(t.titleHi || '')}</td><td>${t.priceInr}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No tiers.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Schedule (${sched.length})</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Day</th><th>Starts</th><th>Venue</th><th>Event</th><th>Votable</th></tr></thead><tbody>
        ${sched.length ? sched.sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0)).map(schedRow).join('') : '<tr><td colspan="5" class="empty">No schedule items.</td></tr>'}
      </tbody></table></div>
    </div>`;
};

/* ------------------------------ view helpers ------------------------------ */
function statCard(k, val, cls = '') {
  const color = { flying: 'good', hold: 'warn', closed: 'bad' }[cls];
  return `<div class="card stat"><span class="k">${esc(k)}</span><span class="v${String(val).length > 6 ? ' small' : ''}"${color ? ` style="color:var(--${color})"` : ''}>${esc(val)}</span></div>`;
}
function kpiCard(k, val, sub = '', flyCls = '') {
  const color = { flying: 'good', hold: 'warn', closed: 'bad' }[flyCls];
  const big = String(val).length > 7;
  return `<div class="card kpi">
    <span class="k">${esc(k)}</span>
    <span class="v"${color ? ` style="color:var(--${color})"` : ''}${big ? ' style="font-size:1.4rem"' : ''}>${esc(val)}</span>
    ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
  </div>`;
}
function bars(data, tone = 'pine') {
  const rows = data.filter((d) => d.value != null);
  if (!rows.length) return '<p class="empty">No data.</p>';
  const max = Math.max(...rows.map((d) => d.value), 1);
  return `<div class="bars">${rows
    .map((d) => `<div class="bar-row"><span class="lbl">${esc(d.label)}</span>
      <span class="bar-track"><span class="bar-fill ${tone}" style="width:${Math.max(3, Math.round((d.value / max) * 100))}%"></span></span>
      <span class="num">${Number(d.value).toLocaleString('en-IN')}</span></div>`)
    .join('')}</div>`;
}
function footfallBar(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const tone = p >= 80 ? 'mar' : p >= 50 ? '' : 'slate';
  return `<span class="bar-track" style="display:inline-block;width:64px;vertical-align:middle"><span class="bar-fill ${tone}" style="width:${p}%"></span></span> <span class="mono">${p}</span>`;
}
function tableRevs(revs) {
  return `<div class="scroll-x"><table class="tbl"><thead><tr><th>Pass jti</th><th>Revoked</th></tr></thead><tbody>
    ${revs.map((r) => `<tr><td class="mono">${esc(r.jti)}</td><td>${fmtTime(r.revokedAt)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function schedRow(s) {
  let votable = '';
  try { votable = JSON.parse(s.data || '{}').votable ? '<span class="pill info">votable</span>' : ''; } catch {}
  return `<tr><td>${esc(s.day)}</td><td class="mono">${fmtTime(s.startsAt)}</td><td>${esc(s.venue || '')}</td><td>${esc(s.titleEn || '')}</td><td>${votable}</td></tr>`;
}
function faqCard(f) {
  return `<div class="faq" data-id="${esc(f.id)}">
    <div class="q">${esc(f.question)}</div>
    <div class="a">${esc(f.answer)}</div>
    <div class="faq-actions">
      <button class="btn ghost sm faq-edit">Edit</button>
      <button class="btn ghost sm faq-del">Delete</button>
    </div>
  </div>`;
}
function wireFaqCards(root) {
  $$('.faq', root).forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('.faq-edit').addEventListener('click', () => {
      $('#faq-id').value = id;
      $('#faq-q').value = card.querySelector('.q').textContent;
      $('#faq-a').value = card.querySelector('.a').textContent;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    card.querySelector('.faq-del').addEventListener('click', async () => {
      if (!confirm('Delete this FAQ?')) return;
      try { await deleteFaq(id); toast('FAQ deleted', 'good'); setView('kb'); }
      catch (e) { toast(e.message, 'bad'); }
    });
  });
}
async function saveFaq() {
  const question = $('#faq-q').value.trim();
  const answer = $('#faq-a').value.trim();
  const id = $('#faq-id').value.trim();
  if (!question || !answer) return toast('Question and answer are required', 'bad');
  const b = $('#faq-save'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    await upsertFaq(id ? { id, question, answer } : { question, answer });
    toast('FAQ saved — live now', 'good');
    setView('kb');
  } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Save FAQ'; }
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
      try {
        await setFly(s, en, hi);
        toast(`Fly-status set to ${s} — fanning out`, 'good');
        refreshFlyChip();
        setView(currentView);
      } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    });
  });
}
function defaultReason(s, lang) {
  const m = {
    flying: { en: 'Clear skies over Billing', hi: 'बिलिंग के ऊपर साफ़ आसमान' },
    hold: { en: 'Conditions under review', hi: 'परिस्थितियों की समीक्षा जारी' },
    closed: { en: 'Flying closed for safety', hi: 'सुरक्षा के लिए उड़ान बंद' },
  };
  return m[s][lang];
}
async function runAsk(message, target) {
  message = (message || '').trim();
  if (!message) return;
  target.innerHTML = '<p class="hint"><span class="spinner"></span> Thinking…</p>';
  try {
    const r = await ask(message);
    target.innerHTML = `${r.grounded ? '<span class="pill good">grounded in KB</span>' : '<span class="pill">general</span>'}
      <div class="reply" style="margin-top:8px">${esc(r.reply)}</div>`;
  } catch (e) {
    target.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

/* ------------------------------ boot -------------------------------------- */
(function boot() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.idToken) {
      setSession(s.idToken, s.refreshToken, s.phone);
      const exp = (state.claims && state.claims.exp) || 0;
      if ((exp * 1000 > Date.now() || state.refreshToken) && isOps()) {
        enterApp();
        return;
      }
    }
  } catch {}
  $('#login').classList.remove('hidden');
})();
