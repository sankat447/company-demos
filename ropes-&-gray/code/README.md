# Azure Windows Patch Demo v2

**AAP 2.6 (AWS) → EDA → Azure Windows target → Jira ITSM full lifecycle**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  JIRA SERVICE MANAGEMENT (Cloud Free)                               │
│  Change Request lifecycle:                                          │
│  New → Pending Approval → Approved → In Progress →                 │
│        Pending QA → Resolved / Rollback Requested                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │  Webhook (HTTPS POST on transition)
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AWS (us-east-1)  –  AAP 2.6 all-in-one  (m5.xlarge / RHEL 9)     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  AAP Controller  │  │  EDA Controller  │  │  Automation Hub  │  │
│  │  Job templates   │  │  Rulebook:       │  │  EE registry     │  │
│  │  Workflow engine │  │  jira_patch.yml  │  │  Collection host │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
└────────────────────┬────────────────────────────────────────────────┘
                     │  WinRM HTTPS (5986) outbound to Azure
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AZURE  –  Client's Azure estate                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Resource Group: rg-patch-demo                               │   │
│  │  ┌──────────────────┐  ┌──────────────────────────────────┐  │   │
│  │  │  Windows Server  │  │  Azure Update Manager            │  │   │
│  │  │  2019 VM         │  │  Compliance dashboard            │  │   │
│  │  │  (patch target)  │  │  Maintenance window              │  │   │
│  │  └──────────────────┘  └──────────────────────────────────┘  │   │
│  │  ┌──────────────────┐  ┌──────────────────────────────────┐  │   │
│  │  │  Log Analytics   │  │  Azure Monitor / Alerts          │  │   │
│  │  │  Workspace       │  │  Patch compliance view           │  │   │
│  │  └──────────────────┘  └──────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## ITSM Process Flow (what the demo covers)

```
[1] CREATE      Engineer creates CHG ticket in Jira
                Sets: Patch Scope, Maintenance Window, Risk Level
                      
[2] REVIEW      Technical review: is this change safe?
                Ticket moves: New → Pending Approval
                
[3] APPROVE     CAB / manager approves the change
                Ticket moves: Pending Approval → Approved
                
[4] ACTION      Change approver starts execution
                Ticket moves: Approved → In Progress
                ↳ Jira webhook fires to EDA Controller (AAP AWS)
                ↳ EDA rulebook validates event, launches AAP workflow
                ↳ AAP: pre-check → snapshot → patch → verify
                ↳ AAP posts result comment back to Jira ticket
                Ticket moves automatically: In Progress → Pending QA
                
[5] QA          QA engineer reviews Jira comment:
                pre/post KB diff, risk flags, service health, job URL
                If PASS → Resolved
                If FAIL → Rollback Requested (triggers rollback workflow)
                
[6] CLOSE       Ticket moves: Pending QA → Resolved (success)
                         or: Pending QA → Rollback Requested → Resolved
```

## Repository structure

```
hybrid-patch-demo-v2/
├── README.md                          ← this file
├── docs/
│   └── architecture.md               ← full narrative + pain points addressed
├── iac/
│   ├── deploy.sh                      ← interactive deploy (Azure + AWS)
│   ├── destroy.sh                     ← teardown
│   └── terraform/
│       ├── providers.tf
│       ├── variables.tf
│       ├── main.tf
│       ├── aws_aap.tf                 ← RHEL9 EC2 + AAP 2.6 all-in-one
│       ├── azure_network.tf           ← VNet / subnet / NSG / PIP
│       ├── azure_windows_target.tf    ← Windows Server 2019 patch target
│       ├── azure_update_manager.tf    ← AUM + Log Analytics + maintenance window
│       └── outputs.tf
├── aap/
│   ├── README.md                      ← AAP post-deploy configuration guide
│   ├── install/
│   │   ├── README.md                  ← AAP 2.6 installation walkthrough
│   │   ├── aap_install.sh             ← installer script (run on EC2 after Terraform)
│   │   └── inventory.ini.tpl          ← AAP installer inventory template
│   ├── eda/
│   │   ├── README.md                  ← EDA + Jira webhook wiring guide
│   │   └── rulebooks/
│   │       └── jira_patch_rulebook.yml ← EDA rulebook: Jira event → AAP workflow
│   ├── execution_environment.yml      ← ansible-builder EE definition
│   ├── job_templates.yml              ← all job template definitions
│   └── workflow_template.yml          ← AAP workflow with rollback edge
├── ansible/
│   ├── README.md
│   ├── inventory/
│   │   └── azure_hosts.yml            ← Azure-only inventory (one Windows VM)
│   ├── group_vars/
│   │   └── windows.yml                ← WinRM + Jira + Azure defaults
│   ├── roles/
│   │   ├── pre_change_snapshot/       ← KB list, uptime, AUM query, snapshot
│   │   ├── patch_windows_security_updates/ ← win_updates + reboot handling
│   │   ├── post_change_verify/        ← KB diff, services, Jira comment POST
│   │   └── rollback_patch/            ← uninstall KBs + snapshot restore
│   ├── playbooks/
│   │   ├── patch_workflow.yml         ← master 3-phase playbook
│   │   ├── rollback.yml
│   │   └── test_winrm.yml             ← pre-demo connectivity check
│   └── templates/
│       └── jira_comment.j2            ← full pre/post/diff/risk Jira comment
└── jira/
    ├── README.md                      ← Jira account + project setup guide
    ├── setup_guide.md                 ← step-by-step account creation
    ├── custom_fields.md               ← all 4 custom fields with screen config
    ├── workflow_config.md             ← ITSM status workflow setup
    └── webhook_eda_config.md          ← Jira Automation → EDA webhook config
```

## Quick start

```bash
# 1. Deploy infrastructure
cd iac && bash deploy.sh

# 2. Install AAP 2.6 on EC2 (SSH in, run script)
ssh -i ~/.ssh/id_rsa ec2-user@<AAP_EC2_PUBLIC_IP>
bash /opt/aap-install/aap_install.sh

# 3. Configure AAP (see aap/README.md)

# 4. Update Azure inventory
terraform -chdir=terraform output
# Edit ansible/inventory/azure_hosts.yml with Azure VM IP

# 5. Test WinRM from AAP controller
ansible windows -m win_ping -i /path/to/inventory/azure_hosts.yml

# 6. Configure Jira (see jira/README.md)

# 7. Run dry-run end-to-end
# Create CHG ticket → Approve → transition to In Progress
# Watch AAP Jobs → confirm Jira comment posted

# 8. Teardown after demo
bash destroy.sh
```

## Pain points this demo addresses

| James's requirement | How the demo addresses it |
|---|---|
| Jira ticket → patch | EDA watches Jira webhook; one approval click triggers AAP automatically |
| Risk / impact visibility | Pre/post KB diff + risk flags posted directly into Jira comment |
| Scheduling / maintenance windows | Azure Update Manager maintenance config visible in portal; AAP respects it |
| Rollback capability | Automatic rollback on verify failure; separate Rollback Requested flow in Jira |
| Audit logging | Every step logged to AAP stdout + Jira comment + Log Analytics |
| Hybrid estate | AAP on AWS running playbooks against Azure targets (extensible to on-prem) |
| Azure-native compliance | AUM compliance dashboard shows VM patch state natively |
