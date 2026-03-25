# Jira Account Setup Guide

## What you need to start

| Item | Detail | Cost |
|---|---|---|
| Work email address | yourname@company.com | Free |
| Email inbox access | For verification link | Free |
| Site name chosen | e.g. acme-patch-demo → acme-patch-demo.atlassian.net | Free |
| No credit card | Free tier needs no payment method | $0 |

## Account creation (5 minutes)

1. Go to: **https://www.atlassian.com/software/jira/service-management/free**
2. Click **"Get it free"**
3. Enter your work email → click **Sign up**
4. Check inbox → click verification link (expires 24 hours)
5. Set password (min 8 chars, mixed case + number)
6. Choose site name when prompted — this becomes `yourname.atlassian.net` (**cannot be changed**)
7. Select **Jira Service Management** as the product
8. Skip any upgrade/trial prompts → **Stay on Free**

## Create the project (5 minutes)

1. From JSM home → **Create project**
2. Select template: **IT service management**
3. Project name: `Change Management`
4. Project key: **`CHG`** (must match the key in all playbooks and EDA rulebook)
5. Click **Create**
6. Confirm you can see the board at: `yoursite.atlassian.net/jira/servicedesk/projects/CHG`

## Custom fields (10 minutes)

Go to: **Settings (cog icon, top right) → Issues → Custom fields → Create custom field**

Create all four:

### Field 1: Patch Scope
- Type: **Text Field (single line)**
- Name: `Patch Scope`
- Description: `Ansible inventory group or host to target (e.g. windows, windows_azure)`
- After creation → associate to: `Change Request` issue type screen

### Field 2: Maintenance Window
- Type: **Text Field (single line)**
- Name: `Maintenance Window`
- Description: `AUM maintenance window label (e.g. weekly-saturday-0200utc)`
- Associate to: `Change Request` screen

### Field 3: Risk Level
- Type: **Select List (single choice)**
- Name: `Risk Level`
- Options: `Low`, `Medium`, `High`
- Default: `Medium`
- Associate to: `Change Request` screen

### Field 4: Rollback Required
- Type: **Checkbox**
- Name: `Rollback Required`
- Default: unchecked
- Associate to: `Change Request` screen

### Associate fields to the screen (critical step)
After creating each field, if Jira doesn't prompt for screen association:
1. **Settings → Issues → Screens**
2. Find the screen used by CHG project Change Request (usually named `CHG: Change Request Default Screen`)
3. Click **Configure** → drag all 4 fields into the screen
4. Save

## Create API token (3 minutes)

1. Go to: **https://id.atlassian.com/manage-profile/security/api-tokens**
2. Click **Create API token**
3. Label: `ansible-aap-svc`
4. Click **Create** → **copy the token immediately** (shown once only)
5. Store in AAP as credential (see `aap/README.md` Step 2)

## Update group_vars/windows.yml

```yaml
jira_base_url:    "https://yoursite.atlassian.net"
jira_project_key: "CHG"
# jira_api_token and jira_user_email come from AAP Jira credential at runtime
```

## Invite a second agent (for demo realism)

Settings → User management → Invite user → enter your "approver" colleague's email.
Free tier includes 3 agents total. Having a distinct approver makes the approval step
look real during the demo.
