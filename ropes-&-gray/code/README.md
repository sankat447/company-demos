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

## Resource tagging and cleanup

All resources deployed by Terraform are automatically tagged for identification and cleanup. Tags are applied via AWS provider `default_tags` (covers every AWS resource automatically) and `local.tags` (applied to every Azure resource).

### Tags applied to every resource

| Tag | Example value | Purpose |
|---|---|---|
| `Customer` | `demo-ropes-gray` | Identifies which client this deployment belongs to |
| `Project` | `hybrid-patch-demo` | Project name |
| `Environment` | `demo` | Environment type |
| `ManagedBy` | `terraform` | Distinguishes Terraform-managed resources from manually created ones |
| `Owner` | `sa-team` | Team responsible |
| `TerraformDeployID` | `27bce0` | Unique hex ID for this specific deployment (from `random_id.suffix`) |
| `TerraformWorkspace` | `default` | Terraform workspace that created the resources |

### Deploying for a different customer

Override the `customer` variable to tag resources for another client:

```bash
terraform apply -var="customer=acme-corp"
```

This sets `Customer = demo-acme-corp` on all resources. Each customer's resources are independently identifiable.

### Finding resources by tag

**AWS Console:** Resource Groups & Tag Editor → Tag Editor → filter by `Customer = demo-ropes-gray`

**AWS CLI:**

```bash
# All resources with tags (table format)
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Customer,Values=demo-ropes-gray \
  --region us-east-1 \
  --output table

# ARNs only (cleaner view)
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Customer,Values=demo-ropes-gray \
  --region us-east-1 \
  --query 'ResourceTagMappingList[].ResourceARN' \
  --output table
```

**Azure Portal:** All resources → filter by tag `Customer = demo-ropes-gray`

**Azure CLI:**

```bash
# All resources with a specific tag (table format)
az resource list --tag Customer=demo-ropes-gray --output table

# Concise view — name, type, and resource group only
az resource list --tag Customer=demo-ropes-gray \
  --query '[].{Name:name, Type:type, ResourceGroup:resourceGroup}' \
  --output table
```

### Identifying stale resources

Resources **without** the `ManagedBy = terraform` and `TerraformDeployID` tags are not managed by this Terraform config and are likely stale leftovers from previous deployments. These can be safely reviewed and deleted.

### Active VPC

The Terraform-managed VPC is `vpc-0572c2189b839e69f` (tagged `patch-demo-aap-vpc`). Any other VPCs with the same name but without the `Customer` and `TerraformDeployID` tags are stale and can be removed after confirming they have no running instances or attached resources.

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
