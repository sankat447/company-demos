import { get, post, streamChat } from "./api.js";

const TODAY = "2026-06-09";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bClass = (t) => (t === "RED" ? "b-red" : t === "AMBER" ? "b-amber" : "b-green");
const pClass = (t) => (t === "RED" ? "r" : t === "AMBER" ? "a" : "g");
let ROLE = "Scheduler";

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------------- tabs + role ---------------- */
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("show"));
    t.classList.add("active");
    $("#" + t.dataset.tab).classList.add("show");
    render(t.dataset.tab);
  }));

const ROLE_SUB = { Scheduler: "coverage, no-show risk, and smart fills",
  "HR/Ops": "overtime, PTO approvals, and compliance", Provider: "my schedule and time-off requests" };
document.querySelectorAll(".role-opt").forEach((r) =>
  r.addEventListener("click", () => {
    document.querySelectorAll(".role-opt").forEach((x) => x.classList.remove("active"));
    r.classList.add("active");
    ROLE = r.dataset.role;
    $("#viewRole").textContent = ROLE + " view";
    $("#viewSub").textContent = ROLE_SUB[ROLE];
    render($(".tab.active").dataset.tab);
  }));

/* ---------------- render dispatch ---------------- */
async function render(tab) {
  const host = $("#" + tab);
  try {
    if (tab === "dashboard") return renderDashboard(host);
    if (tab === "schedule") return renderSchedule(host);
    if (tab === "risk") return renderRisk(host);
    if (tab === "pto") return renderPto(host);
    if (tab === "copilot") return renderCopilot(host);
  } catch (e) {
    host.innerHTML = `<div class="card"><div class="card-b">Backend unreachable: ${esc(e.message)}<br><span class="mono">Is the copilot backend up?</span></div></div>`;
  }
}

/* ---------------- dashboard ---------------- */
async function renderDashboard(host) {
  const k = await get("/api/data/kpis");
  const mix = k.risk_mix || { RED: 0, AMBER: 0, GREEN: 0 };
  const tile = (lab, val, sub) => `<div class="kpi"><span class="rail"></span><div class="lab">${lab}</div><div class="val">${val}</div><div class="delta">${sub}</div></div>`;
  host.innerHTML = `
    <div class="kpis">
      ${tile("Coverage today", `${k.coverage_pct}<small>%</small>`, "vs plan")}
      ${tile("Open shifts · 7d", k.open_shifts_7d, "smart-fill ready")}
      ${tile("Predicted no-shows", `${k.predicted_no_shows} <small>/ ${k.appts_today}</small>`, "model: KServe")}
      ${tile("Overtime · week", `${k.overtime_h}<small>h</small>`, `target ${k.overtime_target}h`)}
      ${tile("Bed occupancy", `${k.bed_occupancy_pct}<small>%</small>`, `${k.beds_used} / ${k.beds_total} beds`)}
      ${tile("Predicted admits · 4h", k.predicted_admits_4h, "2 from ED")}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-h"><div><h3>No-show risk mix</h3><div class="sub">Today · ${k.appts_today} scheduled appts</div></div></div>
        <div class="card-b"><div class="legend" style="gap:18px">
          <span><i style="background:var(--ok)"></i><b>${mix.GREEN}</b> Low</span>
          <span><i style="background:var(--watch)"></i><b>${mix.AMBER}</b> Watch</span>
          <span><i style="background:var(--alert)"></i><b>${mix.RED}</b> High</span></div>
          <div class="bar" style="margin-top:14px;display:flex">
            <span style="background:var(--ok);width:${pctBar(mix.GREEN, mix)}%"></span>
            <span style="background:var(--watch);width:${pctBar(mix.AMBER, mix)}%"></span>
            <span style="background:var(--alert);width:${pctBar(mix.RED, mix)}%"></span></div>
        </div></div>
      <div class="card"><div class="card-h"><div><h3>Smart-fill alerts</h3><div class="sub">Ranked by lowest OT + license match</div></div><span class="chip-flag">${k.pending_pto} PTO pending</span></div>
        <div class="card-b">
          <div class="impact-row"><b>Coverage protected.</b><div class="sub">Use the Schedule tab to book/modify, or ask the Copilot to fill a gap.</div></div>
          <div class="impact-row"><b>${mix.RED} high-risk appts today.</b><div class="sub">Send reminders to RED patients to cut no-shows. <a href="#" data-go="copilot">Open Copilot →</a></div></div>
        </div></div>
    </div>`;
  host.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.querySelector(`.tab[data-tab="${a.dataset.go}"]`).click(); }));
}
const pctBar = (v, mix) => { const t = (mix.RED + mix.AMBER + mix.GREEN) || 1; return Math.round((v / t) * 100); };

/* ---------------- schedule (roster + appts + actions) ---------------- */
async function renderSchedule(host) {
  const [roster, appts] = await Promise.all([get("/api/data/roster"), get("/api/sched/appointments", { date: TODAY })]);
  host.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h">
      <div><h3>Appointments · ${TODAY}</h3><div class="sub">${appts.length} booked · Med-Surg 4W clinic</div></div>
      <div class="btn-row">
        <button class="btn primary" id="newAppt">New appointment</button>
        <button class="btn" id="modAppt">Modify</button>
        <button class="btn" id="canAppt">Cancel</button></div></div>
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
  let filter = "ALL", q = "";
  const draw = () => {
    const rows = all.filter((r) => (filter === "ALL" || r.tier === filter) &&
      (r.patient_name + r.mrn + r.provider + r.appt_time).toLowerCase().includes(q));
    $("#riskBody").innerHTML = rows.map((r) => {
      const f = Array.isArray(r.factors) ? r.factors : JSON.parse(r.factors || "[]");
      return `<tr><td><span class="badge ${bClass(r.tier)}">${r.tier}</span></td><td><b>${esc(r.patient_name)}</b></td>
        <td class="mono">${esc(r.mrn)}</td><td class="mono">${esc(r.phone)}</td><td><b>${esc(r.appt_time)}</b></td>
        <td>${esc(r.provider)}</td><td class="pct ${pClass(r.tier)}">${r.risk_pct}%</td>
        <td><div class="factors">${f.map((x) => `<span class="factor">${esc(x)}</span>`).join("")}</div></td>
        <td><button class="btn ${r.tier === "RED" ? "primary" : ""}">${esc(r.action)}</button></td></tr>`;
    }).join("");
  };
  host.innerHTML = `
    <div class="toolbar"><div class="seg" id="riskSeg"><button class="on">All</button><button>Red</button><button>Amber</button><button>Green</button></div>
      <input class="search" id="riskSearch" placeholder="Search patient, MRN, provider…"><button class="btn primary">Text all RED</button></div>
    <div class="card"><div class="card-h"><div><h3>No-Show Risk · today</h3><div class="sub">Risk from the <b>No-Show KServe</b> model (rules fallback if down)</div></div></div>
      <div class="card-b" style="padding:0"><table><thead><tr><th>Risk</th><th>Patient</th><th>MRN</th><th>Phone</th><th>Appt</th><th>Provider</th><th>Risk %</th><th>Top factors</th><th>Action</th></tr></thead><tbody id="riskBody"></tbody></table></div></div>`;
  draw();
  host.querySelectorAll("#riskSeg button").forEach((b) => b.onclick = () => { host.querySelectorAll("#riskSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); filter = b.textContent.toUpperCase(); draw(); });
  $("#riskSearch").oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
}

/* ---------------- PTO (queue + balances + put-on-PTO impact tool) ---------------- */
async function renderPto(host) {
  const [queue, bal, provs] = await Promise.all([get("/api/data/pto-queue"), get("/api/data/balances"), allProviders()]);
  const isProvider = ROLE === "Provider";
  host.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-h"><div>
      <h3>${isProvider ? "Request time off" : "Put a provider on PTO"}</h3>
      <div class="sub">${isProvider ? "See the coverage impact before you submit" : "See impacted appointments and reassignment options"}</div></div></div>
      <div class="card-b">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
          <div class="field-row" style="margin:0"><label>Provider</label><select id="ptoProv">${provs.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.specialty)}</option>`).join("")}</select></div>
          <div class="field-row" style="margin:0"><label>Start</label><input id="ptoStart" type="date" value="2026-06-16"></div>
          <div class="field-row" style="margin:0"><label>End</label><input id="ptoEnd" type="date" value="2026-06-20"></div>
          <button class="btn primary" id="ptoRun">${isProvider ? "Preview impact" : "Compute impact"}</button>
        </div>
        <div id="ptoImpact" style="margin-top:14px"></div>
      </div></div>
    <div class="grid-2b">
      <div class="card"><div class="card-h"><div><h3>Time-off requests</h3><div class="sub">Coverage impact flagged automatically</div></div></div>
        <div class="card-b" style="padding:0"><table><thead><tr><th>Provider</th><th>Type</th><th>Dates</th><th>Coverage</th><th>Status</th></tr></thead>
        <tbody>${queue.map((p) => `<tr><td><b>${esc(p.provider_name)}</b></td><td>${esc(p.type)}</td><td class="mono">${esc(p.dates)}</td>
          <td>${p.coverage_gap ? '<span class="gap-tag">Coverage gap</span>' : '<span style="color:var(--ok);font-weight:700">Covered</span>'}</td>
          <td>${p.status === "ok" ? '<span class="pill ok">Approved</span>' : p.status === "pend" ? '<span class="pill pend">Pending</span>' : '<span class="pill no">Denied</span>'}</td></tr>`).join("")}</tbody></table></div></div>
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
  box.innerHTML = `
    <div class="note"><b>${esc(imp.provider)}</b> · ${start} → ${end}: <b>${imp.impacted_count}</b> appointments impacted ·
      <b>${imp.auto_resolvable_count}</b> auto-resolvable · <b>${imp.needs_manual_count}</b> need attention.</div>
    ${imp.impacted.map((a) => {
      const opt = a.reassign_options[0] ? `Reassign → <b>${esc(a.reassign_options[0].provider)}</b> (same time)`
        : a.reschedule_options[0] ? `Reschedule → <b>${esc(a.reschedule_options[0].provider)}</b> ${a.reschedule_options[0].date} ${a.reschedule_options[0].time}`
        : `<span style="color:var(--alert)">Manual — no same-specialty availability</span>`;
      return `<div class="impact-row" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div><b>${esc(a.patient_name)}</b> · ${esc(a.appt_date)} ${esc(a.appt_time)} <span class="mono">${esc(a.mrn)}</span><div class="sub">${opt}</div></div>
        <span class="badge ${a.recommendation === "reassign" ? "b-green" : a.recommendation === "reschedule" ? "b-amber" : "b-red"}">${a.recommendation}</span></div>`;
    }).join("")}
    ${imp.auto_resolvable_count ? `<button class="btn primary" id="applyAuto" style="margin-top:10px">Apply all auto (${imp.auto_resolvable_count})</button>` : ""}`;
  const btn = $("#applyAuto");
  if (btn) btn.onclick = async () => {
    const plan = imp.impacted.filter((a) => a.recommendation === "reassign").map((a) => ({
      appt_id: a.id, provider_id: a.reassign_options[0].provider_id, date: a.appt_date, time: a.appt_time }));
    const r = await post("/api/sched/apply-reassignments", { plan });
    toast(`Applied ${r.applied} reassignment(s)`); runPtoImpact();
  };
}

let _provCache = null;
async function allProviders() {
  if (_provCache) return _provCache;
  const specs = await get("/api/sched/specialties");
  const lists = await Promise.all(specs.map((s) => get("/api/sched/doctors", { specialty: s })));
  _provCache = lists.flat();
  return _provCache;
}

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
  $("#drawerBody").innerHTML = `<div class="side-label">Choose a specialty</div>` +
    specs.map((s) => `<div class="tile" data-spec="${esc(s)}"><span class="nm">${esc(s)}</span><span class="meta">›</span></div>`).join("");
  $("#drawerBody").querySelectorAll("[data-spec]").forEach((t) => t.onclick = () => { D.specialty = t.dataset.spec; stepDoctor(); });
}

async function stepFindAppt() {
  crumbs([{ t: "Find appointment", on: 1 }, { t: D.mode === "cancel" ? "Confirm" : "Calendar" }]);
  $("#drawerBody").innerHTML = `<div class="field-row"><label>Search by patient, MRN, or provider</label><input class="search" id="apptSearch" placeholder="e.g. Russo, SYN-4990, Tanaka"></div><div id="apptResults"></div>`;
  const run = async (q) => {
    const list = await get("/api/sched/appointments", { query: q });
    $("#apptResults").innerHTML = list.slice(0, 12).map((a) => `<div class="tile" data-appt="${a.id}"><span class="nm">${esc(a.patient_name)} <span class="mono">${esc(a.mrn)}</span></span><span class="meta">${esc(a.appt_date)} ${esc(a.appt_time)} · ${esc(a.provider_name)}</span></div>`).join("") || `<div class="sub" style="color:var(--ink-3)">No matches.</div>`;
    $("#apptResults").querySelectorAll("[data-appt]").forEach((t) => t.onclick = () => {
      D.apptId = t.dataset.appt; D.appt = list.find((a) => a.id === D.apptId);
      D.specialty = D.appt.specialty;
      (D.mode === "cancel" ? stepConfirmCancel() : stepDoctor());
    });
  };
  run(""); $("#apptSearch").oninput = (e) => run(e.target.value);
}

async function stepDoctor() {
  crumbs([{ t: D.mode === "new" ? "Specialty" : "Appointment" }, { t: D.specialty || "Doctor", on: 0 }, { t: "Doctor", on: 1 }, { t: "Calendar" }]);
  const docs = await get("/api/sched/doctors", { specialty: D.specialty });
  $("#drawerBody").innerHTML = `<div class="side-label">${esc(D.specialty)} — choose a doctor</div>` +
    docs.map((d) => `<div class="tile" data-doc="${d.id}"><span><span class="nm">${esc(d.name)}</span> <span class="meta">${esc(d.credential)} · ${esc(d.phone)}</span></span>
      <span class="meta">next: ${(d.next_available || {}).date || "—"} ${(d.next_available || {}).time || ""}</span></div>`).join("");
  $("#drawerBody").querySelectorAll("[data-doc]").forEach((t) => t.onclick = () => {
    D.doctor = docs.find((d) => d.id === t.dataset.doc); D.date = (D.doctor.next_available || {}).date || TODAY; stepCalendar();
  });
}

async function stepCalendar() {
  crumbs([{ t: D.specialty }, { t: D.doctor.name }, { t: "Calendar", on: 1 }, { t: "Confirm" }]);
  const cal = await get("/api/sched/calendar", { provider_id: D.doctor.id, date: D.date });
  const slots = cal.slots || [];
  $("#drawerBody").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <button class="btn" id="prevDay">‹ Prev</button><b>${esc(D.doctor.name)} · ${esc(D.date)}</b><button class="btn" id="nextDay">Next ›</button></div>
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
    $("#drawerBody").innerHTML = `<div class="note">Move <b>${esc(D.appt.patient_name)}</b>'s appointment<br>
      from <b>${esc(D.appt.appt_date)} ${esc(D.appt.appt_time)}</b> with ${esc(D.appt.provider_name)}<br>
      to <b>${esc(D.date)} ${esc(D.time)}</b> with ${esc(D.doctor.name)}.</div>
      <button class="btn primary" id="confirmBtn" style="margin-top:12px">Confirm move</button>`;
    $("#confirmBtn").onclick = async () => {
      const r = await post(`/api/sched/modify/${D.appt.id}`, { provider_id: D.doctor.id, date: D.date, time: D.time });
      finish(r.ok, r.ok ? `Moved ${D.appt.patient_name} → ${D.date} ${D.time}` : r.error);
    };
    return;
  }
  const patients = await get("/api/sched/patients");
  $("#drawerBody").innerHTML = `
    <div class="note">${esc(D.doctor.name)} (${esc(D.specialty)}) · <b>${esc(D.date)} ${esc(D.time)}</b></div>
    <div class="field-row" style="margin-top:12px"><label>Patient</label><select id="pat">${patients.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.mrn)} (${p.risk_tier})</option>`).join("")}</select></div>
    <div class="field-row"><label>Type</label><select id="type"><option>Follow-up</option><option>New</option><option>Consult</option></select></div>
    <div class="field-row"><label>Reason</label><input id="reason" placeholder="Reason for visit"></div>
    <button class="btn primary" id="confirmBtn">Book appointment</button>`;
  $("#confirmBtn").onclick = async () => {
    const r = await post("/api/sched/book", { patient_id: $("#pat").value, provider_id: D.doctor.id, date: D.date, time: D.time, type: $("#type").value, reason: $("#reason").value });
    finish(r.ok, r.ok ? `Booked ${r.patient} with ${r.provider} · ${D.date} ${D.time}` : r.error);
  };
}

async function stepConfirmCancel() {
  crumbs([{ t: "Appointment" }, { t: "Confirm cancellation", on: 1 }]);
  $("#drawerBody").innerHTML = `
    <div class="note">Cancel <b>${esc(D.appt.patient_name)}</b>'s ${esc(D.appt.appt_time)} on ${esc(D.appt.appt_date)} with ${esc(D.appt.provider_name)}?</div>
    <div class="field-row" style="margin-top:12px"><label>Reason</label><input id="reason" placeholder="Cancellation reason"></div>
    <button class="btn primary" id="confirmBtn">Cancel appointment</button><div id="reoffer"></div>`;
  $("#confirmBtn").onclick = async () => {
    const r = await post(`/api/sched/cancel/${D.appt.id}`, { reason: $("#reason").value || "scheduler" });
    if (!r.ok) return finish(false, r.error);
    toast("Appointment cancelled — slot freed");
    $("#reoffer").innerHTML = `<div class="side-label" style="margin-top:14px">Re-offer freed slot (${esc(r.freed.time)}) to a higher-risk patient</div>` +
      (r.reoffer_candidates || []).map((c) => `<div class="tile" data-cand="${c.id}"><span><span class="nm">${esc(c.name)}</span> <span class="mono">${esc(c.mrn)}</span></span><span class="badge ${bClass(c.risk_tier)}">${c.risk_tier}</span></div>`).join("");
    $("#reoffer").querySelectorAll("[data-cand]").forEach((t) => t.onclick = async () => {
      const b = await post("/api/sched/book", { patient_id: t.dataset.cand, provider_id: r.freed.provider_id, date: r.freed.date, time: r.freed.time, type: "Follow-up", reason: "re-offered slot" });
      finish(b.ok, b.ok ? `Re-offered ${r.freed.time} to ${b.patient}` : b.error);
    });
  };
}

function finish(ok, msg) {
  toast(msg || (ok ? "Done" : "Action failed"));
  if (ok) { closeDrawer(); _provCache = null; render($(".tab.active").dataset.tab); }
}

/* ---------------- copilot ---------------- */
function renderCopilot(host) {
  host.innerHTML = `
    <div class="chatwrap">
      <div class="chat"><div class="chat-h"><div class="bot">◆</div><div class="nm">Workforce Copilot<small>Med-Surg 4W · granite on KServe (rules fallback) · synthetic</small></div></div>
        <div class="chat-log" id="chatLog"><div class="msg bot"><div class="ic">◆</div><div class="bubble">Hi Dana — I can book, modify, or cancel appointments, run PTO impact, and surface no-show risk for <b>Med-Surg 4W</b> — all from chat. Try a suggestion on the right. <span style="color:var(--ink-3);font-size:12px">All data is synthetic.</span></div></div></div>
        <div class="chat-in"><input id="chatInput" placeholder="Ask the Workforce Copilot…"><button class="btn primary" id="chatSend">Send</button></div></div>
      <div class="chips"><div class="side-label">Suggested</div>
        <button class="chip" data-q="Which cardiologists have openings tomorrow?">Which cardiologists have openings?</button>
        <button class="chip" data-q="Book a cardiology follow-up for Robert Castellano on 2026-06-09 at 13:30">Book a cardiology follow-up for Robert Castellano</button>
        <button class="chip" data-q="Put Dr. Tanaka on PTO from 2026-06-16 to 2026-06-20 and show the impact">Put Dr. Tanaka on PTO Jun 16–20, show impact</button>
        <button class="chip" data-q="Cancel the appointment for Anthony Russo">Cancel Anthony Russo's appointment</button>
        <div class="modelnote">The Copilot routes to the same scheduling actions the UI uses (one source of truth). After a chat action, the tabs reflect the change.</div></div>
    </div>`;
  const log = $("#chatLog");
  const push = (role, html) => { const m = document.createElement("div"); m.className = "msg " + (role === "me" ? "me" : "bot"); m.innerHTML = `<div class="ic">${role === "me" ? "🧑" : "◆"}</div><div class="bubble">${html}</div>`; log.appendChild(m); log.scrollTop = log.scrollHeight; return m.querySelector(".bubble"); };
  const send = async (q) => {
    if (!q.trim()) return;
    push("me", esc(q));
    const bubble = push("bot", "<span style='color:var(--ink-3)'>thinking…</span>");
    let acc = "";
    try {
      for await (const chunk of streamChat(q, ROLE)) { acc += chunk; bubble.textContent = acc; log.scrollTop = log.scrollHeight; }
      if (!acc) bubble.innerHTML = "<span style='color:var(--alert)'>No response — the LLM may still be warming up.</span>";
    } catch (e) { bubble.innerHTML = `<span style='color:var(--alert)'>Copilot error: ${esc(e.message)}</span>`; }
    _provCache = null; // a chat action may have changed state
  };
  $("#chatSend").onclick = () => { const i = $("#chatInput"); send(i.value); i.value = ""; };
  $("#chatInput").onkeydown = (e) => { if (e.key === "Enter") { send(e.target.value); e.target.value = ""; } };
  host.querySelectorAll(".chip").forEach((c) => c.onclick = () => send(c.dataset.q));
}

render("dashboard");
