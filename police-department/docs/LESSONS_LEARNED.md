# Lessons Learned + Tomorrow's Bring-up Runbook

Written 2026-05-07 after a multi-day demo iteration cycle. Distils the operational pain points hit during real demo runs and the remediation that worked. **Read this before scaling up tomorrow** — every item here was paid for with downtime.

> ### Overnight state (2026-05-07 → 2026-05-08)
> Scaled to **bare minimum** to save cost — the cluster does no work until the next demo. Tomorrow's bring-up has to scale all this back up first.
>
> - **3 worker nodes baseline** (us-east-1a:1, us-east-1b:1, us-east-1c:1) — the OCP defaults
> - **Both bad nodes still cordoned**: `ip-10-0-36-27` (sick kubelet) and `ip-10-0-7-84` (chronic over-loader). With them cordoned and only 1 worker per AZ, the cluster has very tight capacity until step 1 of the runbook scales workers back to 2 per AZ.
> - **GPU MachineSet at 0**
> - **Aurora + S3 + EFS workspace clean** (only sentinel clip)
> - **Persona pod (build 33, sha `d19a5dc`) already running** — Quick persona, download button, slash commands, RHOAI metrics-friendly runtime tags, corrected `/help` rendering, programmatically-bound download button click handler
>
> The pre-flight below is the FULL bring-up. Plan ~15-20 min from `oc whoami` to demo-ready.

---

## TL;DR — Tomorrow's Pre-flight (in this exact order)

```bash
export KUBECONFIG=/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig
oc whoami    # must return system:admin

# 1. Verify worker baseline is still 2 per AZ (intended overnight state).
#    If any AZ is at 1, scale it back to 2 — we learnt today that 1
#    schedulable worker per AZ is not enough to absorb pod restarts.
for az in 1a 1b 1c; do
  oc -n openshift-machine-api annotate machineset ai-demo-lt9wz-worker-us-east-$az \
     pd-cctv.iisl.com/scaled-up-by=demo-session --overwrite
  oc -n openshift-machine-api scale machineset ai-demo-lt9wz-worker-us-east-$az --replicas=2
done

# 2. GPU.
oc -n openshift-machine-api scale machineset ai-demo-lt9wz-gpu-demo-us-east-1a --replicas=1

# 3. Wait for the GPU node + the time-sliced device-plugin to publish allocatable=4
#    (NOT just >=1 — 1 means time-slicing hasn't applied yet).
until [ "$(oc get node -l nvidia.com/gpu.present=true \
            -o jsonpath='{.items[0].status.allocatable.nvidia\.com/gpu}' 2>/dev/null)" = "4" ]; do sleep 15; done

# 4. Wait for all worker MachineSets to be 2/2.
until [ "$(oc -n openshift-machine-api get machineset \
            -o jsonpath='{range .items[?(@.metadata.name=~"^ai-demo-lt9wz-worker-")]}{.status.readyReplicas}{"\n"}{end}' \
            | grep -cv ^2$)" = "0" ]; do sleep 15; done

# 5. CRITICAL: drain BOTH unhealthy nodes so their pods reschedule to healthy
#    ones BEFORE you do any pipeline work. Otherwise admission webhooks and
#    operators that keep landing there will crashloop, and every task pod
#    will fail to admit. (See Lesson #1 + #16.) Both have been cordoned
#    overnight; this just evicts any pod still on them.
for n in ip-10-0-36-27.ec2.internal ip-10-0-7-84.ec2.internal; do
  oc adm drain "$n" --delete-emptydir-data --ignore-daemonsets --force \
    --grace-period=30 --timeout=180s 2>&1 | tail -3
done
# Some non-DS pods (StatefulSets, ingress) may stick — force delete them:
for n in ip-10-0-36-27.ec2.internal ip-10-0-7-84.ec2.internal; do
  for p in $(oc get pods -A --field-selector=spec.nodeName=$n -o json \
             | jq -r '.items[] | select(.metadata.ownerReferences[]?.kind != "DaemonSet")
                                | "\(.metadata.namespace) \(.metadata.name)"'); do
    ns=$(echo $p | awk '{print $1}'); pod=$(echo $p | awk '{print $2}')
    [ -n "$pod" ] && oc -n "$ns" delete pod "$pod" --grace-period=0 --force --wait=false
  done
done

# 6. Verify Tekton webhooks are healthy on healthy nodes.
oc -n openshift-pipelines get pods -o wide | grep webhook | grep -v 36-27
# All must be Running on a node OTHER than ip-10-0-36-27.

# 6b. THE BROAD WEBHOOK / OPERATOR HEALTH SWEEP. Today's bring-up surfaced
#     four separate pods that crashloop on the always-loaded ip-10-0-7-84
#     and break demos until restarted. Doing it as a generic loop because
#     the list grows.
#       - redhat-ods-operator (kserve-kueuelabels validator)
#       - odh-model-controller (KServe pod mutating webhook)
#       - knative-serving controllers (autoscaler, autoscaler-hpa, controller, net-istio-controller, net-istio-webhook, webhook)
#       - gpu-operator (was at 218 restarts on bring-up before we kicked it)
#     Anything with restarts >5 OR not Running gets force-deleted so it lands fresh.
for nslbl in "redhat-ods-operator name=rhods-operator" \
             "redhat-ods-applications control-plane=odh-model-controller" \
             "redhat-ods-applications deployment=rhods-dashboard" \
             "knative-serving app=autoscaler" \
             "knative-serving app=autoscaler-hpa" \
             "knative-serving app=controller" \
             "knative-serving app=net-istio-controller" \
             "knative-serving app=net-istio-webhook" \
             "knative-serving app=webhook" \
             "gpu-operator-resources app=gpu-operator"; do
  ns=$(echo $nslbl | awk '{print $1}'); lbl=$(echo $nslbl | awk '{print $2}')
  oc -n "$ns" get pods -l "$lbl" -o json 2>/dev/null | jq -r '.items[] |
      select((.metadata.ownerReferences|any(.kind=="ReplicaSet")) and
             (.status.containerStatuses[]? | (.restartCount > 5 or .ready == false))) |
      .metadata.name' | while read p; do
    [ -n "$p" ] && oc -n "$ns" delete pod "$p" --grace-period=0 --force --wait=false 2>/dev/null
  done
done
# Wait ~60s for replacements; the webhook endpoints in particular can be
# rough until they land Running.
sleep 60

# 7. GPU-mutex pre-flight: no pod must hold nvidia.com/gpu before we apply the IS.
until [ "$(oc get pods -A -o json | jq '[.items[] | select(.spec.containers[]?.resources.requests."nvidia.com/gpu"? == "1")] | length')" = "0" ]; do
  echo "GPU still held; waiting..."; sleep 10
done

# 8. Apply the InferenceService AND verify the pipeline still has all its
#    Tekton resources. Today we found the Pipeline definition itself was
#    missing from pd-cctv even though tasks were there — re-applying covers
#    that case + any other manifest drift since the last sync.
oc apply -f police-department/manifests/inference/pd-qwen25-vl-7b.yaml
oc apply -f police-department/manifests/pipeline/pd-pipeline.yaml
oc apply -f police-department/manifests/pipeline/pd-triggertemplate.yaml
oc apply -f police-department/manifests/pipeline/pd-triggerbinding.yaml
until oc -n pd-cctv get pods -l serving.kserve.io/inferenceservice=pd-qwen25-vl-7b \
       -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="kserve-container")].ready}' \
       | grep -q true; do sleep 15; done

# 9. Verify pd-s3-creds is the LONG-LIVED IAM user (NOT STS). access_key_id
#    must start with AKIA*; if it starts with ASIA* it's STS and will expire.
oc -n pd-personas get secret pd-s3-creds -o jsonpath='{.data.access_key_id}' | base64 -d
# Expect: AKIAV5G43A6435N5VBMJ  (or whatever rotated to)

# 10. pd-llm-mode (chat) and pd-vlm-mode (ingest) — both should NOT be in git
#    source-of-truth, both should have argocd...sync-options=Prune=false.
oc -n pd-personas get cm pd-llm-mode -o jsonpath='{.data.mode}'   # claude
oc -n pd-cctv     get cm pd-vlm-mode -o jsonpath='{.data.mode}'   # local OR claude-multimodal

# 11. Persona pod should already be on the latest :0.2.0 tag.
oc -n pd-personas get is pd-persona -o jsonpath='{range .status.tags[?(@.tag=="0.2.0")]}{.tag}: {.items[0].image}{"\n"}{end}'
# Should match the latest pd-persona-N build SHA.
```

After all 11 steps pass, the demo URL is healthy:
- https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click

If any step hangs, jump to the matching Lesson section below.

---

## Lessons (with remediation)

### Lesson 1 — A cordoned node will still poison you if it hosts admission webhooks
**What happened.** `ip-10-0-36-27` developed memory pressure (96-98%, kubelet metrics went `<unknown>`). We cordoned it to stop new scheduling, but it kept running:
- `tekton-operator-proxy-webhook` — every task-pod admission call routed to that pod and timed out at 10s. Result: vlm-caption / yolo / faces / whisper all failed with `PodCreationFailed: failed calling webhook ... context deadline exceeded`.
- `router-default` (OCP ingress) — Routes were 503'ing intermittently.
- knative-serving controllers (`autoscaler`, `controller`, `net-istio-*`) — crashlooping.
- `istio-ingressgateway`, `mongodb-0`, `portkey`, `gitops-plugin` — all on the sick node.

**Why cordon wasn't enough.** Cordon prevents *new* scheduling but does nothing for pods already there. Webhooks/controllers need active execution; if the node's kubelet can't run them they wedge.

**Remediation.**
```bash
oc adm drain ip-10-0-36-27.ec2.internal --delete-emptydir-data --ignore-daemonsets --force \
  --grace-period=30 --timeout=180s
# Then for non-DaemonSet stragglers (StatefulSets, ingress with affinity):
oc get pods -A --field-selector=spec.nodeName=ip-10-0-36-27.ec2.internal -o json \
  | jq -r '.items[] | select(.metadata.ownerReferences[]?.kind != "DaemonSet")
                    | "\(.metadata.namespace) \(.metadata.name)"' \
  | while read ns pod; do oc -n "$ns" delete pod "$pod" --grace-period=0 --force; done
```

**Tomorrow.** Drain the bad node FIRST, before any workload work. Step 5 of the pre-flight.

---

### Lesson 2 — SSO STS credentials expire every 1 hour, not 12
**What happened.** Pipeline failures every ~hour, all looking like `boto3.exceptions.S3UploadFailedError: ExpiredToken on CreateMultipartUpload`. Every demo run we'd waste 5 minutes refreshing creds.

**Why.** `aws configure export-credentials --profile rhoai-demo --format env` returns role-assumed STS, controlled by the role's `MaxSessionDuration` (default 1h). The 12h figure people remember is the **SSO browser session**, not the credential lifetime.

**Remediation (already applied).** Provisioned a long-lived IAM user `pd-demo-s3-rw` with bucket-scoped policy and stamped its access key into `pd-s3-creds`:
```bash
aws iam list-access-keys --user-name pd-demo-s3-rw   # check current AKID
# Rotation if needed:
aws iam delete-access-key --user-name pd-demo-s3-rw --access-key-id AKIA-old
NEW=$(aws iam create-access-key --user-name pd-demo-s3-rw \
        --query '[AccessKey.AccessKeyId,AccessKey.SecretAccessKey]' --output text)
AKID=$(echo "$NEW" | awk '{print $1}'); SECRET=$(echo "$NEW" | awk '{print $2}')
for ns in pd-cctv pd-personas; do
  oc -n "$ns" create secret generic pd-s3-creds \
    --from-literal=access_key_id="$AKID" --from-literal=secret_access_key="$SECRET" \
    --from-literal=session_token="" --from-literal=region=us-east-1 \
    --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
  oc -n "$ns" annotate secret pd-s3-creds "argocd.argoproj.io/sync-options=Prune=false" --overwrite
done
oc -n pd-personas rollout restart deploy/pd-persona
```

**Tomorrow.** Step 9 of the pre-flight just verifies the AKID prefix is `AKIA*` (long-lived) not `ASIA*` (STS).

---

### Lesson 3 — ArgoCD ServerSideApply + selfHeal=true blanks Secrets and ConfigMaps
**What happened.** `pd-aurora-credentials` Secret kept being reverted to git's empty placeholder, even though `ignoreDifferences /data` was declared on the pd-personas Application. Same with `pd-llm-mode` ConfigMap reverting from `claude` back to `mock` mid-demo.

**Why.** `ServerSideApply` syncOption + `automated.selfHeal=true` causes ArgoCD to re-apply the spec on every reconcile, ignoring `ignoreDifferences` on the *initial sync of each generation*. Generation bumps happen any time the parent Application spec changes (rare but does happen during dev).

**Remediation (already applied).**
- Removed `manifests/personas/pd-persona-secrets-stub.yaml` from git
- Removed `manifests/personas/pd-llm-mode-configmap.yaml` from git
- Annotated the live cluster resources with `argocd.argoproj.io/sync-options=Prune=false`
- bootstrap/lib/common.sh's `upsert_secret()` now applies that annotation automatically
- Aurora creds are now bootstrap-managed (out-of-band), same pattern as `pd-anthropic-key`

**Tomorrow.** Step 10 verifies the `Prune=false` annotation is in place. If a sync nuked them anyway:
```bash
# Re-stamp Aurora from pd-cctv copy (which is bootstrap-managed):
PG_ENDPOINT=$(oc -n pd-cctv get secret pd-aurora-credentials -o jsonpath='{.data.endpoint}' | base64 -d)
PG_PASSWORD=$(oc -n pd-cctv get secret pd-aurora-credentials -o jsonpath='{.data.password}' | base64 -d)
oc -n pd-personas create secret generic pd-aurora-credentials \
  --from-literal=endpoint="$PG_ENDPOINT" --from-literal=password="$PG_PASSWORD" \
  --from-literal=username=rhoai_admin --from-literal=database=rhoai_demo \
  --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
oc -n pd-personas annotate secret pd-aurora-credentials \
  "argocd.argoproj.io/sync-options=Prune=false" --overwrite
oc -n pd-personas rollout restart deploy/pd-persona
```

---

### Lesson 4 — BuildConfig output tag != Deployment image tag
**What happened.** New persona builds appeared "deployed" but the running pod kept serving stale UI. Five hours of confusion before realising every `oc rollout restart` was pulling the same `:0.2.0` digest because new builds went to `:latest`.

**Why.** `bc/pd-persona` outputs to `pd-persona:latest`. `deploy/pd-persona` references `pd-persona:0.2.0`. The two ImageStream tags are independent.

**Remediation (manual every build).**
```bash
oc -n pd-personas tag pd-persona:latest pd-persona:0.2.0
oc -n pd-personas rollout restart deploy/pd-persona
```

**Tomorrow.** Either keep doing the manual retag, or commit one of these durable fixes:
1. Change `deploy/pd-persona` template to `image: ...:latest` + `imagePullPolicy: Always`
2. Change `bc/pd-persona` output to `:0.2.0`

---

### Lesson 5 — Knative progressDeadlineSeconds defaults to 600s; vLLM cold-start can exceed it
**What happened.** Fresh GPU node provisioning + 6 GB image pull + 14 GB model storage-init + occasional CUDA-OOM-and-back-off-restart routinely took >10 min. Knative would mark the revision `Failed` mid-boot, even though vLLM eventually loaded fine.

**Remediation (already in git).**
```yaml
# manifests/inference/pd-qwen25-vl-7b.yaml metadata.annotations:
serving.knative.dev/progress-deadline: "30m"
```

**Tomorrow.** Step 8 just waits for `kserve-container.ready=true`; if it stays Pending past 30 min, check the storage-init logs for credential issues (likely `pd-kserve-s3-creds` rotated).

---

### Lesson 6 — GPU-mutex hygiene: terminating pods hold VRAM
**What happened.** New vLLM init crashed with `Free memory on device (4.89/22 GiB)` because the OLD predictor was still terminating and hadn't released the GPU. Knative would then mark the new revision Failed, even though it would have worked seconds later.

**Remediation (already in git).** Two layers:
- `terminationGracePeriodSeconds: 15` on the predictor — Istio sidecar drain bounded so old pods don't sit on VRAM for 30+s.
- Pre-flight check before `oc apply -f pd-qwen25-vl-7b.yaml`: zero pods with `nvidia.com/gpu: "1"` cluster-wide. If any are still terminating, wait.
- Janitor CronJob `pd-knative-revision-janitor` (in `manifests/inference/`) sweeps Knative orphans every 5 min.

**Tomorrow.** Pre-flight steps 7 & 8.

---

### Lesson 7 — Time-slicing race on fresh GPU node
**What happened.** Node went `Ready` with `nvidia.com/gpu: 1`. Pipeline tasks scheduled fast, all wanted 1 GPU each, scheduler reported `Insufficient nvidia.com/gpu` because the time-slicing config hadn't republished allocatable=4 yet.

**Remediation.** Wait for `allocatable=4` not `>=1`:
```bash
until [ "$(oc get node -l nvidia.com/gpu.present=true \
            -o jsonpath='{.items[0].status.allocatable.nvidia\.com/gpu}')" = "4" ]; do sleep 15; done
```

The time-slicing config (cm `time-slicing-config-all` in `gpu-operator-resources` ns + ClusterPolicy `gpu-cluster-policy.spec.devicePlugin.config`) is durable across MachineSet scale-down/up — but the device-plugin daemonset takes ~60s post-NodeReady to apply.

**Tomorrow.** Step 3 of the pre-flight.

---

### Lesson 8 — EFS workspace persists frames across PipelineRuns
**What happened.** vlm-caption ran `ffmpeg -frames:v 4` on a workspace where a previous run had `frames=8`. The four old frames remained, glob picked up 8, vLLM rejected with "At most 4 image(s) may be provided". Pipeline failed.

**Remediation (already in git).** vlm-caption first step now does `rm -rf frames && mkdir -p frames` before extraction.

---

### Lesson 9 — Forensic-prompt + UI must agree on timestamp format
**What happened.** Claude saw the camera-overlay wall-clock burned into the video (`10:40:40 AM`) and wove that into prose. The UI's linkifyTimestamps regex matched it, computed `seekTo(38440)`, video clamped — clicks looked broken.

**Remediation (already in git).**
- Tightened JS regex to ONLY linkify `Ns` / `N.Ns` decimals and `clip:<id>:hh:mm:ss` anchors
- `seekTo` now clamps to `video.duration` and toasts on overshoot
- Forensic prompt explicitly demands clip-relative seconds with `s` suffix as anchors

---

### Lesson 10 — Four VLM knobs must move in lockstep (and the resolution trap)
| Knob | Where | Constraint |
|---|---|---|
| `frames` | `pd-vlm-mode` ConfigMap | local: ≤4. claude-multimodal: ≤30 (Anthropic 100-image cap with margin) |
| `resolution` | `pd-vlm-mode` ConfigMap | local: **640 max** (1280 busts max-model-len). claude-multimodal: 1280 OK |
| `--limit-mm-per-prompt={"image":N}` | `pd-vllm-vlm-runtime.yaml` | Must be ≥ frames count for local mode |
| `--max-model-len` | same | Must fit `frames × visual_tokens_per_image + prompt + max_tokens` |

**Visual tokens per image scales with resolution.** Qwen2.5-VL emits ~1130 visual tokens/image at 640 px, ~1900 at 1280 px. So:
- 4 frames @ 640 px → 4520 visual + 500 text + 2048 completion = ~7068 tokens — fits 8192 ✓
- 4 frames @ 1280 px → 7600 visual + 500 + 2048 = ~10148 — **busts 8192** (this is the "decoder prompt length 9240" error)
- 16 frames @ 1280 px → 30400 visual + ... — fine for claude-multimodal (200k ctx) but well over local

**Default**: `pd-vlm-mode` ships with `resolution=640` for local-mode safety. The UI's "Deep analysis" checkbox flips mode to claude-multimodal *and* the operator should bump resolution to 1280 (via the dropdown / `oc patch cm`). The ConfigMap has a **single resolution field used by both modes** — if you want them independent, branch in the Tekton task.

---

### Lesson 11 — JSON code-fence wrapping in VLM responses
**What happened.** Claude wraps its JSON in ` ```json ... ``` `. Both `vlm-caption` (returning to OpenAI shape) and `structure-and-write` (parsing into Aurora) failed to strip — inner narrative landed in `narrations.prose` as a JSON-wrapped string, persona /chat had nothing intelligible to read, regressed to face-track summaries.

**Remediation (already in git).** structure-and-write strips fence + retries with outermost-`{...}` extraction before inserting. Same pattern already in `anthropic_llm.chat_json()`.

---

### Lesson 12 — Persona /chat needs the clip narration in render_context
**What happened.** When `clip_id` was pinned, `hybrid_retrieve` skipped the vector search → returned no hits → `render_context` built a context from only plate readings + face tracks. The actual rich Aurora prose was discarded.

**Remediation (already in git).** `render_context` now adds a `[clip narration]` block from `clip_ctx['prose']` whenever it's non-empty.

---

### Lesson 13 — Aurora `custody_log` is append-only via trigger
**What happened.** `DELETE FROM pd_cctv.custody_log WHERE clip_id != sentinel` fails with `RaiseException: pd_cctv.custody_log is append-only`.

**Remediation.** Use TRUNCATE (bypasses DELETE triggers):
```python
cur.execute('TRUNCATE pd_cctv.custody_log;')
cur.execute('TRUNCATE pd_cctv.faces, pd_cctv.plates, pd_cctv.events, pd_cctv.narrations, pd_cctv.relationships, pd_cctv.entities;')
cur.execute("DELETE FROM pd_cctv.clips WHERE clip_id::text != '00000000-0000-0000-0000-000000000001';")
```

The sentinel clip is `00000000-0000-0000-0000-000000000001` — keep it, it's what makes the empty UI state look good.

---

### Lesson 14 — App-of-apps cascade defeats local ArgoCD patches
**What happened.** Patching `selfHeal=false` directly on `pd-pipeline` Application worked for ~3 min, then `pd-bootstrap` (the parent app-of-apps managing `pd-pipeline`'s Application spec) reconciled it back to `selfHeal=true` from git. Same pattern would bite `pd-personas` etc.

**Remediation.** When you need an emergency live-only override:
```bash
# Pause BOTH levels (pd-bootstrap and the child) so local patches stick:
oc -n openshift-gitops patch application.argoproj.io pd-bootstrap --type=merge -p '{"spec":{"syncPolicy":null}}'
oc -n openshift-gitops patch application.argoproj.io pd-pipeline  --type=merge -p '{"spec":{"syncPolicy":null}}'
# Do the work, fire the PipelineRun fast (3 min before next bootstrap reconcile).
# Then re-enable when you commit the change to git:
oc -n openshift-gitops patch application.argoproj.io pd-pipeline --type=merge \
  -p '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true},"syncOptions":["CreateNamespace=false","ServerSideApply=true"]}}}'
```

---

### Lesson 17 — Fresh-cluster bring-up has its own gotchas (2026-05-21)
First end-to-end run of the new `provision_and_build_police_department_demo.sh`
on a freshly-Terraformed cluster surfaced four issues, all encoded into the
script now so the next operator hits zero of them:

1. **MachineSet prefix is generated per Terraform run** (`ai-demo-lt9wz` →
   `ai-demo-zpvwj`). Leave `PD_MACHINESET_PREFIX` blank in `.env.demo`; the
   script auto-detects from `oc -n openshift-machine-api get machineset`.

2. **GPU MachineSet template references the wrong AWS Security Group + Subnet
   names.** Terraform Created `ai-demo-zpvwj-node` (worker SG) and
   `ai-demo-zpvwj-subnet-private-us-east-1a`, but the cluster's GPU MachineSet
   template was authored against the older naming `*-worker-sg` /
   `*-private-us-east-1a`. Symptom: GPU machine goes to `Failed` after ~30 min
   with `error getting security groups IDs: no security group found`.
   **Fix**: patch the MachineSet to use the platform's actual names. Script
   detects this by checking whether the machine reaches `Provisioned`; if it
   sits in `Provisioning` past 5 min, sniff the error and patch.

3. **g4dn.xlarge T4 (16 GB) is NOT enough for Qwen-VL 7B.** Fresh Terraform
   defaults the GPU MachineSet to `g4dn.xlarge`; vLLM loads ~14 GB of model
   weights into VRAM, then OOMs on the first KV-cache allocation. Symptom:
   `CUDA out of memory. Tried to allocate 260.00 MiB. GPU 0 has a total
   capacity of 14.56 GiB of which 58.81 MiB is free`. **Fix**: patch the GPU
   MachineSet to `g5.xlarge` (A10G 24 GB) before letting it provision. Script
   does this unconditionally.

4. **Time-slicing ConfigMap + ClusterPolicy patch are NOT in git.** They were
   live-applied on the previous cluster's GPU operator. Fresh cluster comes up
   with `nvidia.com/gpu` allocatable = 1, not 4 → only one GPU-requesting pod
   can run at a time → yolo / faces / vlm-caption serialise instead of
   running in parallel. **Fix**: ship the `time-slicing-config-all`
   ConfigMap + ClusterPolicy patch in `manifests/inference/` and apply them
   in step 11 of the bring-up.

5. **`pd-kserve-s3-creds` was always created out-of-band** by the operator
   running `oc apply` ad-hoc. Without it, KServe storage-initializer can't
   download the model and the IS revision is rejected by the
   `inferenceservice.kserve-webhook-server.pod-mutator` with
   `secrets "pd-kserve-s3-creds" not found`. **Fix**: script now stamps it
   alongside `pd-s3-creds` (reusing the same long-lived IAM keys) in step 4.

6. **Persona BuildConfig + ImageStream were never committed.** On the
   original cluster they were created with `oc new-build` early in
   development. A fresh cluster has no BC, so step 15's `oc start-build`
   returns empty. **Fix**: script now runs `oc new-build --binary
   --strategy=docker --name=pd-persona` the first time through; subsequent
   runs no-op.

7. **`pd-vlm-mode` ConfigMap default in git is `resolution: 1280`** which
   busts max-model-len=8192 in local Qwen-VL mode (lesson 10 confirmation).
   When the operator's intent is local-mode demos, the script now patches
   the live ConfigMap to `resolution: 640` AFTER the ArgoCD-driven
   reconcile, with `Prune=false` so the operator's override sticks.

8. **bootstrap/03_apply_argocd.sh's per-app waiter has a 10-min timeout**
   that fires before ArgoCD's natural 3-min reconcile cycle has even
   processed the bootstrap on a fresh cluster — and its non-zero exit
   silently truncated the parent script. Steps 7-17 then never ran even
   though my script said exit 0. **Fix**: inline the ArgoCD step in the
   provision script with a 20-min waiter on pd-bootstrap itself being
   Synced + 7 child apps materialising. Don't delegate to the older
   sub-script.

9. **Tekton `coschedule=workspaces` pins every PipelineRun task to one
   node** via a podAffinity to an `affinity-assistant` pod. Our workspace
   is RWX (EFS) so the assistant is unnecessary — and harmful: if the
   assistant lands on a non-GPU worker, `yolo-detect` and
   `faces-and-plates` go `Pending` forever ("Insufficient nvidia.com/gpu"
   on the node they're pinned to, even though the GPU node has 4 free
   vGPUs). Symptom: yolo + faces stuck in `Pending`, affinity-assistant
   on a non-GPU node, predictor happily running on the GPU node.
   **Fix**: `oc patch tektonconfig config --type=merge -p
   '{"spec":{"pipeline":{"coschedule":"disabled"}}}'`. Added as step 13.5
   of the provision script.

10. **`pd-results-prune-creds` ships empty in git** and the CronJob
    connects to `tekton-results-postgres-service.openshift-pipelines.svc`
    — i.e. it needs the **Tekton Results Postgres** user/password
    (key names `user` + `password`), NOT Aurora. Without the keys, the
    pod fails with `couldn't find key user in Secret
    pd-cctv/pd-results-prune-creds` and the CronJob accumulates Failed
    runs every 15 min. **Fix**: step 13.5 stamps it from
    `openshift-pipelines/tekton-results-postgres` (`POSTGRES_USER` /
    `POSTGRES_PASSWORD`).

11. **Aurora `password` field can be empty in the platform-issued
    `aurora-credentials` Secret on fresh clusters.** Platform now stores
    the real password in SSM at `/ai-demo/aurora/master-password`; the
    K8s Secret is sometimes only the *schema* with an empty password
    until the platform's Aurora-init Job runs. **Fix**: provision script
    already prefers SSM as the source-of-truth for the password in step
    4; just confirmed this is the correct precedence going forward.

23. **GPU MachineSet had NO `NoSchedule` taint — platform pods squatted
    on it and starved pipeline GPU tasks of CPU/memory** (not vGPU).
    Symptom: `oc describe pod` on a Pending yolo-detect or
    faces-and-plates says `Insufficient cpu / Insufficient memory` on
    the GPU node even though `nvidia.com/gpu` allocatable is 3/4.
    A single g5.xlarge has only ~3.5 CPU + ~12.7 GiB allocatable; once
    `rhods-dashboard` (1.5 CPU + 3 GiB), `argocd-application-controller`
    (250m + 1 GiB), `notebook-controller`, and a few operators drift
    onto the node, there's zero headroom for a 25m + 1 GiB pipeline
    pod. The full pipeline ends up partly serial and the operator
    blames "time-slicing not working" — but the vGPU side is fine,
    the CPU/mem side is starved. **Fix**: add a
    `nvidia.com/gpu=true:NoSchedule` taint to the GPU MachineSet's
    `spec.template.spec.taints`. Every GPU-requesting workload in
    this demo (predictor, yolo-detect, faces-and-plates) already
    carries the matching toleration (`operator: Exists` with key
    `nvidia.com/gpu`), so only they can land there. Idempotent — the
    script checks for the existing taint before re-applying. Note
    that this only affects NEW nodes provisioned by the MachineSet;
    a live node also needs `oc adm taint nodes <node>
    nvidia.com/gpu=true:NoSchedule` to take effect immediately.

22. **BGE-small embedding model was missing from S3 after hard
    teardown.** `bootstrap/02_fetch_models.sh` only staged Qwen2.5-VL;
    BGE-small (`BAAI/bge-small-en-v1.5`, ~130 MB) was implicitly assumed
    to "always be there" because it survived soft teardowns. After the
    first hard teardown the model prefix was wiped, but the next
    provision only re-staged Qwen-VL — so the structure-and-write task's
    BGE-small fetch returned 0 entries, sentence-transformers fell
    through to local-load on the empty dir, and transformers raised
    `ValueError: Unrecognized model in .../bge-small-en-v1.5. Should
    have a 'model_type' key in its config.json`. Every "Indexing in
    Aurora" step failed identically until the model was re-staged.
    **Fix**: 02_fetch_models.sh now also stages BGE-small with its own
    idempotency guard (`aws s3 ls $BGE_PREFIX/config.json`).

21. **`05_views.sql` and `07_faces_plates.sql` both `CREATE OR REPLACE
    VIEW pd_cctv.v_clip_summary`** but 07 adds two columns (plate_count,
    face_count). On the first run: 05 creates 8 cols, 07 widens to 10
    cols — both succeed. On every re-run: 05 tries to REPLACE a 10-col
    view with an 8-col definition → Postgres rejects with `cannot drop
    columns from view`, the whole init Job aborts (`--single-transaction
    --set ON_ERROR_STOP=on`), 06 + 07 + 08 never execute on re-runs —
    so `operator_corrections` never gets created and the persona's
    slash-command code throws `relation does not exist`. **Fix**: 05
    now starts with `DROP VIEW IF EXISTS ... CASCADE` for both views
    and uses plain `CREATE VIEW` afterwards. Idempotent against any
    prior state.

20. **Step 13 (GPU-mutex preflight) hung forever counting the predictor
    pod itself as a stray GPU holder.** The original loop:
    `while [ count_pods_requesting_gpu != 0 ]; do sleep 10; done`. By Step
    13 the IS already exists (ArgoCD applied it back in Step 6) and the
    predictor pod is requesting `nvidia.com/gpu: 1` — so the count is
    permanently ≥ 1 and the loop never exits. On today's bring-up the
    script sat in this loop for 30+ min while the predictor cold-started
    and went to 3/3 Ready in parallel. **Fix**: short-circuit the whole
    block if `oc get inferenceservice pd-qwen25-vl-7b` exists. Step 14's
    "wait predictor 3/3" block is the real readiness gate. Also added a
    5-min hard timeout to the orphan-wait loop for the truly-fresh case
    so a future surprise can't hang the script indefinitely.

19. **Step 10 (wait `nvidia.com/gpu` allocatable=4) ordered BEFORE Step
    10.5 (apply time-slicing ConfigMap + ClusterPolicy patch).** On a
    fresh cluster the wait timed out after 15 min because the patch
    that would make allocatable=4 was scheduled to run AFTER the wait.
    A `Cluster Policy` with `spec.devicePlugin.config` empty advertises
    1 GPU. **Fix**: merged into a single Step 10 with four sub-phases:
    (a) wait GPU node online with allocatable≥1, (b) apply the
    time-slicing ConfigMap + ClusterPolicy patch, (c) bounce the
    device-plugin daemonset, (d) wait allocatable=4 + workers 2/2.

18. **`pd-hf-token` Secret never stamped by Step 4.** Step 7's
    `bootstrap/02_fetch_models.sh` wires the model-fetcher Job to
    `secretKeyRef: pd-hf-token/token`, but the provision script's
    Secret-stamp block only handled Anthropic + Aurora + S3 +
    Portkey + KServe. On a fresh data lake (no model in S3) the
    fetcher Job sat in `CreateContainerConfigError` with `secret
    "pd-hf-token" not found` for 26+ min before the script's wait
    timed out — and Step 10 then failed because the model was
    missing. **Fix**: Step 4 now stamps `pd-hf-token` in `pd-cctv`
    from the `PD_HF_TOKEN` env var, with a warn (not error) if the
    var is empty and the model is already in S3.

17. **`destroy_police_department_demo.sh` swallowed the empty
    `PD_MACHINESET_PREFIX` and called `oc scale machineset
    -gpu-demo-us-east-1a --replicas=0`**, which `oc` then parsed as
    `-g` shorthand → `error: unknown shorthand flag: 'g'`. Both scale
    steps (GPU → 0 and workers → 1/AZ) silently failed at the end of
    teardown, leaving the cluster at full cost until manually scaled.
    **Fix v1**: ported the awk-based "strip the role+AZ suffix" logic
    from the provision script. That broke on the next teardown because
    the compute MachineSet `ai-demo-zpvwj-compute-us-east-1a` sorted
    first, so awk peeled off only `-us-east-1a` and left
    `ai-demo-zpvwj-compute` as the prefix. **Fix v2**: pin on the
    deterministic `<prefix>-worker-us-east-1a` MachineSet (worker is
    always 1 dash-field, AZ 1a always exists), then strip the known
    suffix with parameter expansion: `${ms%-worker-us-east-1a}`. Same
    fix applied to the provision script's auto-detect for symmetry.
    Also reordered `oc scale --replicas=0 -- machineset/<name>` so a
    future broken prefix can never masquerade as a flag.

16. **`pd_cctv.operator_corrections` table was never in the schema
    ConfigMap.** The persona's slash-command code
    (`personas/app/tools/corrections.py`, `clip_context.py`,
    `graphs/_common.py`) reads/writes this table, but `pd-aurora-schema-configmap.yaml`
    only created 8 tables (clips, custody_log, narrations, entities,
    events, relationships, plates, faces). Symptom: every persona
    `/api/clips` GET + every clip-detail load logs `WARNING ... relation
    "pd_cctv.operator_corrections" does not exist`, the persona returns
    empty corrections context, and slash commands silently fail at
    INSERT. **Fix**: added `08_operator_corrections.sql` to the schema
    CM with the full table + indexes, and added `/sql/08_*` to the
    init-Job iterator.

15. **IAM user `pd-demo-s3-rw` couldn't write MLflow artifacts.** The
    structure-and-write task ends with an MLflow log of the run bundle
    to `s3://ai-demo-data-lake/mlflow-artifacts/<exp>/<run>/...` — but
    the script's IAM policy only granted PutObject on
    `clips/police-department/*`, `processed/police-department/*`, and
    `models/police-department/*`. Symptom: `[structure] WARN: mlflow
    log failed ... s3:PutObject AccessDenied` at the very end. The
    task still exits 0 (the warn is intentionally non-fatal), so the
    PipelineRun succeeds and Aurora has all the rows — but operators
    looking at MLflow Experiments find empty artifacts. **Fix**:
    extended the script's `pd-s3-rw` IAM policy to include
    `arn:aws:s3:::$PD_BUCKET/mlflow-artifacts/*` + the matching ListBucket
    prefix.

14. **`pd-structure-runner:0.1.0` BuildConfig + ImageStream were never
    committed.** Same pattern as `pd-persona` (lesson 17.6) — the image
    was originally built ad-hoc with `oc new-build` on the dev cluster
    and the Tekton task pins
    `image-registry.openshift-image-registry.svc:5000/pd-cctv/pd-structure-runner:0.1.0`.
    A fresh cluster has no BuildConfig + no image → final `structure-and-write`
    task fails with `TaskRunImagePullFailed: ErrImagePull ... name unknown`,
    even though every preceding task (yolo + faces + vlm-caption + whisper)
    succeeded — so the whole PipelineRun is wasted. **Fix**: new step
    13.7 of the provision script runs `oc new-build --binary
    --strategy=docker --name=pd-structure-runner` against
    `runner-images/structure-and-write/`, kicks off a build, waits for
    Complete, and `oc tag :latest :0.1.0`. Idempotent on re-runs.

13. **OCP Console doesn't enable the Pipelines plugin by default.** The
    OpenShift Pipelines operator ships a `pipelines-console-plugin`
    Deployment in `openshift-pipelines` and a `ConsolePlugin` CRD
    instance — but the cluster `Console` operator's
    `spec.plugins` list does **not** include it. Symptom: OCP UI's left
    nav has zero Pipelines entry even though Pipelines + PipelineRuns
    exist in `pd-cctv`. **Fix**: `oc patch console.operator cluster
    --type=json -p='[{"op":"add","path":"/spec/plugins/-","value":"pipelines-console-plugin"}]'`
    + wait for `openshift-console` rollout. Added to step 13.5 of the
    provision script.

12. **`pd-aurora-credentials-secret.yaml` declared `stringData.endpoint:
    ""` and `stringData.password: ""` "as placeholders for ArgoCD".**
    Every ArgoCD reconcile silently blanked the live endpoint+password
    back to `""`, which caused the `pd-aurora-init` PostSync hook Job
    to fail with `connection to server on socket "/var/run/postgresql/
    .s.PGSQL.5432" failed` (PGHOST was empty). The persona service
    then logged `relation "pd_cctv.clips" does not exist` on every
    `/api/clips` call because the schema was never created. **Fix**:
    remove `endpoint` and `password` from the git manifest entirely.
    The provision script's `upsert` helper uses `oc apply --server-side
    --force-conflicts`, so the script-stamped fields are owned by a
    different field-manager and survive ArgoCD reconciles. The git
    manifest now only declares `database` + `username` (deterministic
    values that are safe to be authoritative).

---

### Lesson 16 — Tekton wasn't the only admission webhook bitten by node load
**What happened.** Even after fixing tekton-operator-proxy-webhook (Lesson 1),
`oc apply -f pd-qwen25-vl-7b.yaml` failed twice on bring-up:
1. First with `kserve-kueuelabels-validator.opendatahub.io` timing out — the
   `rhods-operator` pod was crashlooping on `ip-10-0-7-84` (35 restarts).
2. Then with `mutating.pod.odh-model-controller.opendatahub.io` reporting
   `no endpoints available` — the `odh-model-controller` pod was
   crashlooping on the same overloaded worker (280 restarts).
Each failure manifested as a different "no endpoints" / "context deadline
exceeded" error and was misdiagnosed before the obvious shared cause
showed up: the loaded worker was killing pods faster than they could
serve admission traffic.

**Remediation.** Step 6b added to the pre-flight: delete any pod in
`redhat-ods-operator/name=rhods-operator` or
`redhat-ods-applications/control-plane=odh-model-controller` that has
restarts >5, then wait for its replacement. Both daemons are part of the
KServe admission chain, so without them the predictor pod cannot be
created.

---

### Lesson 15 — Two independent LLM mode toggles
The demo has two ConfigMaps that look similar but are independent:
- `pd-llm-mode` (in `pd-personas` ns) — chat-time persona LLM. Values: `mock | local | claude`.
- `pd-vlm-mode` (in `pd-cctv` ns) — pipeline-time VLM. Values: `local | claude-multimodal`.

Both flippable via UI dropdowns; both have `Prune=false` annotations. Setting one doesn't affect the other.

The intent: chat is cheap on Claude (only seeing indexed text), so `pd-llm-mode = claude` is safe by default. VLM ingest sends frames to the model, so `pd-vlm-mode = local` is the privacy-safe default; flip to `claude-multimodal` per-clip via the "Deep analysis" upload checkbox or globally via the dropdown.

---

## Health-check one-liners (run these any time)

```bash
# Persona pod healthy + serving the latest image
oc -n pd-personas get pods -l app.kubernetes.io/name=pd-persona
oc -n pd-personas get is pd-persona -o jsonpath='{range .status.tags[?(@.tag=="0.2.0")]}{.tag}: {.items[0].image}{"\n"}{end}'

# Tekton webhooks must NOT be on ip-10-0-36-27
oc -n openshift-pipelines get pods -o wide | grep webhook | grep 36-27 && echo "BAD"

# GPU node ready, time-sliced
oc get node -l nvidia.com/gpu.present=true -o jsonpath='{.items[0].status.allocatable.nvidia\.com/gpu}'  # should print 4

# pd-s3-creds is long-lived
oc -n pd-personas get secret pd-s3-creds -o jsonpath='{.data.access_key_id}' | base64 -d  # AKIA*

# Aurora reachable
oc -n pd-personas exec deploy/pd-persona -c pd-persona -- python3 -c "
import os, psycopg
with psycopg.connect(host=os.environ['PGHOST'], dbname=os.environ['PGDATABASE'],
                     user=os.environ['PGUSER'], password=os.environ['PGPASSWORD']) as c:
    c.cursor().execute('SELECT 1'); print('aurora ok')
"

# Persona UI front door
curl -sk https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/api/clips | jq '.clips | length'

# Active mode
oc -n pd-personas get cm pd-llm-mode -o jsonpath='{.data.mode}'   # should be claude
oc -n pd-cctv     get cm pd-vlm-mode -o jsonpath='{.data.mode}'   # local OR claude-multimodal
```

---

## Teardown at end of session (don't forget anything)

```bash
# 1. Wipe Aurora (preserve sentinel) + S3 + EFS workspace clip dirs.
#    See bootstrap/04_clean.sh OR run the inline commands in the runbook below.

# 2. Delete InferenceService so Knative stops retrying.
oc -n pd-cctv delete inferenceservice pd-qwen25-vl-7b --ignore-not-found

# 3. Scale GPU to 0.
oc -n openshift-machine-api scale machineset ai-demo-lt9wz-gpu-demo-us-east-1a --replicas=0

# 4. Scale extra worker back to baseline.
oc -n openshift-machine-api scale machineset ai-demo-lt9wz-worker-us-east-1c --replicas=1

# 5. Cordon ip-10-0-36-27 stays in place — DO NOT uncordon. It's permanently
#    untrusted until someone (kubeadmin) runs `kubelet restart` on the node
#    or replaces it via MachineSet.
```
