import { get, post, streamChat, resetChat } from "./api.js";

const TODAY = "2026-06-09";
const GRAFANA_DASH = "https://grafana-rhoai-monitoring.apps.ai-demo.iisdemolab.click/d/nychhc-workforce";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bClass = (t) => (t === "RED" ? "b-red" : t === "AMBER" ? "b-amber" : "b-green");
const pClass = (t) => (t === "RED" ? "r" : t === "AMBER" ? "a" : "g");

/* ---------------- SVG icons ---------------- */
const ICONS = {
  logo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 13v7M9 8v12M14 11v9M19 5v15"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>`,
  risk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17.2v.1"/></svg>`,
  pto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>`,
};
const TABS = {
  dashboard: { label: "Dashboard", icon: ICONS.dashboard },
  schedule: { label: "Schedule", icon: ICONS.calendar },
  risk: { label: "No-Show Risk", icon: ICONS.risk },
  pto: { label: "PTO", icon: ICONS.pto },
  planning: { label: "Planning", icon: ICONS.calendar },
  approvals: { label: "Approvals", icon: ICONS.pto },
  reporting: { label: "Reporting", icon: ICONS.dashboard },
  copilot: { label: "Assistant", icon: ICONS.chat },
};

/* ---------------- role / persona (OBGYN; UC1/DR-01 + UC6 + Leadership) ---------------- */
const ROLE_CONFIG = {
  Scheduler: { persona: "Selamawit M.", title: "Scheduling Lead", initials: "SM",
    sub: "no-show risk, coverage, and smart fills", tabs: ["dashboard", "schedule", "risk", "planning", "approvals", "copilot"] },
  Approver: { persona: "Marcus Ellison", title: "HR / Operational Manager", initials: "ME",
    sub: "PTO impact, coverage conflicts, and approvals", tabs: ["dashboard", "pto", "planning", "approvals", "copilot"] },
  Provider: { persona: "Dr. Sarah Chen", title: "Obstetrics · MD", initials: "SC",
    sub: "my schedule and time-off requests", tabs: ["schedule", "pto", "copilot"] },
  Leadership: { persona: "Dr. R. Adeyinka", title: "OBGYN Chair / CCO", initials: "RA",
    sub: "department throughput, coverage reliability, and utilization", tabs: ["reporting", "planning", "dashboard", "copilot"] },
};
let ROLE = "Scheduler";

function applyRole(role) {
  ROLE = role;
  if (typeof window !== "undefined") window.__ROLE = role;  // carried as X-NYCHHC-Roles
  const c = ROLE_CONFIG[role];
  document.querySelectorAll(".role-opt").forEach((x) => x.classList.toggle("active", x.dataset.role === role));
  $("#personaName").textContent = c.persona;
  $("#personaTitle").textContent = c.title;
  $("#personaAvatar").textContent = c.initials;
  $("#viewRole").textContent = role + " view";
  $("#viewSub").textContent = c.sub;
  buildTabs(c.tabs);
  switchTab(c.tabs[0]); // role's default landing tab
}

function buildTabs(tabs) {
  $("#tabbar").innerHTML = tabs.map((t, i) =>
    `<button class="tab${i === 0 ? " active" : ""}" data-tab="${t}">${TABS[t].icon}<span>${TABS[t].label}</span></button>`).join("");
  $("#tabbar").querySelectorAll(".tab").forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
}
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("show", x.id === tab));
  render(tab);
}

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }

/* ---------------- render dispatch ---------------- */
async function render(tab) {
  const host = $("#" + tab);
  try {
    if (tab === "dashboard") return renderDashboard(host);
    if (tab === "schedule") return renderSchedule(host);
    if (tab === "risk") return renderRisk(host);
    if (tab === "pto") return renderPto(host);
    if (tab === "planning") return renderPlanning(host);
    if (tab === "approvals") return renderApprovals(host);
    if (tab === "reporting") return renderReporting(host);
    if (tab === "copilot") return renderCopilot(host);
  } catch (e) {
    host.innerHTML = `<div class="card"><div class="card-b">Backend unreachable: ${esc(e.message)}</div></div>`;
  }
}

/* ---------------- charts ---------------- */
function donut(mix) {
  const total = (mix.RED + mix.AMBER + mix.GREEN) || 1, C = 2 * Math.PI * 54;
  let off = 0;
  const seg = (v, color) => { const len = (v / total) * C; const s = `<circle cx="70" cy="70" r="54" fill="none" stroke="${color}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += len; return s; };
  return `<svg viewBox="0 0 140 140" width="140" height="140">
    <circle cx="70" cy="70" r="54" fill="none" stroke="#efeae0" stroke-width="18"/>
    ${seg(mix.GREEN, "#5E7C58")}${seg(mix.AMBER, "#C08A2D")}${seg(mix.RED, "#B24A38")}
    <text x="70" y="66" font-size="24" font-weight="700" fill="#1F1E1C" text-anchor="middle" font-family="Fraunces,serif">${total}</text>
    <text x="70" y="84" font-size="10" fill="#9B9791" text-anchor="middle">appts</text></svg>`;
}
function bars(points) {
  const max = Math.max(...points.map((p) => Math.max(p.required, p.projected)), 1);
  const h = (v) => `${Math.round((v / max) * 120) + 2}px`;
  return `<div class="bars">${points.map((p) => {
    const d = new Date(p.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
    return `<div class="barcol"><div class="barpair"><div class="bb req" style="height:${h(p.required)}" title="required ${p.required}"></div><div class="bb sch" style="height:${h(p.projected)}" title="scheduled ${p.projected}"></div></div><div class="barlab">${d}${p.understaffed ? " ⚠" : ""}</div></div>`;
  }).join("")}</div>`;
}

/* ---------------- dashboard (KPIs + proactive insights) ---------------- */
async function renderDashboard(host) {
  const [k, strip] = await Promise.all([get("/api/data/kpis"), insightsStrip()]);
  const mix = k.risk_mix || { RED: 0, AMBER: 0, GREEN: 0 };
  const tile = (lab, val, sub) => `<div class="kpi"><span class="rail"></span><div class="lab">${lab}</div><div class="val">${val}</div><div class="delta">${sub}</div></div>`;
  host.innerHTML = `
    ${strip}
    <div class="toolbar" style="justify-content:flex-end;margin-bottom:6px"><a class="btn" href="${GRAFANA_DASH}" target="_blank" rel="noopener">Open in Grafana ↗</a></div>
    <div class="kpis">
      ${tile("Coverage today", `${k.coverage_pct}<small>%</small>`, "vs plan")}
      ${tile("Open shifts · 7d", k.open_shifts_7d, "smart-fill ready")}
      ${tile("Predicted no-shows", `${k.predicted_no_shows} <small>/ ${k.appts_today}</small>`, "today's panel")}
      ${tile("Overtime · week", `${k.overtime_h}<small>h</small>`, `target ${k.overtime_target}h`)}
      ${tile("Pending PTO", k.pending_pto, "awaiting decision")}
      ${tile("Appts today", k.appts_today, "scheduled")}
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-h"><div><h3>No-show risk mix</h3><div class="sub">Today · ${k.appts_today} scheduled appts</div></div></div>
        <div class="card-b"><div class="donut-wrap">${donut(mix)}
          <div class="donut-legend"><span><i style="background:#5E7C58"></i><b>${mix.GREEN}</b> Low (green)</span><span><i style="background:#C08A2D"></i><b>${mix.AMBER}</b> Watch (amber)</span><span><i style="background:#B24A38"></i><b>${mix.RED}</b> High (red)</span></div></div></div></div>
      <div class="card"><div class="card-h"><div><h3>Today at a glance</h3><div class="sub">Jump into Planning or the Assistant for detail</div></div></div>
        <div class="card-b">Use <b>Planning</b> for 90-day coverage, minute-weighted provider load, cancellation patterns and template recommendations — or ask the <b>Assistant</b> a plain-English question. Proactive patterns surface above.</div></div>
    </div>`;
  host.querySelectorAll("[data-ask]").forEach((b) => b.onclick = () => { window.__pendingAsk = b.dataset.ask; switchTab("copilot"); });
}

/* ---------------- schedule ---------------- */
async function renderSchedule(host) {
  const [roster, appts] = await Promise.all([get("/api/data/roster"), get("/api/sched/appointments", { date: TODAY })]);
  const mine = ROLE === "Provider";
  host.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h">
      <div><h3>${mine ? "My appointments" : "Appointments"} · ${TODAY}</h3><div class="sub">${appts.length} booked · OBGYN clinic</div></div>
      <div class="btn-row"><button class="btn primary" id="newAppt">New appointment</button><button class="btn" id="modAppt">Modify</button><button class="btn" id="canAppt">Cancel</button></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Time</th><th>Patient</th><th>MRN</th><th>Provider</th><th>Specialty</th><th>Type</th></tr></thead>
      <tbody>${appts.map((a) => `<tr><td><b>${esc(a.appt_time)}</b></td><td>${esc(a.patient_name)}</td><td class="mono">${esc(a.mrn)}</td><td>${esc(a.provider_name)}</td><td>${esc(a.specialty)}</td><td>${esc(a.type)}</td></tr>`).join("") || `<tr><td colspan="6" style="color:var(--ink-3)">No appointments.</td></tr>`}</tbody></table></div></div>
    <div class="card"><div class="card-h"><div><h3>Provider roster</h3><div class="sub">${roster.length} staff · contact &amp; status</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Provider</th><th>Role / license</th><th>Shift</th><th>Phone</th><th>Wk hrs</th><th>Status</th></tr></thead>
      <tbody>${roster.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.role)}<div class="mono">${esc(p.license)}</div></td><td>${esc(p.shift)}</td><td class="mono">${esc(p.phone)}</td><td><b>${esc(p.weekly_hours)}</b></td><td>${statusPill(p.status)}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#newAppt").onclick = () => openDrawer("new");
  $("#modAppt").onclick = () => openDrawer("modify");
  $("#canAppt").onclick = () => openDrawer("cancel");
}
const statusPill = (s) => s === "Available" ? '<span class="pill ok">Available</span>' : s === "OT watch" ? '<span class="pill pend">OT watch</span>' : `<span class="pill" style="background:var(--clay-tint);color:var(--clay-deep)">${esc(s)}</span>`;

/* ---------------- no-show risk ---------------- */
async function renderRisk(host) {
  const all = await get("/api/data/risk-list");
  let ms = { degraded: false };
  try { ms = await get("/api/data/model-status"); } catch {}
  const degBanner = ms.degraded
    ? `<div class="banner" style="background:#7a3b12;border-color:#a85a1f">⚠ Degraded mode — the No-Show model endpoint is unreachable; showing rules-based scores. No fabricated model output.</div>`
    : "";
  let filter = "ALL", q = "";
  const draw = () => {
    const rows = all.filter((r) => (filter === "ALL" || r.tier === filter) && (r.patient_name + r.mrn + r.provider + r.appt_time).toLowerCase().includes(q));
    $("#riskBody").innerHTML = rows.map((r) => {
      const f = Array.isArray(r.factors) ? r.factors : JSON.parse(r.factors || "[]");
      return `<tr><td><span class="badge ${bClass(r.tier)}">${r.tier}</span></td><td><b>${esc(r.patient_name)}</b></td><td class="mono">${esc(r.mrn)}</td><td class="mono">${esc(r.phone)}</td><td><b>${esc(r.appt_time)}</b></td><td>${esc(r.provider)}</td><td class="pct ${pClass(r.tier)}">${r.risk_pct}%</td><td><div class="factors">${f.map((x) => `<span class="factor">${esc(x)}</span>`).join("")}</div></td><td><button class="btn ${r.tier === "RED" ? "primary" : ""}">${esc(r.action)}</button></td></tr>`;
    }).join("");
  };
  host.innerHTML = `${degBanner}<div class="toolbar"><div class="seg" id="riskSeg"><button class="on">All</button><button>Red</button><button>Amber</button><button>Green</button></div><input class="search" id="riskSearch" placeholder="Search patient, MRN, provider…"><button class="btn primary">Text all RED</button></div>
    <div class="card"><div class="card-h"><div><h3>No-Show Risk · today</h3><div class="sub">Risk from the <b>No-Show KServe</b> model (rules fallback if down)</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Risk</th><th>Patient</th><th>MRN</th><th>Phone</th><th>Appt</th><th>Provider</th><th>Risk %</th><th>Top factors</th><th>Action</th></tr></thead><tbody id="riskBody"></tbody></table></div></div>`;
  draw();
  host.querySelectorAll("#riskSeg button").forEach((b) => b.onclick = () => { host.querySelectorAll("#riskSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); filter = b.textContent.toUpperCase(); draw(); });
  $("#riskSearch").oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
}

/* ---------------- PTO ---------------- */
async function renderPto(host) {
  const [queue, bal, provs] = await Promise.all([get("/api/data/pto-queue"), get("/api/data/balances"), allProviders()]);
  const isProvider = ROLE === "Provider";
  host.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>${isProvider ? "Request time off" : "Put a provider on PTO"}</h3><div class="sub">${isProvider ? "See the coverage impact before you submit" : "See impacted appointments and reassignment options"}</div></div></div>
      <div class="card-b"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
        <div class="field-row" style="margin:0"><label>Provider</label><select id="ptoProv">${provs.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.specialty)}</option>`).join("")}</select></div>
        <div class="field-row" style="margin:0"><label>Start</label><input id="ptoStart" type="date" value="2026-06-16"></div>
        <div class="field-row" style="margin:0"><label>End</label><input id="ptoEnd" type="date" value="2026-06-20"></div>
        <button class="btn primary" id="ptoRun">${isProvider ? "Preview impact" : "Compute impact"}</button></div>
        <div id="ptoImpact" style="margin-top:14px"></div></div></div>
    <div class="grid-2b">
      <div class="card"><div class="card-h"><div><h3>Time-off requests</h3><div class="sub">Coverage impact flagged automatically</div></div></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>Provider</th><th>Type</th><th>Dates</th><th>Coverage</th><th>Status</th></tr></thead>
        <tbody>${queue.map((p) => `<tr><td><b>${esc(p.provider_name)}</b></td><td>${esc(p.type)}</td><td class="mono">${esc(p.dates)}</td><td>${p.coverage_gap ? '<span class="gap-tag">Coverage gap</span>' : '<span style="color:var(--ok);font-weight:700">Covered</span>'}</td><td>${p.status === "ok" ? '<span class="pill ok">Approved</span>' : p.status === "pend" ? '<span class="pill pend">Pending</span>' : '<span class="pill no">Denied</span>'}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><div class="card-h"><div><h3>PTO balances</h3><div class="sub">Hours remaining · FY26</div></div></div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:14px">${bal.map((b) => `<div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px"><span style="font-weight:700">${esc(b.name)}</span><span class="mono">${b.hours} h</span></div><div class="bar"><span style="width:${b.pct}%"></span></div></div>`).join("")}</div></div>
    </div>`;
  $("#ptoRun").onclick = runPtoImpact;
}
async function runPtoImpact() {
  const pid = $("#ptoProv").value, start = $("#ptoStart").value, end = $("#ptoEnd").value;
  const box = $("#ptoImpact"); box.innerHTML = "Computing…";
  const imp = await get("/api/sched/pto-impact", { provider_id: pid, start, end });
  if (imp.error) { box.innerHTML = esc(imp.error); return; }
  box.innerHTML = `<div class="note"><b>${esc(imp.provider)}</b> · ${start} → ${end}: <b>${imp.impacted_count}</b> impacted · <b>${imp.auto_resolvable_count}</b> auto-resolvable · <b>${imp.needs_manual_count}</b> need attention.</div>
    ${imp.impacted.map((a) => { const opt = a.reassign_options[0] ? `Reassign → <b>${esc(a.reassign_options[0].provider)}</b>` : a.reschedule_options[0] ? `Reschedule → <b>${esc(a.reschedule_options[0].provider)}</b> ${a.reschedule_options[0].date}` : `<span style="color:var(--alert)">Manual</span>`;
      return `<div class="impact-row" style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(a.patient_name)}</b> · ${esc(a.appt_date)} ${esc(a.appt_time)} <span class="mono">${esc(a.mrn)}</span><div class="sub">${opt}</div></div><span class="badge ${a.recommendation === "reassign" ? "b-green" : a.recommendation === "reschedule" ? "b-amber" : "b-red"}">${a.recommendation}</span></div>`; }).join("")}
    ${imp.auto_resolvable_count ? `<button class="btn primary" id="applyAuto" style="margin-top:10px">Apply all auto (${imp.auto_resolvable_count})</button>` : ""}`;
  const btn = $("#applyAuto");
  if (btn) btn.onclick = async () => {
    const plan = imp.impacted.filter((a) => a.recommendation === "reassign").map((a) => ({ appt_id: a.id, provider_id: a.reassign_options[0].provider_id, date: a.appt_date, time: a.appt_time }));
    // UC6 HITL gate: propose → human approves → execute (nothing auto-applies; audited).
    const prop = await post("/api/actions/propose", { action: "pto_reassign", summary: `Reassign ${plan.length} appt(s) off ${imp.provider}`, rationale: "PTO coverage", payload: { plan } });
    const r = await post(`/api/actions/${prop.id}/decision`, { decision: "approve" });
    toast(r.executed ? `Approved & applied ${(r.result || {}).applied || 0} reassignment(s) — audited` : "Action not completed");
    runPtoImpact();
  };
}
let _provCache = null;
async function allProviders() { if (_provCache) return _provCache; const specs = await get("/api/sched/specialties"); const lists = await Promise.all(specs.map((s) => get("/api/sched/doctors", { specialty: s }))); _provCache = lists.flat(); return _provCache; }

/* ---------------- scheduling drawer ---------------- */
const D = { mode: "new", specialty: null, doctor: null, date: TODAY, apptId: null, appt: null, time: null };
function openDrawer(mode) {
  Object.assign(D, { mode, specialty: null, doctor: null, date: TODAY, apptId: null, appt: null, time: null });
  $("#drawerTitle").textContent = { new: "New appointment", modify: "Modify appointment", cancel: "Cancel appointment" }[mode];
  $("#scrim").classList.add("show"); $("#drawer").classList.add("show");
  (mode === "new" ? stepSpecialty() : stepFindAppt());
}
function closeDrawer() { $("#scrim").classList.remove("show"); $("#drawer").classList.remove("show"); }
$("#drawerClose").onclick = closeDrawer; $("#scrim").onclick = closeDrawer;
function crumbs(steps) { $("#crumbs").innerHTML = steps.map((s, i) => `${i ? " › " : ""}${s.on ? `<b>${esc(s.t)}</b>` : esc(s.t)}`).join(""); }

async function stepSpecialty() {
  crumbs([{ t: "Specialty", on: 1 }, { t: "Doctor" }, { t: "Calendar" }, { t: "Confirm" }]);
  const specs = await get("/api/sched/specialties");
  $("#drawerBody").innerHTML = `<div class="side-label">Choose a specialty</div>` + specs.map((s) => `<div class="tile" data-spec="${esc(s)}"><span class="nm">${esc(s)}</span><span class="meta">›</span></div>`).join("");
  $("#drawerBody").querySelectorAll("[data-spec]").forEach((t) => t.onclick = () => { D.specialty = t.dataset.spec; stepDoctor(); });
}
async function stepFindAppt() {
  crumbs([{ t: "Find appointment", on: 1 }, { t: D.mode === "cancel" ? "Confirm" : "Calendar" }]);
  $("#drawerBody").innerHTML = `<div class="field-row"><label>Search by patient, MRN, or provider</label><input class="search" id="apptSearch" placeholder="e.g. Diallo, SYN-4990, Okonkwo"></div><div id="apptResults"></div>`;
  const run = async (qq) => {
    const list = await get("/api/sched/appointments", { query: qq });
    $("#apptResults").innerHTML = list.slice(0, 12).map((a) => `<div class="tile" data-appt="${a.id}"><span class="nm">${esc(a.patient_name)} <span class="mono">${esc(a.mrn)}</span></span><span class="meta">${esc(a.appt_date)} ${esc(a.appt_time)} · ${esc(a.provider_name)}</span></div>`).join("") || `<div class="sub" style="color:var(--ink-3)">No matches.</div>`;
    $("#apptResults").querySelectorAll("[data-appt]").forEach((t) => t.onclick = () => { D.apptId = t.dataset.appt; D.appt = list.find((a) => a.id === D.apptId); D.specialty = D.appt.specialty; (D.mode === "cancel" ? stepConfirmCancel() : stepDoctor()); });
  };
  run(""); $("#apptSearch").oninput = (e) => run(e.target.value);
}
async function stepDoctor() {
  crumbs([{ t: D.specialty || "Specialty" }, { t: "Doctor", on: 1 }, { t: "Calendar" }, { t: "Confirm" }]);
  const docs = await get("/api/sched/doctors", { specialty: D.specialty });
  $("#drawerBody").innerHTML = `<div class="side-label">${esc(D.specialty)} — choose a doctor</div>` + docs.map((d) => `<div class="tile" data-doc="${d.id}"><span><span class="nm">${esc(d.name)}</span> <span class="meta">${esc(d.credential)} · ${esc(d.phone)}</span></span><span class="meta">next: ${(d.next_available || {}).date || "—"} ${(d.next_available || {}).time || ""}</span></div>`).join("");
  $("#drawerBody").querySelectorAll("[data-doc]").forEach((t) => t.onclick = () => { D.doctor = docs.find((d) => d.id === t.dataset.doc); D.date = (D.doctor.next_available || {}).date || TODAY; stepCalendar(); });
}
async function stepCalendar() {
  crumbs([{ t: D.specialty }, { t: D.doctor.name }, { t: "Calendar", on: 1 }, { t: "Confirm" }]);
  const cal = await get("/api/sched/calendar", { provider_id: D.doctor.id, date: D.date });
  const slots = cal.slots || [];
  $("#drawerBody").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><button class="btn" id="prevDay">‹ Prev</button><b>${esc(D.doctor.name)} · ${esc(D.date)}</b><button class="btn" id="nextDay">Next ›</button></div>
    ${cal.blocked ? `<div class="note">On PTO this day — all slots blocked.</div>` : ""}
    <div class="slotgrid">${slots.map((s) => `<div class="slot ${s.status.toLowerCase()}" ${s.status === "Open" ? `data-slot="${s.time}"` : ""} title="${s.appt ? esc(s.appt.patient_name) : s.status}">${esc(s.time)}${s.status === "Booked" ? "<br><span style='font-size:10px'>booked</span>" : ""}</div>`).join("")}</div>
    <div class="legend"><span><i style="background:var(--surface);border:1px solid var(--line)"></i>Open</span><span><i style="background:var(--clay-tint)"></i>Booked</span><span><i style="background:#eae5d9"></i>PTO</span></div>`;
  $("#prevDay").onclick = () => { D.date = shiftDate(D.date, -1); stepCalendar(); };
  $("#nextDay").onclick = () => { D.date = shiftDate(D.date, 1); stepCalendar(); };
  $("#drawerBody").querySelectorAll("[data-slot]").forEach((s) => s.onclick = () => { D.time = s.dataset.slot; stepConfirm(); });
}
const shiftDate = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
async function stepConfirm() {
  crumbs([{ t: D.specialty }, { t: D.doctor.name }, { t: D.date + " " + D.time }, { t: "Confirm", on: 1 }]);
  if (D.mode === "modify") {
    $("#drawerBody").innerHTML = `<div class="note">Move <b>${esc(D.appt.patient_name)}</b>'s appointment<br>from <b>${esc(D.appt.appt_date)} ${esc(D.appt.appt_time)}</b> with ${esc(D.appt.provider_name)}<br>to <b>${esc(D.date)} ${esc(D.time)}</b> with ${esc(D.doctor.name)}.</div><button class="btn primary" id="confirmBtn" style="margin-top:12px">Confirm move</button>`;
    $("#confirmBtn").onclick = async () => { const r = await post(`/api/sched/modify/${D.appt.id}`, { provider_id: D.doctor.id, date: D.date, time: D.time }); finish(r.ok, r.ok ? `Moved ${D.appt.patient_name} → ${D.date} ${D.time}` : r.error); };
    return;
  }
  const patients = await get("/api/sched/patients");
  $("#drawerBody").innerHTML = `<div class="note">${esc(D.doctor.name)} (${esc(D.specialty)}) · <b>${esc(D.date)} ${esc(D.time)}</b></div>
    <div class="field-row" style="margin-top:12px"><label>Patient</label><select id="pat">${patients.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.mrn)} (${p.risk_tier})</option>`).join("")}</select></div>
    <div class="field-row"><label>Type</label><select id="type"><option>Follow-up</option><option>New</option><option>Consult</option></select></div>
    <div class="field-row"><label>Reason</label><input id="reason" placeholder="Reason for visit"></div><button class="btn primary" id="confirmBtn">Book appointment</button>`;
  $("#confirmBtn").onclick = async () => { const r = await post("/api/sched/book", { patient_id: $("#pat").value, provider_id: D.doctor.id, date: D.date, time: D.time, type: $("#type").value, reason: $("#reason").value }); finish(r.ok, r.ok ? `Booked ${r.patient} with ${r.provider} · ${D.date} ${D.time}` : r.error); };
}
async function stepConfirmCancel() {
  crumbs([{ t: "Appointment" }, { t: "Confirm cancellation", on: 1 }]);
  $("#drawerBody").innerHTML = `<div class="note">Cancel <b>${esc(D.appt.patient_name)}</b>'s ${esc(D.appt.appt_time)} on ${esc(D.appt.appt_date)} with ${esc(D.appt.provider_name)}?</div><div class="field-row" style="margin-top:12px"><label>Reason</label><input id="reason" placeholder="Cancellation reason"></div><button class="btn primary" id="confirmBtn">Cancel appointment</button><div id="reoffer"></div>`;
  $("#confirmBtn").onclick = async () => {
    const r = await post(`/api/sched/cancel/${D.appt.id}`, { reason: $("#reason").value || "scheduler" });
    if (!r.ok) return finish(false, r.error);
    toast("Appointment cancelled — slot freed");
    $("#reoffer").innerHTML = `<div class="side-label" style="margin-top:14px">Re-offer freed slot (${esc(r.freed.time)}) to a higher-risk patient</div>` + (r.reoffer_candidates || []).map((c) => `<div class="tile" data-cand="${c.id}"><span><span class="nm">${esc(c.name)}</span> <span class="mono">${esc(c.mrn)}</span></span><span class="badge ${bClass(c.risk_tier)}">${c.risk_tier}</span></div>`).join("");
    $("#reoffer").querySelectorAll("[data-cand]").forEach((t) => t.onclick = async () => { const b = await post("/api/sched/book", { patient_id: t.dataset.cand, provider_id: r.freed.provider_id, date: r.freed.date, time: r.freed.time, type: "Follow-up", reason: "re-offered slot" }); finish(b.ok, b.ok ? `Re-offered ${r.freed.time} to ${b.patient}` : b.error); });
  };
}
function finish(ok, msg) { toast(msg || (ok ? "Done" : "Action failed")); if (ok) { closeDrawer(); _provCache = null; render($(".tab.active").dataset.tab); } }

/* ---------------- markdown (tables etc.) for chat ---------------- */
function mdToHtml(md) {
  const lines = esc(md).split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|/.test(line) && /^\s*\|[ :|-]+\|/.test(lines[i + 1] || "")) {
      const head = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) { rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      html += `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      html += `<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`; continue;
    }
    if (line.trim()) html += `<div>${inline(line)}</div>`;
    i++;
  }
  return html;
}
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");

/* ---------------- UC6 approvals + audit ---------------- */
async function renderApprovals(host) {
  const [pending, audit] = await Promise.all([get("/api/actions/pending"), get("/api/actions/audit")]);
  const pend = pending.map((p) => `<tr><td><b>${esc(p.summary)}</b><div class="sub">${esc(p.action)}${p.rationale ? " · " + esc(p.rationale) : ""}</div></td>
    <td class="btn-row"><button class="btn primary" data-ok="${p.id}">Approve</button><button class="btn" data-no="${p.id}">Reject</button></td></tr>`).join("")
    || `<tr><td colspan="2" style="color:var(--ink-3)">No pending recommendations. AI proposals appear here for human approval — nothing executes without it.</td></tr>`;
  const log = audit.map((a) => `<tr><td class="mono">${esc((a.ts || "").replace("T", " ").slice(0, 16))}</td><td>${esc(a.summary)}</td><td>${esc(a.actor_user)} <span class="sub">(${esc(a.actor_role)})</span></td><td><span class="badge ${a.decision === "approved" ? "g" : a.decision === "rejected" ? "r" : "a"}">${esc(a.decision)}</span></td><td>${esc(a.outcome || "")}</td></tr>`).join("")
    || `<tr><td colspan="5" style="color:var(--ink-3)">No decisions recorded yet.</td></tr>`;
  host.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>Pending approvals</h3><div class="sub">Human-in-the-loop gate — every AI action needs a decision (BR-1)</div></div></div>
    <div class="card-b" style="padding:0"><table><tbody>${pend}</tbody></table></div></div>
    <div class="card"><div class="card-h"><div><h3>Audit trail</h3><div class="sub">Every decision, attributable to a user + timestamp (BR-10)</div></div></div>
    <div class="card-b" style="padding:0"><table><thead><tr><th>When (UTC)</th><th>Action</th><th>Decided by</th><th>Decision</th><th>Outcome</th></tr></thead><tbody>${log}</tbody></table></div></div>`;
  host.querySelectorAll("[data-ok]").forEach((b) => b.onclick = async () => { const r = await post(`/api/actions/${b.dataset.ok}/decision`, { decision: "approve" }); toast(r.blocked ? "Blocked — uncovered window (needs override)" : "Approved — audited"); renderApprovals(host); });
  host.querySelectorAll("[data-no]").forEach((b) => b.onclick = async () => { await post(`/api/actions/${b.dataset.no}/decision`, { decision: "reject" }); toast("Rejected — audited"); renderApprovals(host); });
}

/* ---------------- Leadership reporting — 3-Month Bird's-Eye dashboard ---------------- */
const _pct = (v) => `${Math.round(v * 100)}%`;
const _ragClass = (s) => ({ "ON TARGET": "ontarget", "WATCH": "watch", "ACTION": "action", "INFO": "info" }[s] || "info");
const _fmtKpi = (v, fmt) => fmt === "pct" ? _pct(v) : fmt === "days" ? `${v}d` : `${v}`;
const _arrow = (t) => t === "down" ? "▼" : t === "up" ? "▲" : "▬";

function _kpiCard(k) {
  const bars = [k.m1, k.m2, k.m3];
  const max = Math.max(...bars, k.target || 0) || 1;
  const spark = bars.map((b) => `<i style="height:${Math.max(10, Math.round((b / max) * 22))}px"></i>`).join("");
  const tgt = k.target == null ? "—" : _fmtKpi(k.target, k.fmt);
  return `<div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:6px">
    <div class="sub" style="font-weight:700">${esc(k.kpi)}</div>
    <div style="display:flex;align-items:baseline;gap:8px">
      <div style="font-family:Fraunces,serif;font-size:30px;font-weight:700">${_fmtKpi(k.quarter, k.fmt)}</div>
      <span class="trend ${k.trend}">${_arrow(k.trend)}</span></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="spark">${spark}</span><span class="rag ${_ragClass(k.status)}">${esc(k.status)}</span></div>
    <div class="sub" style="color:var(--ink-3)">Target ${tgt} · Q avg of Jul–Sep</div></div></div>`;
}

function _scorecardRow(k) {
  return `<tr><td><b>${esc(k.kpi)}</b></td>
    <td class="sub">${k.target == null ? "—" : _fmtKpi(k.target, k.fmt)}</td>
    <td>${_fmtKpi(k.m1, k.fmt)}</td><td>${_fmtKpi(k.m2, k.fmt)}</td><td>${_fmtKpi(k.m3, k.fmt)}</td>
    <td><b>${_fmtKpi(k.quarter, k.fmt)}</b></td>
    <td class="trend ${k.trend}">${_arrow(k.trend)}</td>
    <td><span class="rag ${_ragClass(k.status)}">${esc(k.status)}</span></td></tr>`;
}

function _capRow(r) {
  const u = r.utilization, cls = u >= 0.92 ? "over" : u <= 0.80 ? "under" : "";
  return `<tr><td><b>${esc(r.weekday)}</b></td><td>${r.providers}</td><td>${r.demand_min}</td><td>${r.supply_min}</td>
    <td style="min-width:140px"><div style="display:flex;align-items:center;gap:8px">
      <span class="tbar ${cls}"><i style="width:${Math.min(100, Math.round(u * 100))}%"></i></span>
      <span class="pct ${u >= 0.92 ? "r" : u <= 0.80 ? "a" : "g"}">${_pct(u)}</span></div></td></tr>`;
}

function _heat(v, floor) {
  const cls = v < floor ? "lo" : v === floor ? "fl" : v >= floor + 2 ? "hi" : "ok";
  return `<div class="heat ${cls}">${v}</div>`;
}

async function renderReporting(host) {
  host.innerHTML = `<div class="banner">Consolidated department view for the Chair / CCO — synthetic, demonstration only.</div><div class="sub" style="margin:14px 2px">Loading 3-month bird's-eye…</div>`;
  let b;
  try { b = await get("/api/data/birdseye"); } catch (e) { host.innerHTML += `<div class="card"><div class="card-b">Could not load reporting data.</div></div>`; return; }

  const kpiCards = b.kpis.slice(0, 4).map(_kpiCard).join("");
  const scorecard = b.kpis.map(_scorecardRow).join("");
  const cap = b.capacity.rows.map(_capRow).join("") +
    `<tr style="border-top:2px solid var(--line-2)"><td><b>Weekly</b></td><td><b>${b.capacity.weekly.providers}</b></td>
     <td><b>${b.capacity.weekly.demand_min}</b></td><td><b>${b.capacity.weekly.supply_min}</b></td>
     <td><b>${_pct(b.capacity.weekly.utilization)}</b></td></tr>`;
  const heatHead = `<div class="hh">Week of</div>` + ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => `<div class="hh">${d}</div>`).join("") + `<div class="hh">Total</div><div class="hh">Util</div>`;
  const heatRows = b.grid13.map((g) => `<div class="sub" style="align-self:center">${esc(g.week_of.slice(5))}</div>` +
    [g.Mon, g.Tue, g.Wed, g.Thu, g.Fri].map((v) => _heat(v, b.floor)).join("") +
    `<div class="heat ${g.below_floor ? "lo" : "ok"}">${g.total}${g.below_floor ? " ⚠" : ""}</div><div class="sub" style="align-self:center;text-align:center">${_pct(g.util)}</div>`).join("");
  const cancel = b.cancellations.map((c) => `<tr><td><b>${esc(c.slot)}</b></td><td>${c.booked}</td>
    <td>${_pct(c.advance_pct)}</td><td class="pct ${c.noshow_pct >= 0.06 ? "r" : "g"}">${_pct(c.noshow_pct)}</td>
    <td><span class="badge ${c.signal === "Double-block" ? "b-red" : c.signal === "Tighten waitlist" ? "b-amber" : "b-green"}">${esc(c.signal)}</span></td></tr>`).join("");
  const walk = b.walkins.map((w) => `<tr><td><b>${esc(w.weekday)}</b></td><td>${w.am}</td><td>${w.pm}</td><td>${w.total}</td>
    <td>${_pct(w.pm_share)}</td><td><span class="badge ${w.idle === "HIGH" ? "b-amber" : "b-green"}">${esc(w.idle)}</span></td>
    <td class="sub">${esc(w.signal)}</td></tr>`).join("");
  const floors = b.pto.floors.map((f) => `<tr><td>${esc(f.service)}</td><td><b>${f.floor}</b>/day</td></tr>`).join("");
  const reqs = b.pto.requests.length ? b.pto.requests.map((r) => `<tr><td><b>${esc(r.week_of)}</b></td><td>${esc(r.service)}</td>
    <td>${r.on_floor}→${r.if_approved}</td><td><span class="badge ${r.result === "BREACH" ? "b-red" : "b-green"}">${esc(r.result)}</span></td>
    <td class="sub">${esc(r.action)}</td></tr>`).join("") : `<tr><td colspan="5" class="sub">No breaching requests in the horizon.</td></tr>`;
  const cyc = b.cycle.stages.map((s) => `<tr><td>${esc(s.stage)}</td><td><b>${s.this_q}d</b></td><td class="sub">${s.last_q}d</td>
    <td class="${s.change > 0 ? "pct r" : s.change < 0 ? "pct g" : "sub"}">${s.change > 0 ? "+" : ""}${s.change}d</td>
    <td style="min-width:120px"><div style="display:flex;align-items:center;gap:8px"><span class="tbar ${s.flag === "Worsening" ? "over" : ""}"><i style="width:${Math.round(s.pct * 100)}%"></i></span><span class="sub">${_pct(s.pct)}</span></div></td>
    <td><span class="badge ${s.flag === "Worsening" ? "b-red" : s.flag === "Improving" ? "b-green" : "b-amber"}">${esc(s.flag)}</span></td></tr>`).join("");
  const visit = b.visit_types.map((v) => `<tr><td>${esc(v.type)}</td><td>${v.duration}</td><td>${v.buffer}</td><td><b>${v.total}</b></td><td class="sub">${esc(v.notes)}</td></tr>`).join("");
  const roster = b.roster.map((r) => `<tr><td><b>${esc(r.provider)}</b></td><td>${esc(r.panel)}</td><td>${esc(r.type)}</td><td>${esc(r.high_risk)}</td><td>${r.sessions}</td><td>${r.weekly_cap_min}</td></tr>`).join("");

  const card = (title, meta, sub, body, pad0 = true) => `<div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>${title}${meta ? ` <span class="meta">· ${meta}</span>` : ""}</h3>${sub ? `<div class="sub">${sub}</div>` : ""}</div></div><div class="card-b"${pad0 ? ` style="padding:0"` : ""}>${body}</div></div>`;

  host.innerHTML = `<div class="banner">Consolidated department view for the Chair / CCO — synthetic, demonstration only.</div>
    <div class="be-head"><div><h3 style="margin:0">Department Dashboard — 3-Month Bird's-Eye</h3>
      <div class="sub">RAG vs targets · the same live analytics behind Planning, rolled up for leadership</div></div>
      <span class="per">${esc(b.period)}</span></div>
    <div class="kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px">${kpiCards}</div>
    ${card("KPI scorecard", "RAG vs target", "Month-by-month with quarter average, trend, and red/amber/green status",
      `<table><thead><tr><th>KPI</th><th>Target</th><th>Jul</th><th>Aug</th><th>Sep</th><th>Quarter</th><th>Trend</th><th>Status</th></tr></thead><tbody>${scorecard}</tbody></table>`)}
    <div class="be-grid2">
      ${card("Capacity model — minute-weighted", "ASK4", `Headcount ≠ capacity · demand from ${b.capacity.demand_source === "model" ? "the KServe forecast model" : "history"}`,
        `<table><thead><tr><th>Weekday</th><th>Prov</th><th>Demand</th><th>Supply</th><th>Utilization</th></tr></thead><tbody>${cap}</tbody></table>`)}
      ${card("Cycle time by stage", "ASK3", `Total ${b.cycle.total_this_q}d (was ${b.cycle.total_last_q}d) — bottleneck: ${esc(b.cycle.bottleneck_label)}`,
        `<table><thead><tr><th>Stage (owner)</th><th>This Q</th><th>Last Q</th><th>Δ</th><th>% of total</th><th>Flag</th></tr></thead><tbody>${cyc}</tbody></table>`)}
    </div>
    ${card("13-week staffing grid", `floor ${b.floor}/day`, "Providers scheduled per weekday · amber = at floor, red = below",
      `<div class="heatgrid">${heatHead}${heatRows}</div>`, false)}
    <div class="be-grid2">
      ${card("Cancellations & no-shows", "ASK1", "Advance (refilled) vs no-show (wasted) → double-block signal",
        `<table><thead><tr><th>Slot</th><th>Booked</th><th>Advance</th><th>No-show</th><th>Signal</th></tr></thead><tbody>${cancel}</tbody></table>`)}
      ${card("Walk-in volume", "ASK1", "AM/PM split → full-day vs half-day template",
        `<table><thead><tr><th>Weekday</th><th>AM</th><th>PM</th><th>Total</th><th>PM share</th><th>Idle</th><th>Signal</th></tr></thead><tbody>${walk}</tbody></table>`)}
    </div>
    <div class="be-grid2">
      ${card("PTO & 90-day coverage", "ASK2", `Per-service floors · ${b.pto.gap_count} breach-day(s) in ${b.pto.horizon_days}d`,
        `<table><thead><tr><th>Service</th><th>Floor</th></tr></thead><tbody>${floors}</tbody></table>
         <table style="margin-top:8px"><thead><tr><th>Week</th><th>Service</th><th>On→If appr.</th><th>Result</th><th>Action</th></tr></thead><tbody>${reqs}</tbody></table>`)}
      ${card("Visit-type reference", "capacity inputs", "Durations drive the capacity math",
        `<table><thead><tr><th>Type</th><th>Dur</th><th>Buf</th><th>Total</th><th>Notes</th></tr></thead><tbody>${visit}</tbody></table>`)}
    </div>
    ${card("Provider roster", "credentials & FTE", "Who can cover which service",
      `<table><thead><tr><th>Provider</th><th>Panel</th><th>Type</th><th>High-risk</th><th>Sessions/wk</th><th>Wkly cap (min)</th></tr></thead><tbody>${roster}</tbody></table>`)}
    <div class="card"><div class="card-b">Every figure is grounded in the same live analytics shown in Planning, rolled up for the Chair/CCO. Ask the Assistant to <b>"make the case for the chair"</b> for an approval-ready brief. Human-approved &amp; audited; no PHI.</div></div>`;
}

/* ---------------- Planning: coverage (UC2) · capacity (ASK4) · cancellations+template (ASK1) ---------------- */
async function renderPlanning(host) {
  const [cov, lb, tpl, cb, wk] = await Promise.all([
    get("/api/data/coverage"), get("/api/data/load-balance"), get("/api/data/template"),
    get("/api/data/cancellations"), get("/api/data/walkins")]);
  const flag = (f) => `<span class="badge ${f === "over-loaded" ? "r" : f === "under-utilised" ? "a" : "g"}">${esc(f)}</span>`;
  const gaps = (cov.gaps || []).slice(0, 8).map((g) =>
    `<tr><td><b>${esc(g.date)}</b></td><td>${esc(g.service_line)}</td><td>${g.available}/${g.required}</td><td>${esc((g.providers_out || []).join(", "))}</td></tr>`).join("")
    || `<tr><td colspan="4" style="color:var(--ink-3)">No coverage gaps in the horizon.</td></tr>`;
  const load = (lb.by_day || []).map((d) =>
    `<tr><td><b>${esc(d.day)}</b></td><td>${d.providers_per_day}</td><td>${d.avg_visit_min} min</td><td class="pct ${d.utilization_pct >= 92 ? "r" : d.utilization_pct <= 80 ? "a" : "g"}">${d.utilization_pct}%</td><td>${flag(d.flag)}</td></tr>`).join("");
  const cancel = (cb.by_slot || []).slice().sort((a, b) => b.cancel_pct - a.cancel_pct).slice(0, 6).map((s) =>
    `<tr><td><b>${esc(s.day)} ${esc(s.shift)}</b></td><td>${s.cancel_pct}%</td><td>${s.advance_pct}%</td><td class="pct ${s.noshow_pct >= 9 ? "r" : "g"}">${s.noshow_pct}%</td></tr>`).join("");
  const tplrows = (tpl.recommendations || []).filter((r) => /Double-block|Do NOT/.test(r.booking)).slice(0, 8).map((r) =>
    `<tr><td><b>${esc(r.day)} ${esc(r.shift)}</b></td><td>${r.no_show_rate}%</td><td>${r.advance_rate}%</td><td>${esc(r.booking)}</td></tr>`).join("");
  host.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>90-day coverage plan <span class="meta">· UC2 / ASK2</span></h3>
      <div class="sub">${cov.gap_count} day(s) below a service-line minimum over ${cov.horizon_days} days — coverage is a skill-mix, not a headcount, question</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Date</th><th>Service line</th><th>On / min</th><th>Providers out</th></tr></thead><tbody>${gaps}</tbody></table></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-h" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3>Provider capacity — minute-weighted <span class="meta">· ASK4</span></h3>
      <div class="sub">Headcount isn't capacity — weighted by visit-type mix. ${esc(lb.rebalance || "Load is balanced.")}</div></div>
      ${(lb.rebalance && (ROLE === "Scheduler" || ROLE === "Approver")) ? `<button class="btn primary" id="draftRebalance" style="white-space:nowrap">Draft proposal →</button>` : ""}</div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Day</th><th>Providers</th><th>Avg visit</th><th>Utilization</th><th>Status</th></tr></thead><tbody>${load}</tbody></table></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>Cancellations — advance vs true no-show <span class="meta">· ASK1</span></h3>
      <div class="sub">Clinic avg ${cb.clinic_avg_cancel_pct}%. Double-block only where TRUE no-shows are high; tighten the waitlist where cancels are advance.</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Day / shift</th><th>Cancel %</th><th>Advance</th><th>True no-show</th></tr></thead><tbody>${cancel}</tbody></table></div></div>
    <div class="card"><div class="card-h"><div><h3>Template recommendation <span class="meta">· UC3 / ASK1</span></h3>
      <div class="sub">Walk-ins: Fri ${((wk.by_day || []).find((d) => d.day === "Friday") || {}).avg_total || "—"}/day (AM-heavy). ${esc((wk.friday_scenario || {}).recommendation || "")}</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Day / shift</th><th>True no-show</th><th>Advance</th><th>Recommendation</th></tr></thead><tbody>${tplrows}</tbody></table></div></div>`;

  // One-click: stage the minute-weighted rebalance into the approver queue (UC6 HITL).
  const btn = host.querySelector("#draftRebalance");
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Drafting…";
    const over = (lb.by_day || []).find((d) => d.flag === "over-loaded");
    const summary = `Rebalance provider coverage — ${lb.rebalance}`;
    const rationale = over
      ? `Minute-weighted load: ${over.day} at ${over.utilization_pct}% vs dept avg ${lb.avg_utilization_pct}% (demand from the forecast model). Cost-neutral — no added headcount.`
      : lb.rebalance;
    try {
      const prop = await post("/api/actions/propose", {
        action: "schedule_change", summary, rationale, payload: { rebalance: lb.rebalance, source: "planning" } });
      toast(`Proposal ${prop.id} sent to the approver queue`);
      switchTab("approvals");
    } catch (e) {
      toast("Could not draft proposal"); btn.disabled = false; btn.textContent = "Draft proposal →";
    }
  };
}

/* proactive, system-initiated insights strip (ASK1 Flow1 / ASK2 Flow1a) */
async function insightsStrip() {
  let items = [];
  try { items = await get("/api/data/insights"); } catch { return ""; }
  if (!items.length) return "";
  return `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent,#cc785c)">
    <div class="card-h"><div><h3>Proactive insights</h3><div class="sub">Patterns the assistant noticed — click to dig in</div></div></div>
    <div class="card-b">${items.map((i) => `<div style="padding:8px 0;border-bottom:1px solid var(--line,#eee)">
      <b>${esc(i.title)}</b> <span class="badge ${i.severity === "warning" ? "a" : "g"}">${esc(i.kind)}</span>
      <div class="sub">${esc(i.detail)}</div>
      <button class="chip" data-ask="${esc(i.ask)}" style="margin-top:6px">Ask: ${esc(i.ask)}</button></div>`).join("")}</div></div>`;
}

/* ---------------- copilot ---------------- */
// Conversation transcript persists across tab/role switches (no refresh on return).
let CHAT = [];
const CHAT_WELCOME = `<div class="msg bot"><div class="ic">${ICONS.chat}</div><div class="bubble">Hi — I can answer questions about no-show risk, coverage, PTO impact, template patterns, and provider load, and book / cancel appointments — all from chat. Try a suggestion, or ask <b>"which slots are at risk this week?"</b> <span style="color:var(--ink-3);font-size:12px">All data is synthetic.</span></div></div>`;

function renderCopilot(host) {
  host.innerHTML = `<div class="chatwrap">
    <div class="chat"><div class="chat-h"><div class="bot">${ICONS.chat}</div><div class="nm">OBGYN Scheduling Assistant<small>OBGYN · Claude via Portkey (rules fallback) · synthetic</small></div><button class="btn" id="chatClear" style="margin-left:auto;padding:5px 11px;font-size:12px">Clear</button></div>
      <div class="chat-log" id="chatLog"></div>
      <div class="chat-in"><input id="chatInput" placeholder="Ask the OBGYN Scheduling Assistant…"><button class="btn primary" id="chatSend">Send</button></div></div>
    <div class="chips"><div class="side-label">Suggested</div>
      <button class="chip" data-q="Which slots are at risk this week?">Which slots are at risk?</button>
      <button class="chip" data-q="How can I cover the service for the next 90 days?">Cover the service 90 days out</button>
      <button class="chip" data-q="Should we double-block Tuesday afternoons?">Double-block Tuesday PM?</button>
      <button class="chip" data-q="Put Dr. Brooks on PTO 7/14 to 7/18 and show the impact">Dr. Brooks PTO impact</button>
      <button class="chip" data-q="Are providers evenly distributed across the week?">Provider load balance</button>
      <div class="modelnote">The assistant routes to the same scheduling actions the UI uses (one source of truth) and remembers the conversation — switch tabs and come back, your thread stays.</div></div></div>`;
  const log = $("#chatLog");
  const renderAll = () => {
    log.innerHTML = CHAT.length
      ? CHAT.map((m) => `<div class="msg ${m.who === "me" ? "me" : "bot"}"><div class="ic">${m.who === "me" ? "🧑" : ICONS.chat}</div><div class="bubble">${m.html}</div></div>`).join("")
      : CHAT_WELCOME;
    log.scrollTop = log.scrollHeight;
  };
  renderAll();
  $("#chatClear").onclick = () => { CHAT = []; resetChat(); renderAll(); };
  const send = async (q) => {
    if (!q.trim()) return;
    CHAT.push({ who: "me", html: esc(q) });
    const bot = { who: "bot", html: "<span style='color:var(--ink-3)'>thinking…</span>" };
    CHAT.push(bot); renderAll();
    const bubble = log.lastElementChild.querySelector(".bubble");
    let acc = "";
    try {
      for await (const chunk of streamChat(q, ROLE)) { acc += chunk; bot.html = mdToHtml(acc); bubble.innerHTML = bot.html; log.scrollTop = log.scrollHeight; }
      if (!acc) { bot.html = "<span style='color:var(--alert)'>No response — the LLM may still be warming up.</span>"; bubble.innerHTML = bot.html; }
    } catch (e) { bot.html = `<span style='color:var(--alert)'>Assistant error: ${esc(e.message)}</span>`; bubble.innerHTML = bot.html; }
    _provCache = null;
  };
  $("#chatSend").onclick = () => { const i = $("#chatInput"); send(i.value); i.value = ""; };
  $("#chatInput").onkeydown = (e) => { if (e.key === "Enter") { send(e.target.value); e.target.value = ""; } };
  host.querySelectorAll(".chip").forEach((c) => c.onclick = () => send(c.dataset.q));
  // A proactive-insight "Ask" click (from the dashboard) lands here.
  if (typeof window !== "undefined" && window.__pendingAsk) {
    const q = window.__pendingAsk; window.__pendingAsk = null; send(q);
  }
}

/* ---------------- boot ---------------- */
$("#viewIcon").innerHTML = ICONS.dashboard;
document.querySelectorAll(".role-opt").forEach((r) => r.addEventListener("click", () => applyRole(r.dataset.role)));
applyRole("Scheduler");
