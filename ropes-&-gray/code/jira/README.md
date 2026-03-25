# Jira Configuration Guide

## Document index

| File | Contents |
|---|---|
| `setup_guide.md` | Create Atlassian account + JSM site (start here) |
| `custom_fields.md` | All 4 custom fields + screen association |
| `workflow_config.md` | Full ITSM status workflow with all 6 states |
| `webhook_eda_config.md` | Jira Automation → EDA webhook rule (the integration) |

## ITSM process this demo implements

```
┌─────────┐   Create    ┌─────────────────┐  Technical   ┌──────────────────┐
│  [NEW]  │ ──────────► │ [PENDING REVIEW] │ ──review──► │   [APPROVED]     │
└─────────┘             └─────────────────┘              └────────┬─────────┘
                                                                   │
                                                          Approver clicks
                                                          "Start execution"
                                                                   │
                                                                   ▼
┌──────────────────┐   Verify    ┌─────────────────┐  Jira   ┌──────────────┐
│  [PENDING QA]    │ ◄────────── │  AAP workflow   │ ◄─────  │[IN PROGRESS] │
└───────┬──────────┘             │  executes       │ webhook └──────────────┘
        │                        │  patches target │  fires
        │ QA Pass                └─────────────────┘
        ▼
┌──────────────────┐
│   [RESOLVED]     │
└──────────────────┘
        ▲
        │ Rollback
        │ confirmed OK
┌──────────────────────┐  Rollback   ┌──────────────────────┐
│ [ROLLBACK REQUESTED] │ ◄────────── │  [PENDING QA] FAIL   │
└──────────────────────┘  workflow   └──────────────────────┘
```

## Pain points addressed

| Client pain point | How this workflow solves it |
|---|---|
| "We don't know what was patched" | Jira comment shows exact KB list before and after, diff clearly shown |
| "Rollback is manual and slow" | EDA detects Rollback Requested transition and fires rollback playbook automatically |
| "No audit trail" | Every state transition recorded in Jira; AAP job logs attached to ticket |
| "Scheduling is ad-hoc" | AUM maintenance window visible in Azure Portal; Jira links to it |
| "We can't see risk before patching" | Pre-change risk flags (uptime, pending reboot, pending update count) shown in Jira comment |
| "QA has to chase engineers for results" | AAP auto-transitions ticket to Pending QA and posts full report — no human handoff needed |
