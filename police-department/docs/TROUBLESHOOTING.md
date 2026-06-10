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

After that, the bootstrap Application's `targetRevision: HEAD` will resolve correctly. (Note: as of commit `8591093` we pin `targetRevision` to the branch name explicitly, so this only matters for the first PR-merge cycle.)

---

## Lessons from the 2026-05-05 deploy session (read these before debugging anything inference-related)

### 11. Both InferenceServices stuck `Failed` with `quay.io/modh/vllm:rhoai-2.16: 404 Not Found`

**Symptom**: RHOAI dashboard shows both `llama-3-1-8b` and `pd-qwen25-vl-7b` as `Failed`. `oc describe inferenceservice` shows `RevisionFailed: Unable to fetch image "quay.io/modh/vllm:rhoai-2.16"`.

**Cause**: The image tag `rhoai-2.16` no longer exists on quay.io (tag was retired). RHOAI 2.25.x is the current operator generation; it expects a newer vLLM image tag.

**Fix**: query the live tag list and update **both** ServingRuntimes:
```bash
# 1. find the live tag (requires reachable quay.io)
curl -s 'https://quay.io/api/v1/repository/modh/vllm/tag/?onlyActiveTags=true' \
  | jq -r '.tags[].name' | grep -i rhoai | head -10

# 2. patch the demo ServingRuntime
oc -n pd-cctv patch servingruntime vllm-runtime --type=json \
  -p='[{"op":"replace","path":"/spec/containers/0/image","value":"quay.io/modh/vllm:<NEW_TAG>"}]'

# 3. ask the platform owner to update ai-demo-stack-aws/gitops/config/inference/vllm-servingruntime.yaml
#    (CLAUDE.md hard rule: we never edit that repo)

# 4. force re-revision on both InferenceServices
oc -n pd-cctv delete isvc pd-qwen25-vl-7b && oc apply -f manifests/inference/pd-qwen25-vl-7b.yaml
oc -n ai-demo  delete isvc llama-3-1-8b   # platform GitOps will recreate
```

### 12. SSO temporary credentials expire mid-pipeline

**Symptom**: A pipeline TaskRun that worked an hour ago suddenly returns `403` from S3, or the in-cluster fetcher Job's first pod hits an error during the upload phase.

**Cause**: `pd-s3-creds` was populated from `aws configure export-credentials --profile rhoai-demo` which yields **STS session tokens with a ~1-hour TTL**. The Secret value is read by pods at start; once the session expires, every long-lived consumer (S3 watcher CronJob, pull-clip, structure-and-write) starts failing.

**Fix**: rotate the Secret with a fresh session and restart any pods that need it now:
```bash
aws sso login --profile rhoai-demo
eval "$(aws configure export-credentials --profile rhoai-demo --format env)"
oc -n pd-cctv create secret generic pd-s3-creds \
  --from-literal=access_key_id="$AWS_ACCESS_KEY_ID" \
  --from-literal=secret_access_key="$AWS_SECRET_ACCESS_KEY" \
  --from-literal=session_token="$AWS_SESSION_TOKEN" \
  --from-literal=region=us-east-1 \
  --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
```

For long-running deployments, request a dedicated IAM user with static keys (and S3 read/write to `ai-demo-data-lake` only). IRSA on this cluster is configured for cluster operators only — no demo-bound role exists today.

### 13. EventListener pod CrashLoopBackOff with `failed to start informers`

**Symptom**: `el-pd-perception-*` pod crashes; logs show `clusterinterceptors.triggers.tekton.dev is forbidden: User "system:serviceaccount:pd-cctv:pd-eventlistener-sa" cannot list resource "clusterinterceptors" at the cluster scope`.

**Cause**: Tekton Triggers spins up informers for both namespace-scoped `Interceptors` AND cluster-scoped `ClusterInterceptors`. Without RBAC for the cluster-scoped resource, the controller fails to initialize.

**Fix** (already in commit `284cc11`): a `ClusterRole` + `ClusterRoleBinding` named `pd-eventlistener-clusterinterceptors` grants the read verbs on the cluster scope. `99_teardown.sh` deletes them on rollback. Verify with:
```bash
oc auth can-i list clusterinterceptors --as=system:serviceaccount:pd-cctv:pd-eventlistener-sa
# expect: yes
```

### 14. Tekton Task fails to apply: `field not declared in schema: .spec.steps[0].resources`

**Cause**: Tekton v1 (the API version we use) renamed step-level `resources` to `computeResources`. The original Task manifests still used the v1beta1 spelling.

**Fix** (already in commit `3d45d8d`): all Task step blocks use `computeResources`. If you copy a Task example from older docs, port the field name.

### 15. Persona pod boots, then dies on first `/hitl` request

**Symptom**: `pd-persona` container starts, Uvicorn logs `Application startup complete`, then later: `RuntimeError: Form data requires "python-multipart" to be installed`.

**Cause**: FastAPI's `Form(...)` dependency calls `ensure_multipart_is_installed()` lazily on the first request that touches it. Without `python-multipart` in `pyproject.toml`, the worker raises and exits.

**Fix** (already in commit `7b059ed`): `pyproject.toml` pins `python-multipart==0.0.12`.

### 16. New persona builds don't deploy — pod uses old sha

**Symptom**: rebuilt + retagged `pd-persona:0.1.0` shows the same sha in the pod as before.

**Cause**: Default `imagePullPolicy: IfNotPresent` + tag-based reference. The node has the previous image cached; tag updates pointing at a new sha don't trigger a re-pull.

**Fix** (already in commit `daf104f`): Deployment uses `imagePullPolicy: Always`. If you need the cheaper `IfNotPresent` semantics back, switch the manifest to a sha-pinned image reference.

### 17. Persona Route returns 503 from the OpenShift router

**Symptom**: `https://pd-persona-pd-personas.apps.<cluster>/healthz` returns the OCP "Application not available" HTML with status 503. Pod is Running, container is up.

**Cause**: `readinessProbe` was `/readyz`, which performs a deeper check (Aurora reach, Llama reach via Portkey). With Llama scaled to zero or unreachable, `/readyz` hangs past the probe `timeoutSeconds: 1` and Kubernetes marks the pod NotReady, so the Service excludes it and the Route 503s.

**Fix**: probe path changed to `/healthz` (lightweight ping). Restore the deeper check only after Llama is steady-state.

### 18. Persona build pulls fail with `quay.io: 503 Service Unavailable` from `registry.redhat.io` or `registry.access.redhat.com`

**Symptom**: `oc start-build` consistently fails the base-image pull with HTTP 503.

**Cause**: External Red Hat registries had a sustained outage during this session. They're public-but-transient.

**Fix** (already in commit `7cad6bf`): persona Dockerfile pulls the base image from the cluster-internal mirror at `image-registry.openshift-image-registry.svc:5000/openshift/python:3.11-ubi9` (already imported by RHOAI). No external dependency.

### 19. UBI Python multi-stage build silently drops some pip packages

**Symptom**: `pip install .` in the build stage's log shows `python-multipart-0.0.12` got installed; runtime stage's `pip show python-multipart` returns `not found`.

**Cause**: UBI s2i Python image makes `/opt/app-root/lib` a symlink to `lib64`. A multi-stage `COPY --from=build /opt/app-root/lib/python3.11/site-packages ...` follows the symlink while copying, but the destination ends up as a *directory* (not a symlink) with the dereferenced contents. Some wheels only land on one of the two paths and the destination loses them.

**Fix** (already in commit `daf104f`): single-stage Dockerfile. If you need the smaller image again, copy **both** `/opt/app-root/lib` and `/opt/app-root/lib64` from the build stage, or replace the build-stage symlink with a real directory before COPY.

### 20. `cat <<EOF | oc apply -f -` ships YAML with empty Secret values

**Symptom**: A pod created from inline YAML reports `endpoint=` and `password=` empty even though the corresponding Secret keys are populated.

**Cause**: Unquoted heredoc (`cat <<EOF`) lets the **outer shell** expand `$endpoint` etc. before writing the YAML. If the outer shell has those vars unset, the YAML stores empty strings. `envFrom` then injects empty strings.

**Fix**: use a quoted heredoc (`cat <<'EOF'`) when the YAML refers to in-pod env vars. Keep unquoted heredocs only when you intentionally interpolate from the outer shell.

### 21. ArgoCD self-heal keeps resetting `pd-s3-watcher-cursor` ConfigMap

**Symptom**: The S3 watcher detects the same clip on every cron run; `seen_keys` ConfigMap keeps reverting to empty.

**Cause**: The manifest declares `seen_keys: ""`. ArgoCD's `selfHeal: true` reconciles the cluster back to git on every drift detection, wiping the watcher's cursor.

**Workaround**: For a short demo, this is fine — duplicate POSTs are filtered at the EventListener level. For production, annotate the ConfigMap with `argocd.argoproj.io/sync-options: IgnoreExtraneous=true` and use a stable persistent store (e.g. a DB row) for the cursor.

### 22. Compute MachineSets fail with `no security group found`

**Symptom**: `compute-us-east-1a/b` MachineSets show `Phase: Failed`, KServe controller pod stuck `Pending` for hours.

**Cause**: The MachineSet references an SG by tag (`ai-demo-lt9wz-worker-sg`) that no longer exists in AWS — likely a partial Terraform destroy/recreate.

**Workaround used here**: scaled the working `worker-us-east-1c` MachineSet (which references SGs by ID, not tag) from 0 → 1 to give KServe controller schedule room. The compute MachineSets stay `Failed` until the platform owner fixes the SG.

**Permanent fix**: run `terraform apply` from `ai-demo-stack-aws/environments/demo/` to recreate the missing SG and reconcile the MachineSet template.
