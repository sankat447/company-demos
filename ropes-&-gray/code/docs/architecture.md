# Architecture Narrative & Pain Points Addressed

## Why this architecture

The client is an Azure shop. Their pain (as described by James):

> "We need Jira ticket → patch → risk/impact → scheduling → rollback/logging"

Every component in this demo is chosen to address one of those five concerns
directly, while keeping the architecture cloud-agnostic for the future.

---

## Component decisions

### Why AAP on AWS, not on-prem or Azure?

For the demo, AAP is on AWS because:
- It can be stood up from scratch in 45 minutes using the Terraform in this repo
- It is torn down after the demo — no persistent cost
- It proves AAP is cloud-agnostic (runs on AWS, targets Azure)
- The client's on-prem team can swap this to their own AAP without changing a single playbook

In production, AAP would run on-prem or on the client's preferred cloud. The playbooks
and EDA rulebook are identical regardless of where the controller lives.

### Why EDA (Event-Driven Ansible) instead of a direct AAP webhook?

Direct AAP webhooks exist but EDA adds:
- **Conditional routing** — different rules for patch, rollback, emergency, dry-run
- **Event filtering** — only CHG tickets in specific states fire the workflow
- **Extensibility** — future rules (e.g. alert-triggered auto-patch) drop into the same rulebook
- **Audit** — EDA logs every received event and every rule evaluation

The Jira → EDA → AAP chain is one extra hop but it makes the integration durable
and extensible without touching playbook code.

### Why Azure Update Manager, not just win_updates?

AUM provides:
- A compliance dashboard the client already owns (no new tool)
- A maintenance window schedule that AAP respects (scheduling pain solved)
- An Azure Policy enforcement layer (every new VM gets assessed automatically)
- Log Analytics integration for KQL-queryable patch history

AAP's `win_updates` module does the actual patching. AUM provides the intelligence
layer around it — what needs patching, when, and whether it was done.

---

## Full process flow with pain point mapping

### [1] CREATE — Engineer submits a Change Request

**How:** Jira JSM → Create → Change Request → fill Patch Scope, Maintenance Window, Risk Level

**Pain addressed:** Currently, change requests are often informal (email, Slack).
This gives every patch a formal ticket with a unique ID, an audit trail, and a
structured set of required inputs before anything runs.

---

### [2] PENDING REVIEW — Technical review

**How:** Ticket transitions New → Pending Review. Technical lead reviews:
- Is the Patch Scope correct (right hosts)?
- Does the Maintenance Window align with AUM schedule?
- Is the Risk Level appropriate?

**Pain addressed:** No gate currently exists between "someone wants to patch" and
"patching runs". This transition forces a human review step.

---

### [3] APPROVED — CAB / manager approves

**How:** Ticket transitions Pending Review → Approved.

In the demo, this is done manually by the "approver" account. In production,
Jira's built-in approval feature can enforce minimum approver count.

**Pain addressed:** Compliance requirement — changes must be authorised before execution.
AAP will not run until this transition happens.

---

### [4] IN PROGRESS — Execution triggered (the moment of automation)

**How:** Approver clicks "Start execution" → ticket transitions Approved → In Progress.

This transition fires the Jira Automation rule, which POSTs to the EDA webhook.
EDA evaluates the event against the rulebook. Rule 1 matches → AAP Hybrid Patch
Workflow is launched with the Jira ticket data as extra_vars.

**AAP workflow steps:**
1. **Pre-change snapshot** — captures KB list, uptime, pending reboot state, AUM pending count. Stores as host facts. Flags any pre-existing risk conditions.
2. **Patch execution** — `win_updates` applies security and critical updates. Handles reboot with health wait. Logs to `C:\Windows\Temp\ansible_patch_<date>.log`.
3. **Post-change verify** — compares KB list before/after, checks critical services, probes app health endpoint. Computes risk flags. Renders and posts the Jira comment. Transitions ticket to Pending QA.

If verify fails → rollback role fires automatically via AAP workflow on_failure edge.

**Pain addressed:** Patches are currently triggered by running scripts manually,
with no pre-check, no post-check, and no record. This replaces all of that with
a controlled, audited, automated sequence.

---

### [5] PENDING QA — QA engineer reviews the patch report

**How:** AAP has already posted a full report to the Jira ticket comment:

```
════════════════════════════════════════════
 ANSIBLE PATCH RUN REPORT
════════════════════════════════════════════
Ticket    : CHG-1042
Host      : win-azure-01 (20.1.2.3)
Verdict   : PASS
────────────────────────────────────────────
 PRE-CHANGE STATE
KBs installed before : 127
Last boot            : 2025-01-10T02:14:00
Uptime (days)        : 14
Pending reboot before: False
AUM pending updates  : 8
────────────────────────────────────────────
 PATCH EXECUTION
KBs installed this run:
  + KB5034441
  + KB5034843
────────────────────────────────────────────
 POST-CHANGE STATE
KBs installed after  : 129
Net new KBs this run : KB5034441, KB5034843
Critical services    : all running
 No risk flags detected.
────────────────────────────────────────────
 NEXT ACTION
Ticket transitioned to: Pending QA
QA engineer: please review and transition to Resolved.
════════════════════════════════════════════
```

QA engineer reviews in Jira — no need to log into any other system.
- If satisfied → transition to **Resolved**
- If unsatisfied → transition to **Rollback Requested**

**Pain addressed:** "QA has to chase engineers for results." The report is already
in the ticket. Risk flags are explicit. The QA engineer never needs to SSH into a
server or open AAP.

---

### [6A] RESOLVED — Change successfully closed

**How:** QA transitions Pending QA → Resolved.

The ticket now has a complete audit trail:
- When it was created and by whom
- Who approved it
- When AAP ran it
- What was patched (KB list, diff)
- What the pre/post state was
- Who signed it off in QA

**Pain addressed:** No current audit trail. Compliance teams have no way to answer
"what was patched on which server on what date, approved by whom."

---

### [6B] ROLLBACK REQUESTED → RESOLVED — Failed change rolled back

**How:** QA transitions Pending QA → Rollback Requested.

This transition fires EDA Rule 2. AAP launches the Rollback Patch workflow:
1. Uninstalls each KB from `newly_installed_kbs` list via `wusa.exe`
2. Reboots
3. Verifies KBs are absent
4. Posts rollback result comment to Jira
5. Transitions ticket to Rollback Requested (or Resolved if rollback clean)

**Pain addressed:** "Rollback is manual and takes hours." AAP uninstalls specific
KBs (not a full system restore) within minutes. If an Azure snapshot was taken,
it is available as a fallback.

---

## Azure Portal views to open during the demo

| Portal view | URL path | What to show |
|---|---|---|
| Update Manager — Machines | Monitor → Update Manager → Machines | VM in compliance view, pending updates |
| Maintenance configurations | Monitor → Update Manager → Maintenance configurations | Weekly Saturday window |
| Log Analytics — Queries | Resource group → Law workspace → Logs | KQL: `Update \| where UpdateState == "Needed"` |
| Azure Policy compliance | Policy → Compliance | Periodic assessment policy showing compliant |
| VM Overview | Resource group → vm-win-target | Running state, OS, size |
