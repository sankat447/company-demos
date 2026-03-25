# Jira → EDA Webhook Configuration

## Overview

```
Jira ticket transitions to "In Progress"
           │
           │  HTTP POST  (Jira Automation rule)
           ▼
EDA Controller webhook receiver
  https://<AAP_EIP>:8443/api/eda/v1/external_event_stream/jira-patch/
           │
           │  EDA evaluates rulebook conditions
           ▼
AAP Workflow: "Hybrid Patch Workflow" launches with Jira extra_vars
           │
           │  Ansible posts comment + transitions ticket
           ▼
Jira ticket → "Pending QA" with full patch report in comments
```

## Step 1 – Get the EDA webhook URL

After AAP install and EDA event stream creation (see `aap/README.md`):

```
URL: https://<AAP_EIP>:8443/api/eda/v1/external_event_stream/jira-patch/
```

Test it is reachable from your workstation:
```bash
curl -sk -o /dev/null -w "%{http_code}" \
  https://<AAP_EIP>:8443/api/eda/v1/external_event_stream/jira-patch/
# Expected: 405 (Method Not Allowed for GET – that is correct, it expects POST)
```

## Step 2 – Create the Jira Automation rule

**Jira Project → Project Settings → Automation → Create rule**

### Trigger
- Type: **Issue transitioned**
- From status: `Approved`
- To status: `In Progress`

### Condition (optional but recommended)
- Type: **Issue matches JQL**
- JQL: `project = CHG AND issuetype = "Change Request"`
- This prevents non-patch tickets from firing the webhook

### Action: Send web request
- URL: `https://<AAP_EIP>:8443/api/eda/v1/external_event_stream/jira-patch/`
- Method: **POST**
- Headers:
  ```
  Content-Type: application/json
  ```
- Body (use Jira smart values):
  ```json
  {
    "issue": {
      "key":    "{{issue.key}}",
      "summary":"{{issue.summary}}",
      "fields": {
        "project":                      { "key": "{{issue.fields.project.key}}" },
        "issuetype":                    { "name": "{{issue.fields.issuetype.name}}" },
        "priority":                     { "name": "{{issue.fields.priority.name}}" },
        "reporter":                     { "emailAddress": "{{issue.fields.reporter.emailAddress}}" },
        "assignee":                     { "emailAddress": "{{issue.fields.assignee.emailAddress}}" },
        "labels":                       {{issue.fields.labels}},
        "customfield_patch_scope":      "{{issue.fields.Patch Scope}}",
        "customfield_maintenance_window":"{{issue.fields.Maintenance Window}}",
        "customfield_risk_level":       { "value": "{{issue.fields.Risk Level}}" }
      }
    },
    "transition": {
      "to_status": "In Progress"
    }
  }
  ```
- Delay before sending: **0 seconds**
- Wait for response: **Yes** (for error logging)
- Expected response code: `200`

### Action: Add comment (for audit trail in Jira)
After the webhook action, add a second action:
- Type: **Add comment**
- Comment: `Automation triggered: AAP patch workflow launched at {{now.jiraDate}}`

### Rule name
`Trigger AAP patch workflow on approval`

### Enable and test
1. Save and enable the rule
2. Create a test CHG ticket with Patch Scope = `windows`
3. Transition: New → Pending Review → Approved → In Progress
4. Check: AAP Jobs → a new "Hybrid Patch Workflow" job should appear within 10 seconds
5. Check: Jira ticket → comment added by AAP after job completes

## Step 3 – Create a second rule for rollback

**Create rule** (separate from above):

### Trigger
- Type: **Issue transitioned**
- From status: `Pending QA`
- To status: `Rollback Requested`

### Action: Send web request
Same URL as above, body:
```json
{
  "issue": {
    "key": "{{issue.key}}",
    "fields": {
      "project":                 { "key": "{{issue.fields.project.key}}" },
      "customfield_patch_scope": "{{issue.fields.Patch Scope}}"
    }
  },
  "transition": {
    "to_status": "Rollback Requested"
  },
  "comment": {
    "body": "{{issue.comments.last.body}}"
  }
}
```

### Rule name
`Trigger AAP rollback workflow`

## Troubleshooting

| Symptom | Check |
|---|---|
| Webhook fires but no AAP job appears | EDA Rulebook Activation → check it is Enabled; check EDA logs: `journalctl -u automation-eda-server -n 100` |
| 403 from webhook URL | EDA event stream credential may need updating; re-generate token |
| Jira shows "Request failed" in automation audit | Check AAP EIP security group allows inbound 8443 from `0.0.0.0/0` (Atlassian has no fixed IP range) |
| Job launches but fails immediately | Check AAP survey extra_vars; `jira_ticket_id` must not be empty |
| Jira comment not posted | Check `jira_api_token` credential in AAP; token may have expired (rotate via id.atlassian.com) |
| Wrong transition fired | Verify Jira workflow status names match exactly: `jira_status_pending_qa` and `jira_status_rollback_requested` in `group_vars/windows.yml` |
