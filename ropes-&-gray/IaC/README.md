# Hybrid Patch Demo

**AAP + Azure Update Manager + Jira Service Management**

A complete hybrid Windows patching demo: Jira change request → AAP automation → Azure + AWS target VMs → risk-enriched Jira audit comment.

## Structure

```
hybrid-patch-demo/
├── iac/
│   ├── deploy.sh              # Interactive auth + terraform apply
│   ├── destroy.sh             # Teardown all demo resources
│   └── terraform/
│       ├── providers.tf       # AWS + Azure + random providers
│       ├── variables.tf       # Input variables with defaults
│       ├── main.tf            # Locals and shared resources
│       ├── aws.tf             # VPC + Windows VM + WinRM bootstrap
│       ├── azure.tf           # VNet + Windows VM + Update Manager config
│       └── outputs.tf         # VM IPs and credentials
├── ansible/
│   ├── inventory/
│   │   └── demo_hosts.yml     # Fill in IPs from Terraform outputs
│   ├── group_vars/
│   │   └── windows.yml        # WinRM, Jira, Azure defaults
│   ├── roles/
│   │   ├── pre_change_snapshot/        # KB list, uptime, Azure snapshot
│   │   ├── patch_windows_security_updates/  # win_updates + reboot
│   │   ├── post_change_verify/         # KB diff, services, Jira comment
│   │   └── rollback_patch/             # KB uninstall + snapshot restore
│   ├── playbooks/
│   │   ├── patch_workflow.yml  # Master 3-phase playbook
│   │   ├── rollback.yml        # Standalone rollback
│   │   └── test_winrm.yml      # Pre-demo connectivity check
│   └── templates/
│       └── jira_comment.j2     # Jinja2 Jira comment template
├── aap/
│   ├── execution_environment.yml  # ansible-builder EE definition
│   ├── job_templates.yml           # All job template definitions
│   └── workflow_template.yml       # AAP workflow with on_failure rollback
└── jira/
    └── webhook_config.md           # Step-by-step Jira → AAP webhook guide
```

## Quick start

```bash
# 1. Deploy infrastructure
cd iac && bash deploy.sh

# 2. Update inventory with Terraform outputs
terraform -chdir=terraform output
# Edit ansible/inventory/demo_hosts.yml

# 3. Test connectivity
cd ../ansible
ansible windows -m win_ping -i inventory/demo_hosts.yml

# 4. Run dry-run
ansible-playbook playbooks/patch_workflow.yml \
  -i inventory/demo_hosts.yml \
  -e "jira_ticket_id=TEST-001 target_hosts=windows dry_run=true"

# 5. Teardown
cd ../iac && bash destroy.sh
```

## Full documentation

See `Hybrid_Patch_Demo_Runbook.docx` for:
- Complete prerequisites list
- Step-by-step deployment guide
- Demo configuration and browser tab layout
- 7-step demo showcase script
- Teardown instructions
