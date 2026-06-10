# Platform URLs + Credentials

Reference card for the demo cluster. **Credentials live in the gitignored `police-department/scripts/.env.demo`** — placeholders below say `(see .env.demo)` for anything sensitive. This document is committed; the env file is not.

> The OpenShift router URL pattern is `<service>-<namespace>.apps.ai-demo.iisdemolab.click`. When the cluster is rebuilt with a new Terraform run, hostnames stay stable; only IPs / passwords / MachineSet prefixes change.

## Platform consoles

| Category | Product | URL | Login | Credential reference |
|---|---|---|---|---|
| Platform | **AWS SSO portal** | https://ssoins-7223d31666c87e49.portal.us-east-1.app.aws/ | SSO browser flow | `PD_AWS_PROFILE` in `.env.demo`; `aws sso login --profile $PD_AWS_PROFILE` |
| Infrastructure | **AWS Console — SystemAdministrator role** | https://d-9067169a9d.awsapps.com/start/#/console?account_id=406337554361&role_name=SystemAdministrator | SSO redirect | (browser flow) |
| Application | **Catalogue / app portal** | https://catalogue.iisdemolab.click/ | (n/a — public) | — |
| Platform | **OpenShift Console** | https://console-openshift-console.apps.ai-demo.iisdemolab.click/ | `kubeadmin` | `PD_OCP_PASSWORD` in `.env.demo` |
| Platform | **OpenShift GitOps / ArgoCD** | https://openshift-gitops-server-openshift-gitops.apps.ai-demo.iisdemolab.click/ | `admin` | `PD_ARGOCD_PASSWORD` in `.env.demo` |
| Platform | **RHOAI Dashboard** | https://rhods-dashboard-redhat-ods-applications.apps.ai-demo.iisdemolab.click/ | OCP OAuth (kubeadmin) | uses OCP login above |
| Platform | **Red Hat OpenShift Cluster Manager** | https://console.redhat.com/openshift/clusters/list | Red Hat SSO | (your RH account; no project-specific cred) |
| Platform | **MLflow** | https://mlflow-rhoai-mlflow.apps.ai-demo.iisdemolab.click/ | OAuth proxy | OCP login |
| Platform | **Portkey** | https://portkey-ai-demo.apps.ai-demo.iisdemolab.click/ | — | (no auth in demo) |
| Platform | **CloudBeaver / DB IDE** | https://cloudbeaver-rhoai-tools.apps.ai-demo.iisdemolab.click/ | First user becomes admin | first-time wizard — pick a username + password; remember them |
| Platform | **Keycloak / IAM SSO** | https://keycloak-rhoai-sso.apps.ai-demo.iisdemolab.click/ | `admin` | `PD_KEYCLOAK_PASSWORD` in `.env.demo` (placeholder if unknown) |
| Platform | **Grafana** | https://grafana-rhoai-monitoring.apps.ai-demo.iisdemolab.click/ | OAuth proxy | OCP login |
| Platform | **n8n** | https://n8n-ai-demo.apps.ai-demo.iisdemolab.click/ | first-time wizard | wizard — create on first visit |
| Platform | **Pipelines-as-Code controller** | https://pipelines-as-code-controller-openshift-pipelines.apps.ai-demo.iisdemolab.click/ | — | (Tekton internal; not user-facing) |
| Platform | **Microsoft Azure Portal** | http://portal.azure.com/ | Microsoft account | (your tenant credentials) |

## Infrastructure

| Category | Product | URL | Login | Credential reference |
|---|---|---|---|---|
| Infrastructure | **MinIO Console** | https://minio-console-rhoai-minio.apps.ai-demo.iisdemolab.click/ | `minio` / `minio123` (default) — verify with `oc -n rhoai-minio get secret minio` | `PD_MINIO_ROOT_PASSWORD` in `.env.demo` |
| Infrastructure | **HashiCorp Vault** | https://vault-vault.apps.ai-demo.iisdemolab.click/ | root token via `oc -n vault get secret vault-keys` | `PD_VAULT_TOKEN` in `.env.demo` |
| Infrastructure | **Istio Ingress Gateway** | https://istio-ingressgateway-istio-system.apps.ai-demo.iisdemolab.click/ | — | (mesh; not directly accessed) |
| Infrastructure | **Prometheus** | https://prometheus-k8s-openshift-monitoring.apps.ai-demo.iisdemolab.click/ | OAuth proxy | OCP login |
| Infrastructure | **Alertmanager** | https://alertmanager-main-openshift-monitoring.apps.ai-demo.iisdemolab.click/ | OAuth proxy | OCP login |
| Infrastructure | **AWS EC2 (tag: CostCenter=IIS-AI-AWS-DEMO)** | https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#Instances:tag:CostCenter=IIS-AI-AWS-DEMO | SSO | (browser flow) |
| Infrastructure | **AWS VPC** | https://us-east-1.console.aws.amazon.com/vpc/home?region=us-east-1#vpcs: | SSO | (browser flow) |
| Infrastructure | **AWS RDS** (Aurora pgvector) | https://us-east-1.console.aws.amazon.com/rds/home?region=us-east-1#databases: | SSO | (browser flow) — DB creds in `.env.demo` (autodiscovered from SSM `/ai-demo/aurora/*`) |

## Demo-specific applications

| Category | Product | URL | Login | Credential reference |
|---|---|---|---|---|
| Application | **Persona service** (chat UI + slash commands) | https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/ | — | (no auth — operator-facing only) |
| Application | **Qwen2.5-VL predictor / CCTV inference service** | https://pd-qwen25-vl-7b-predictor-pd-cctv.apps.ai-demo.iisdemolab.click/ | — | (KServe Knative route; called by vlm-caption task internally) |
| Application | **Open WebUI** | https://open-webui-ai-demo.apps.ai-demo.iisdemolab.click/ | first-time wizard | `PD_OPENWEBUI_ADMIN_PASSWORD` in `.env.demo` (placeholder if unknown) |
| Application | **LangChain Server API** | https://langchain-server-langchain.apps.ai-demo.iisdemolab.click/docs | — | (auth optional; check Swagger) |
| Application | **Jira Service Management** | http://atlassian.com/software/jira/service-management/free | Atlassian SSO | (your account) |

## Internal endpoints (cluster-only)

These are not exposed as Routes; reachable from inside the cluster via the service DNS.

| Service | Cluster DNS | Notes |
|---|---|---|
| Aurora pgvector | `ai-demo-db.cluster-cidweltunfq6.us-east-1.rds.amazonaws.com:5432` | Endpoint + password autodiscovered from AWS SSM `/ai-demo/aurora/{endpoint,master-password}` |
| Portkey (Llama gateway) | `http://portkey.ai-demo.svc.cluster.local:8787/v1/chat/completions` | Used by persona service in `pd-llm-mode=local` |
| Tekton EventListener | `http://el-pd-perception.pd-cctv.svc.cluster.local:8080/` | Persona upload triggers a PipelineRun here |
| MLflow tracking | `http://mlflow.rhoai-mlflow.svc:5000` | structure-and-write task pushes per-clip bundle |
| Redis | `redis.ai-demo.svc:6379` | HITL queue + chat-history caching |
| MongoDB | `mongodb.ai-demo.svc:27017` | Not used by police-department demo |

## How to retrieve credentials on demand

```bash
# kubeadmin password (from the OCP installer auth dir)
cat /Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeadmin-password

# ArgoCD initial admin password
oc -n openshift-gitops get secret openshift-gitops-cluster -o jsonpath='{.data.admin\.password}' | base64 -d

# Aurora master password (SSM)
aws ssm get-parameter --region us-east-1 --name /ai-demo/aurora/master-password --with-decryption --query 'Parameter.Value' --output text

# Aurora endpoint (SSM)
aws ssm get-parameter --region us-east-1 --name /ai-demo/aurora/endpoint --query 'Parameter.Value' --output text

# MinIO root credentials
oc -n rhoai-minio get secret minio -o jsonpath='{.data}'  # base64-decode each field

# Vault root token (one-time at init; saved by the operator)
oc -n vault get secret vault-keys -o jsonpath='{.data.root_token}' | base64 -d
```

## Operator credentials in `.env.demo`

The gitignored `police-department/scripts/.env.demo` carries the *runtime* secrets used by the demo's own pods + scripts. Things UI-only (kubeadmin, Vault root, etc.) are also kept there as a convenience copy for the operator to paste into browser logins. The committed `.env.demo.example` shows the full schema; populate it once when you provision a fresh cluster.
