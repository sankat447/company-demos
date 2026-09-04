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
const TITLES = { overview: 'Overview', fly: 'Fly-status', kb: 'Knowledge & AI', passes: 'Passes', reference: 'Reference' };
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
  const [fly, revs, sched, tiers, faqs] = await Promise.all([
    getFly().catch(() => null), getRevs().catch(() => []), getSchedule().catch(() => []),
    getTiers().catch(() => []), listFaqs().catch(() => []),
  ]);
  const flyCls = fly ? fly.state : '';
  v.innerHTML = `
    <div class="grid g-4">
      ${statCard('Fly-status', fly ? fly.state : '—', flyCls)}
      ${statCard('FAQs live', faqs.length)}
      ${statCard('Revocations', revs.length)}
      ${statCard('Schedule items', sched.length)}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card">
        <div class="section-title">Quick fly-status</div>
        <p class="hint" style="margin-bottom:12px">${has('safety-officer') ? 'Sets the official banner + fans out to every device.' : 'Read-only — needs the safety-officer role to change.'}</p>
        <div class="fly-btns">
          ${['flying', 'hold', 'closed'].map((s) => `<button class="fly-btn ${s} ${fly && fly.state === s ? 'on' : ''}" data-fly="${s}" ${has('safety-officer') ? '' : 'disabled'}>${s.toUpperCase()}</button>`).join('')}
        </div>
        ${fly && fly.refundsAutoQueued ? '<p class="hint" style="margin-top:10px;color:var(--warn)">Refunds are auto-queued (sky is closed).</p>' : ''}
      </div>
      <div class="card">
        <div class="section-title">Ask the assistant</div>
        <p class="hint" style="margin-bottom:12px">Check what visitors are told — answers are grounded in your FAQs + knowledge base.</p>
        <div class="stack">
          <input id="ov-ask" placeholder="e.g. Where is lost and found?">
          <button class="btn primary" id="ov-ask-btn">Ask</button>
          <div id="ov-reply"></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">Recent revocations</div>
      ${revs.length ? tableRevs(revs.slice(0, 6)) : '<p class="empty">No revoked passes.</p>'}
    </div>`;
  wireFlyButtons(v);
  $('#ov-ask-btn').addEventListener('click', () => runAsk($('#ov-ask').value, $('#ov-reply')));
  $('#ov-ask').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk($('#ov-ask').value, $('#ov-reply')); });
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
