# Police-Department demo · provision & destroy scripts

Single-button bring-up + teardown on top of an already-provisioned `ai-demo-stack-aws` OpenShift cluster.

## Files in this directory

| File | Purpose | Committed? |
|---|---|---|
| `provision_and_build_police_department_demo.sh` | Single-button bring-up (~15 min) | ✓ |
| `destroy_police_department_demo.sh` | Tear down all demo artefacts | ✓ |
| `.env.demo.example` | Template for credentials & config | ✓ |
| `.env.demo` | Your actual credentials & config | **NO** (gitignored) |

## First-time setup

1. **Provision the platform first.** This demo assumes `ai-demo-stack-aws` Terraform has already produced the OpenShift cluster, S3 data lake, and Aurora pgvector instance.

2. **Copy the env template and fill it in:**
   ```bash
   cd police-department/scripts
   cp .env.demo.example .env.demo
   chmod 600 .env.demo            # restrict to your user
   $EDITOR .env.demo              # supply real values
   ```

3. **Required keys** (the script fails without them):
   - `PD_KUBECONFIG` — path to the cluster's `auth/kubeconfig` (Terraform output)
   - `PD_AWS_PROFILE` — your SSO profile name (script will prompt `aws sso login` if expired)
   - `PD_AWS_REGION` — typically `us-east-1`
   - `PD_ANTHROPIC_API_KEY` — get from https://console.anthropic.com/
   - `PD_BUCKET` / `PD_NS_CCTV` / `PD_NS_PERSONAS` / `PD_MACHINESET_PREFIX` — match your platform deployment

4. **Optional keys** (autodiscovered or skipped if blank):
   - `PD_AURORA_HOST` / `PD_AURORA_PASSWORD` — copied from `ai-demo/aurora-credentials` if blank
   - `PD_HF_TOKEN` — only needed on the very first bring-up to stage Qwen-VL into S3
   - `PD_KSERVE_S3_AKID` / `PD_KSERVE_S3_SECRET` — long-lived keys for the model storage-init; if blank, the script reuses the runtime IAM user
   - `PD_PORTKEY_API_KEY` — only if you have a Portkey instance configured

## Bring up the demo

```bash
./provision_and_build_police_department_demo.sh
```

The script is idempotent — safe to re-run if it fails partway. It runs through 17 steps:

1. Load `.env.demo`.
2. Verify cluster reachability + admin identity.
3. Provision (or reuse) the long-lived IAM user `pd-demo-s3-rw` for S3 read/write to police-department prefixes. This **replaces the 1-hour SSO STS pattern** that broke demos hourly.
4. Mirror Anthropic / Aurora / Portkey / KServe-S3 Secrets into both `pd-cctv` and `pd-personas`, with `argocd.argoproj.io/sync-options=Prune=false` so ArgoCD doesn't blank them.
5. Apply `pd-llm-mode` and `pd-vlm-mode` ConfigMaps with `Prune=false` (ingest defaults to `local` @ 640 px — Lesson 10: 1280 px busts vLLM's 8192 ctx).
6. Apply the ArgoCD app-of-apps (delegates to `bootstrap/03_apply_argocd.sh`).
7. Stage Qwen2.5-VL-7B model into S3 if missing (delegates to `bootstrap/02_fetch_models.sh`).
8. Scale all 3 worker MachineSets to 2 replicas (1/AZ is too tight to absorb pod restarts).
9. Scale GPU MachineSet to 1 (g5.xlarge / A10G).
10. Wait for time-sliced GPU `allocatable=4` and worker `readyReplicas=2`.
11. Detect + drain "bad" worker nodes (cordoned ones — kubelet sick or chronically loaded).
12. Broad webhook/operator health sweep — restart any pod with `restarts > 5` in: `rhods-operator`, `odh-model-controller`, `rhods-dashboard`, knative-serving controllers (×6), `gpu-operator`. These crashloop on overloaded nodes and break admission webhooks; sweep is the canonical fix.
13. GPU-mutex preflight (or skip if predictor already Ready).
14. Apply `InferenceService` + `Pipeline` + `TriggerTemplate` + `TriggerBinding` (covers manifest drift).
15. Wait for predictor 3/3 Ready (~5–8 min cold-start).
16. Build + tag (`:latest → :0.2.0`) + roll the persona image.
17. Smoke-test the demo URL.

### Flags

```bash
./provision_and_build_police_department_demo.sh --rotate-keys   # force fresh IAM access key
./provision_and_build_police_department_demo.sh --skip-build    # skip persona image build
./provision_and_build_police_department_demo.sh --dry-run       # print plan only
./provision_and_build_police_department_demo.sh --help
```

## Tear down when finished

```bash
./destroy_police_department_demo.sh           # soft teardown (default)
./destroy_police_department_demo.sh --hard    # also remove IAM user + ArgoCD apps
./destroy_police_department_demo.sh --dry-run
```

**Soft teardown** (default) wipes data + scales compute back to baseline:
- Aurora rows truncated (sentinel preserved)
- S3 prefixes empty (`_sentinel.mp4` preserved)
- EFS workspace clip dirs purged (`.cache` preserved — keeps BGE / easyOCR / yolov8n-face warm)
- All PipelineRuns / TaskRuns / InferenceService / Knative residue deleted
- GPU MachineSet scaled to 0
- Worker MachineSets scaled back to 1 per AZ

**Hard teardown** additionally:
- Deletes `pd-anthropic-key`, `pd-aurora-credentials`, `pd-portkey-key`, `pd-s3-creds`, `pd-kserve-s3-creds`
- Deletes the `pd-demo-s3-rw` IAM user and its bucket policy
- Deletes the `pd-bootstrap` ArgoCD Application (cascades to all 7 child apps)
- Next bring-up needs `--rotate-keys` (handled automatically) + a full ArgoCD sync (~15 min added)

Use **soft** between iterations on the same demo cycle; **hard** when fully decommissioning.

## Cost while running

| State | Hourly cost (rough, AWS list) |
|---|---|
| Demo running (1 GPU + 6 m5.xlarge workers + masters + Aurora) | ~$3–4/hr |
| After soft teardown (3 m5.xlarge workers + masters + Aurora) | ~$0.50/hr |
| After hard teardown | same — workers + masters are platform, can't go below |

To kill the platform entirely, run the `ai-demo-stack-aws` Terraform `destroy`.

## Known limits + escape hatches

The runbook in `../docs/LESSONS_LEARNED.md` is the long-form story behind every step in these scripts. If anything in the script fails, that's where to look for the diagnostic + remediation that worked. Add new findings there so future-you doesn't relearn them.

The following are NOT handled by the script (intentionally):
- Provisioning the cluster itself — that's `ai-demo-stack-aws` Terraform's job
- Aurora schema migration — handled by the `pd-aurora-schema` ArgoCD app's init Job
- Persona code changes — those happen via `git push` + `oc start-build` in your dev loop, not via these scripts
- Ingress / DNS / TLS — managed by OpenShift's default Router

## Troubleshooting

- **"oc whoami failed"** — your kubeconfig is stale. Refresh from the platform Terraform output.
- **"AWS SSO session expired"** — script will run `aws sso login` automatically; complete the browser flow.
- **"GPU allocatable=4 timeout"** — GPU operator hasn't finished installing drivers. Check `oc -n gpu-operator-resources get pods` and look for crashlooping pods (the script's step 12 sweep should fix this).
- **"predictor cold-start timeout"** — vLLM took >30 min. Likely cause: model not staged in S3 (run step 7 manually with `bootstrap/02_fetch_models.sh`), or KServe S3 creds missing/wrong.
- **"webhook timeout" on `oc apply -f pd-qwen25-vl-7b.yaml"** — admission webhook (rhods-operator or odh-model-controller) crashlooping. Re-run the script; step 12 will fix it.
