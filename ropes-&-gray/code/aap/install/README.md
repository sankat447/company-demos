# AAP 2.6 Installation Guide

## What you are installing

AAP 2.6 all-in-one on a single RHEL 9 EC2 (m5.xlarge). This node runs:

- **Automation Controller** — job templates, workflow engine, RBAC, audit log
- **EDA Controller** — Event-Driven Ansible; receives Jira webhooks and triggers workflows
- **Private Automation Hub** — stores the execution environment image and collections

## Prerequisites

| Requirement | Detail |
|---|---|
| Red Hat account | free at access.redhat.com |
| AAP subscription | 60-day trial at redhat.com/ansible/trial — no credit card |
| AAP installer bundle | Downloaded from access.redhat.com/downloads after subscription |
| AAP manifest | Generated from access.redhat.com/management/subscription_allocations |
| EC2 running | Terraform deploy.sh completed successfully |

## Step 1 – Get an AAP trial subscription

1. Go to: https://www.redhat.com/en/technologies/management/ansible/trial
2. Click "Start your free trial"
3. Fill in company details (use your company name)
4. Confirm email
5. You now have a 60-day AAP subscription in access.redhat.com

## Step 2 – Download the AAP 2.6 installer bundle

1. Log in to: https://access.redhat.com/downloads
2. Search for "Ansible Automation Platform"
3. Select version **2.6**
4. Download: **Ansible Automation Platform 2.6 Setup Bundle** (the bundle includes all packages offline)
   - File: `ansible-automation-platform-setup-bundle-2.6-1-x86_64.tar.gz`
   - Size: ~2 GB
5. SCP it to the EC2:
   ```bash
   scp -i terraform/aap_ec2_key.pem \
     ansible-automation-platform-setup-bundle-2.6-1-x86_64.tar.gz \
     ec2-user@<AAP_EIP>:/opt/aap-install/
   ```

## Step 3 – Generate and upload the manifest

1. Go to: https://access.redhat.com/management/subscription_allocations
2. Click "New Subscription Allocation"
3. Name: `patch-demo`, Type: `Satellite 6.8+`
4. Add entitlements: Ansible Automation Platform (qty: 1)
5. Click "Export Manifest" → downloads `manifest.zip`
6. SCP to EC2:
   ```bash
   scp -i terraform/aap_ec2_key.pem \
     manifest.zip \
     ec2-user@<AAP_EIP>:/opt/aap-install/
   ```

## Step 4 – SSH in and run the installer

```bash
# Get the EIP from Terraform
export AAP_IP=$(cd iac/terraform && terraform output -raw aap_public_ip)

# SSH in
ssh -i iac/terraform/aap_ec2_key.pem ec2-user@${AAP_IP}

# On the EC2 – switch to root
sudo -i

# Run the staged installer script
bash /opt/aap-install/aap_install.sh
```

Installation takes **25–45 minutes**. Watch `/var/log/aap-install.log` for progress.

## Step 5 – Post-install verification

```bash
# Check services
systemctl status automation-controller
systemctl status automation-eda-server
systemctl status pulp-api   # Automation Hub

# Test Controller API
curl -sk https://localhost/api/v2/ping/ | python3 -m json.tool

# Test EDA API
curl -sk https://localhost:8443/api/eda/v1/ping/ | python3 -m json.tool
```

Expected output for Controller ping:
```json
{ "ha": false, "version": "4.5.x", "active_node": "localhost", "install_uuid": "..." }
```

## Step 6 – Activate AAP with manifest

1. Open browser: `https://<AAP_EIP>`
2. Log in: admin / `<your aap_admin_password>`
3. On first login: upload manifest → browse to `/opt/aap-install/manifest.zip`
4. Click Analyze → Submit

## Step 7 – Configure objects (see aap/README.md)

After activation, configure: credentials, project, inventory, job templates, workflow, EDA rulebook.
See `aap/README.md` for the complete post-install configuration guide.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `subscription-manager register` fails | Check RHN username/password; try `--force` flag |
| Installer fails at `Gathering Facts` | Ensure SELinux is permissive: `setenforce 0` temporarily |
| EDA service not starting | Check: `journalctl -u automation-eda-server -n 50` |
| Port 8443 not reachable | Confirm AWS SG allows inbound 8443 from Atlassian IPs |
| `manifest.zip` error | Re-download manifest; check it isn't corrupted (zip -T manifest.zip) |
