# Troubleshooting

Top failure modes, in rough order of frequency.

## 1. PipelineRun stuck on `vlm-caption`

**Symptom**: PipelineRun shows `Running` for >5 min, `vlm-caption` task pod is `ContainerCreating`, the InferenceService pod for `pd-qwen25-vl-7b` exists but is `Pending`.

**Cause**: GPU is held by `llama-3-1-8b`. Knative hasn't scaled it down yet.

**Fix**:
```bash
oc -n ai-demo patch isvc llama-3-1-8b --type=merge \
  -p '{"spec":{"predictor":{"minReplicas":0}}}'
oc -n ai-demo delete pod -l serving.kserve.io/inferenceservice=llama-3-1-8b
```

The Qwen pod will move to `Running` within ~60 s.

## 2. `pd-aurora-init` Job fails with `extension "vector" is not available`

**Cause**: The platform's pgvector extension wasn't created yet (the platform's `pgvector-init` Job runs in wave 5; ours runs in wave 2 of the demo, but the demo's wave 2 depends on the platform extension already existing).

**Fix**: Confirm the platform Job ran:
```bash
oc -n ai-demo get job pgvector-init -o jsonpath='{.status.succeeded}'
# expect: 1
```
If 0, restart it:
```bash
oc -n openshift-gitops annotate app llama-inference \
  argocd.argoproj.io/refresh=hard --overwrite
```

## 3. S3 watcher not picking up new clips

**Symptom**: clip uploaded, no PipelineRun within 90 s.

**Diagnosis**:
```bash
oc -n pd-cctv get cronjob pd-s3-watcher
oc -n pd-cctv get jobs -l app.kubernetes.io/component=s3-watcher --sort-by=.metadata.creationTimestamp | tail -5
oc -n pd-cctv logs job/<latest-watcher-job>
```

Common causes:
- `pd-s3-creds` Secret missing or has wrong credentials → re-run `bootstrap/01_secrets.sh`
- The clip is already in the dedupe cursor (`oc -n pd-cctv get cm pd-s3-watcher-cursor -o yaml`) — happens if the same key was uploaded before
- The CronJob is suspended (`oc -n pd-cctv get cronjob pd-s3-watcher -o jsonpath='{.spec.suspend}'`)

## 4. Qwen2.5-VL model not loading (`storage uri` 404)

**Cause**: `bootstrap/02_fetch_models.sh` was skipped.

**Fix**:
```bash
bash bootstrap/02_fetch_models.sh
oc -n pd-cctv delete pod -l serving.kserve.io/inferenceservice=pd-qwen25-vl-7b
```

## 5. ArgoCD repo not in allowlist

**Symptom**: bootstrap Application shows `ComparisonError: repository not permitted in project default`.

**Fix**:
```bash
oc -n openshift-gitops apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: pd-company-demos-repo
  namespace: openshift-gitops
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: https://github.com/sankat447/company-demos
EOF
```

Then refresh:
```bash
oc -n openshift-gitops annotate app pd-bootstrap \
  argocd.argoproj.io/refresh=hard --overwrite
```

## 6. Persona endpoint returns 502

**Cause**: Aurora password mismatch (the platform rotated it without re-running our bootstrap).

**Fix**:
```bash
unset AURORA_HOST AURORA_PASSWORD
bash bootstrap/01_secrets.sh
oc -n pd-personas rollout restart deploy/pd-persona
```

## 7. HITL queue page is empty even though a chat just succeeded

**Cause**: Redis TTL expired (10 min) OR a different persona service replica popped the entry while you were watching.

**Fix**: trigger a fresh chat. The Deployment has `replicas: 1` by default to avoid stale-cache races during demos.

## 8. `kube_deployment_status_replicas_ready` is missing for `*-predictor-*`

**Symptom**: GPU mutex alert never fires even when both services are clearly running.

**Cause**: Either the metric label structure depends on the kube-state-metrics version, or the user-workload Prometheus instance (which evaluates this rule now that it lives in `pd-cctv`) does not have access to the `kube_*` metrics emitted in `openshift-monitoring`. Confirm by querying both Prometheus instances:

```bash
# Cluster Prometheus (always has kube-state-metrics)
oc -n openshift-monitoring exec deploy/prometheus-k8s -- promtool query instant \
  http://localhost:9090 'kube_deployment_status_replicas_ready{namespace=~"ai-demo|pd-cctv"}'

# User-workload Prometheus (where the rule is actually evaluated)
oc -n openshift-user-workload-monitoring exec sts/prometheus-user-workload -- promtool query instant \
  http://localhost:9090 'kube_deployment_status_replicas_ready{namespace=~"ai-demo|pd-cctv"}'
```

If the user-workload instance returns nothing, the rule expressions need to be rewritten against KServe-native metrics (e.g. `kserve_inferenceservice_*`) or moved back into `openshift-monitoring` (revert the namespace edit in `manifests/monitoring/pd-gpu-mutex-prometheusrule.yaml` and `argocd/apps/pd-monitoring.yaml`).

## 9. `oc apply` fails with `serverside apply: ... ServerSideApplyMustBeUsed`

**Cause**: First-apply conflict against an in-line manager. The bootstrap helper uses `--force-conflicts` for that reason.

**Fix**: re-run via the helper:
```bash
upsert_secret pd-aurora-credentials pd-cctv \
  endpoint=$AURORA_HOST password=$AURORA_PASSWORD \
  database=rhoai_demo username=rhoai_admin
```

## 10. `feature/police-department-v1` doesn't exist on the remote

**Cause**: The branch lives only locally until you push.

**Fix**:
```bash
git push -u origin feature/police-department-v1
```

After that, the bootstrap Application's `targetRevision: HEAD` will resolve correctly.
