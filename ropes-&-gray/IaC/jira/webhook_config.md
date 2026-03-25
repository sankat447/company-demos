---
# jira/webhook_config.md
# Step-by-step guide to wire Jira → AAP webhook.

## Jira webhook setup (Jira Service Management Cloud)

### 1. Create an AAP webhook credential
In AAP controller UI:
  Settings → Credentials → Add
    Name      : Jira Webhook HMAC
    Type      : Webhook Token
    Token     : <generate a strong random string – save it>

### 2. Configure the Job Template to accept webhooks
  Job Template → "Hybrid Patch Workflow" → Edit
    Enable webhook : ✓
    Webhook service: GitHub (select as generic – AAP maps both)
    Webhook key    : (copy the Webhook URL shown after saving)

  The webhook URL will look like:
    https://<aap-controller>/api/v2/workflow_job_templates/<id>/github/

### 3. Create the Jira automation rule
  Jira project → Project Settings → Automation → Create rule

  Trigger:
    Issue transitioned
    From status : Approved
    To status   : In Progress

  Condition:
    Issue matches JQL:
      project = CHG AND issuetype = "Change Request"

  Action:
    Send web request
      URL    : https://<aap-controller>/api/v2/workflow_job_templates/<id>/github/
      Method : POST
      Headers:
        Content-Type: application/json
        X-Hub-Signature: <HMAC-SHA256 signature of body using shared token>
      Body (JSON):
        {
          "extra_vars": {
            "jira_ticket_id": "{{issue.key}}",
            "target_hosts": "{{issue.fields.customfield_patch_scope}}",
            "dry_run": "false",
            "patch_window": "{{issue.fields.customfield_maintenance_window}}"
          }
        }

### 4. Jira custom fields required
  Create these custom fields in your Jira project:
    Field name               Type        Field key
    Patch Scope              Text        customfield_patch_scope
    Maintenance Window       Text        customfield_maintenance_window
    Risk Level               Dropdown    customfield_risk_level
    Rollback Required        Checkbox    customfield_rollback_required
    AAP Job URL              URL         customfield_aap_job_url

### 5. Test the webhook
  1. Create a test Change Request in Jira (project: CHG)
  2. Set Patch Scope = "windows_azure"
  3. Transition ticket: Open → Approved → In Progress
  4. In AAP: Jobs → confirm "Hybrid Patch Workflow" job was launched
  5. Check job extra_vars contain jira_ticket_id = your ticket key

### 6. Jira API token for AAP callbacks
  Jira → Account Settings → Security → API tokens → Create
    Label : ansible-aap-svc
  Copy the token.
  In AAP:
    Credentials → Add
      Name : Jira API Token
      Type : Custom credential type (or Generic Secret)
      Fields:
        JIRA_API_TOKEN : <paste token>
        JIRA_USER_EMAIL: ansible-svc@yourco.com
  Reference in playbook as: {{ jira_api_token }} / {{ jira_user_email }}
