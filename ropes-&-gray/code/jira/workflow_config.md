# Jira Workflow Configuration

## Statuses to create (in order)

Go to: **Settings → Issues → Statuses → Add status** for each one.

| Status name | Category | Description |
|---|---|---|
| New | To Do | Change request submitted, not yet reviewed |
| Pending Review | In Progress | Technical review in progress |
| Approved | In Progress | Change approved by CAB / manager |
| In Progress | In Progress | Execution triggered; AAP workflow running |
| Pending QA | In Progress | Patch complete; awaiting QA sign-off |
| Rollback Requested | In Progress | QA failed; rollback workflow triggered |
| Resolved | Done | Change complete and QA approved |
| Cancelled | Done | Change cancelled before execution |

## Workflow transitions to create

Go to: **Project Settings → Workflows → Edit** on your Change Request workflow.

| Transition name | From | To | Who triggers | How |
|---|---|---|---|---|
| Submit for review | New | Pending Review | Engineer | Manual |
| Approve | Pending Review | Approved | Manager / CAB | Manual (with approval screen) |
| Start execution | Approved | In Progress | Change approver | Manual — **this fires the EDA webhook** |
| Execution complete | In Progress | Pending QA | AAP (automated) | REST API call from Ansible playbook |
| QA passed | Pending QA | Resolved | QA engineer | Manual |
| Request rollback | Pending QA | Rollback Requested | QA engineer | Manual — **this fires EDA rollback rule** |
| Rollback complete | Rollback Requested | Resolved | AAP (automated) | REST API call from rollback role |
| Cancel | Any open state | Cancelled | Engineer / manager | Manual |

## Step-by-step: create the workflow

1. Go to **Settings → Issues → Workflows → Add workflow**
2. Name: `Change Request Lifecycle`
3. Add all 8 statuses above (drag from left panel)
4. Add each transition listed above (click between status bubbles)
5. For the **Approve** transition, add a screen:
   - Create screen: `Approval Screen`
   - Fields: Approver comments (text field), Risk acceptance (checkbox)
   - Attach to Approve transition
6. Click **Publish**

## Associate workflow to project

1. **Project Settings → Workflows → Add workflow scheme**
2. Name: `CHG Workflow Scheme`
3. Associate `Change Request Lifecycle` to issue type `Change Request`
4. Click **Associate** and migrate existing issues

## Setting the automation to fire on "In Progress" transition

The EDA webhook fires specifically when a ticket transitions to **In Progress**.
This maps to the "Start execution" transition above.

In the Jira Automation rule (see `webhook_eda_config.md`), set:
- Trigger: `Issue transitioned`
- From status: `Approved`
- To status: `In Progress`

This ensures the webhook only fires on deliberate approval, not accidental transitions.
