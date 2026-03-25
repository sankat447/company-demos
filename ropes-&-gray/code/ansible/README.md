# Ansible Playbooks & Roles

## Structure

```
ansible/
├── inventory/azure_hosts.yml     ← Single Azure Windows target
├── group_vars/windows.yml        ← WinRM, Jira, Azure settings
├── roles/
│   ├── pre_change_snapshot/      ← KB list, uptime, AUM query, risk flags
│   ├── patch_windows_security_updates/ ← win_updates + controlled reboot
│   ├── post_change_verify/       ← KB diff, services, Jira comment + transition
│   └── rollback_patch/           ← KB uninstall + Jira rollback comment
├── playbooks/
│   ├── patch_workflow.yml        ← Master 3-phase playbook (called by AAP)
│   ├── rollback.yml              ← Rollback playbook (called by EDA rule 2)
│   └── test_winrm.yml            ← Pre-demo connectivity check
└── templates/
    └── jira_comment.j2           ← Full pre/post/diff/risk Jira report
```

## After Terraform: update the inventory

```bash
# Get Azure VM IP
terraform -chdir=iac/terraform output azure_windows_public_ip

# Edit ansible/inventory/azure_hosts.yml
# Replace AZURE_WIN_IP with the actual public IP
```

## Test connectivity

```bash
# From AAP controller (after installation) or your workstation
ansible windows -m win_ping \
  -i ansible/inventory/azure_hosts.yml \
  -e "ansible_password=<WIN_PASS>"
```

## Run dry-run locally (without AAP)

```bash
ansible-playbook ansible/playbooks/patch_workflow.yml \
  -i ansible/inventory/azure_hosts.yml \
  -e "jira_ticket_id=TEST-001" \
  -e "target_hosts=windows" \
  -e "dry_run=true" \
  -e "ansible_password=<WIN_PASS>"
```

## Role sequence and data flow

```
pre_change_snapshot
  └── sets: pre_change_state (dict), pre_installed_kbs, pre_risk_flags

patch_windows_security_updates
  └── sets: newly_installed_kbs, patch_reboot_required, reboot_result

post_change_verify
  ├── reads: pre_change_state, newly_installed_kbs
  ├── sets:  post_change_state (verdict: PASS/FAIL)
  ├── posts: Jira comment via REST API
  └── transitions: Jira ticket → Pending QA (on PASS)
         OR fails playbook (on FAIL → triggers AAP rollback edge)

rollback_patch (only if verify fails)
  ├── reads: newly_installed_kbs
  ├── uninstalls KBs via wusa.exe
  ├── posts: Jira rollback comment
  └── transitions: Jira ticket → Rollback Requested
```
