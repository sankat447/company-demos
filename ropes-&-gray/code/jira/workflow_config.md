# Jira Workflow Configuration

## Workflow: CHG: Azure Windows Infrastructure Management

### Statuses

| Status name | Category | Description |
|---|---|---|
| New CHG Request | To Do | Change request submitted, not yet reviewed |
| Under Review | In Progress | Technical review in progress |
| Patch Windows (Automation) | In Progress | EDA webhook fires; AAP patch workflow running |
| QA Testing | In Progress | Patch complete; awaiting QA sign-off |
| Accepted | Done | Change accepted after QA |
| Revert Patch | In Progress | QA failed; EDA rollback webhook fires |
| Resolved | Done | Rollback complete |

### Transitions

| Transition name | From | To | Who triggers | How |
|---|---|---|---|---|
| Submit for review | New CHG Request | Under Review | Engineer | Manual |
| Start patching | Under Review | Patch Windows (Automation) | Change approver | Manual — **fires EDA patch webhook** |
| Execution complete | Patch Windows (Automation) | QA Testing | AAP (automated) | REST API call from Ansible playbook |
| QA passed | QA Testing | Accepted | QA engineer | Manual |
| Request rollback | QA Testing | Revert Patch | QA engineer | Manual — **fires EDA rollback webhook** |
| Rollback complete | Revert Patch | Resolved | AAP (automated) | REST API call from rollback role |

### Flow diagram

```
[New CHG Request] → [Under Review] → [Patch Windows (Automation)] → [QA Testing] → [Accepted]
                                              ↑ fires EDA                  ↓
                                              webhook               [Revert Patch] → [Resolved]
                                                                     ↑ fires EDA
                                                                     rollback webhook
```

## Jira Automation rules

### Rule 1: Notify AAP on Patch Windows
- Trigger: `Work item transitioned`
- From status: `Under Review`
- To status: `Patch Windows (Automation)`
- Action: Send web request POST to EDA webhook
- Payload: `{"issue_key": "{{issue.key}}", "issue_summary": "{{issue.summary}}", "project_key": "{{issue.fields.project.key}}", "issue_status": "Patch Windows (Automation)"}`

### Rule 2: Trigger AAP Rollback
- Trigger: `Work item transitioned`
- From status: `QA Testing`
- To status: `Revert Patch`
- Action: Send web request POST to EDA webhook
- Payload: `{"issue_key": "{{issue.key}}", "issue_summary": "{{issue.summary}}", "project_key": "{{issue.fields.project.key}}", "issue_status": "Revert Patch"}`

## Webhook URL
```
https://54.86.7.223/eda-event-streams/api/eda/v1/external_event_stream/<event-stream-uuid>/post/
```

## Ansible status mappings (group_vars/windows.yml)
```yaml
jira_status_pending_qa:          "QA Testing"
jira_status_rollback_requested:  "Revert Patch"
jira_status_resolved:            "Resolved"
```
