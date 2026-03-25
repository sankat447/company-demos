# AAP Post-Install Configuration Guide

## Overview

After `aap_install.sh` completes, configure AAP objects in this exact order.
All steps via AAP Controller UI unless stated otherwise.

URL: `https://<AAP_EIP>`  
Login: `admin` / `<your aap_admin_password>`

---

## 1. Upload manifest and verify activation

Settings → Subscription → Upload manifest → select `/opt/aap-install/manifest.zip`

Verify: green "Valid subscription" banner appears at top.

---

## 2. Create credentials

**Settings → Credentials → Add** (create all four)

| Name | Type | Fields |
|---|---|---|
| Azure Service Principal | Microsoft Azure Resource Manager | Subscription ID, Client ID, Client Secret, Tenant ID |
| Windows Machine Credential | Machine | Username: `demoAdmin`, Password: `<win admin password>`, Privilege Escalation: none |
| Jira API Token | Custom Credential Type (create first – see below) | JIRA_URL, JIRA_EMAIL, JIRA_TOKEN |
| Red Hat Registry | Container Registry | registry.redhat.io + RHN username/password |

**Creating the Jira Custom Credential Type first:**

Settings → Credential Types → Add:
- Name: `Jira API Token`
- Input config (YAML):
  ```yaml
  fields:
    - id: jira_url
      type: string
      label: Jira base URL
    - id: jira_email
      type: string
      label: Jira account email
    - id: jira_token
      type: string
      label: Jira API token
      secret: true
  required:
    - jira_url
    - jira_email
    - jira_token
  ```
- Injector config (YAML):
  ```yaml
  extra_vars:
    jira_base_url: "{{ jira_url }}"
    jira_user_email: "{{ jira_email }}"
    jira_api_token: "{{ jira_token }}"
  ```

---

## 3. Create the Execution Environment

**Administration → Execution Environments → Add**

- Name: `ee-windows-patching`
- Image: `<your-hub>/ee-windows-patching:latest`
  (Build from `aap/execution_environment.yml` using `ansible-builder`)
- Pull policy: `Always`

If you haven't built the EE yet:
```bash
ansible-builder build -f aap/execution_environment.yml \
  -t ee-windows-patching:latest -v 3

# Push to Private Automation Hub
podman login <AAP_EIP>/ee-windows-patching
podman push ee-windows-patching:latest <AAP_EIP>/ee-windows-patching/ee-windows-patching:latest
```

---

## 4. Create Project

**Projects → Add**

- Name: `Hybrid Patch Playbooks`
- Organisation: Default
- SCM type: Git
- SCM URL: `<your git repo URL>` (or Manual if uploading directly)
- Branch: `main`
- Update revision on launch: checked

---

## 5. Create Inventory

**Inventories → Add → Inventory**

- Name: `Azure Demo Targets`
- Organisation: Default

Then **Inventories → Azure Demo Targets → Sources → Add**:
- Name: `Azure Windows VM`
- Source: Sourced from a Project
- Project: `Hybrid Patch Playbooks`
- Inventory file: `ansible/inventory/azure_hosts.yml`

OR add manually:
**Inventories → Azure Demo Targets → Hosts → Add**:
- Name: `win-azure-01`
- Variables:
  ```yaml
  ansible_host: <AZURE_WIN_PUBLIC_IP>
  ansible_user: demoAdmin
  ansible_connection: winrm
  ansible_winrm_transport: basic
  ansible_winrm_scheme: https
  ansible_winrm_port: 5986
  ansible_winrm_server_cert_validation: ignore
  cloud_provider: azure
  patch_group: security_updates
  ```

---

## 6. Create Job Templates

Create each of the following (**Templates → Add → Job Template**):

### Pre-Change Snapshot
- Playbook: `ansible/playbooks/patch_workflow.yml`
- Inventory: `Azure Demo Targets`
- Credentials: `Windows Machine Credential`, `Azure Service Principal`, `Jira API Token`
- EE: `ee-windows-patching`
- Extra vars: `phase_override: pre_only`
- Ask variables on launch: yes

### Patch Windows Security Updates
- Playbook: `ansible/playbooks/patch_workflow.yml`
- Same credentials
- Extra vars: `phase_override: patch_only`

### Post-Change Verify
- Playbook: `ansible/playbooks/patch_workflow.yml`
- Extra vars: `phase_override: verify_only`

### Rollback Patch
- Playbook: `ansible/playbooks/rollback.yml`
- Same credentials

### WinRM Connectivity Test
- Playbook: `ansible/playbooks/test_winrm.yml`
- Job type: Check

---

## 7. Create Workflow Template

**Templates → Add → Workflow Job Template**

- Name: `Hybrid Patch Workflow`
- Organisation: Default
- Ask variables on launch: yes

**Survey** (Workflow → Survey → Add):

| Question | Variable | Type | Required |
|---|---|---|---|
| Jira Ticket ID | jira_ticket_id | Text | Yes |
| Target hosts group | target_hosts | Multiple choice: windows, windows_azure | Yes |
| Dry run (check mode) | dry_run | Multiple choice: false, true | Yes |
| Maintenance window label | patch_window | Text | No |
| Risk level | risk_level | Multiple choice: Low, Medium, High | No |

**Workflow visualiser** – wire nodes:

```
[Pre-Change Snapshot]
       │ on_success
       ▼
[Patch Windows Security Updates]
       │ on_success              │ on_failure
       ▼                         ▼
[Post-Change Verify]         [Rollback Patch]
       │ on_success              │
       ▼                         ▼
[Notify Jira – PASS]     [Notify Jira – ROLLBACK]
```

---

## 8. Configure EDA Controller

Browse to: `https://<AAP_EIP>:8443`  
Login: admin / `<aap_admin_password>`

### 8a. Create EDA credentials
**EDA → Credentials → Add**:
- Name: `AAP Controller Token`
- Credential type: Red Hat Ansible Automation Platform
- URL: `https://localhost` (EDA talks to Controller on same host)
- Token: Generate in Controller → Users → admin → Tokens → Add

### 8b. Create EDA project
**EDA → Projects → Create**:
- Name: `Jira Patch Rulebooks`
- SCM URL: same repo as AAP project
- Credential: your Git credential (if private repo)

### 8c. Create Event Stream (webhook receiver)
**EDA → Event Streams → Create**:
- Name: `jira-patch`
- Event stream type: Generic
- This generates the webhook URL:
  `https://<AAP_EIP>:8443/api/eda/v1/external_event_stream/jira-patch/`
- Copy this URL — it goes into Jira Automation rule

### 8d. Create Rulebook Activation
**EDA → Rulebook Activations → Create**:
- Name: `Jira Patch Handler`
- Project: `Jira Patch Rulebooks`
- Rulebook: `aap/eda/rulebooks/jira_patch_rulebook.yml`
- Decision environment: `de-supported-rhel9` (default)
- Controller URL: `https://localhost`
- Controller token: `AAP Controller Token`
- Event streams: `jira-patch`
- Status: Enabled

---

## 9. Verify end-to-end

```bash
# From AAP Controller (or workstation with Ansible)
ansible windows -m win_ping \
  -i ansible/inventory/azure_hosts.yml \
  --extra-vars "ansible_password=<WIN_PASS>"
```

Expected: `win-azure-01 | SUCCESS => {"ping": "pong"}`

Then test the full workflow manually before wiring Jira:
Templates → Hybrid Patch Workflow → Launch →
  jira_ticket_id=TEST-001, target_hosts=windows, dry_run=true
