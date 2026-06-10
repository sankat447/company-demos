# Demo Script — Police-Department CCTV Video Intelligence

A 6–8 minute live walkthrough. Read off this script when presenting; pause where indicated.

## Pre-flight (do 30 minutes BEFORE the demo)

1. `bash bootstrap/00_preflight.sh` — confirm green
2. `oc -n ai-demo patch isvc llama-3-1-8b --type=merge -p '{"spec":{"predictor":{"minReplicas":0}}}'`
3. `oc -n pd-cctv get isvc pd-qwen25-vl-7b -o jsonpath='{.status.url}'` — visit URL once to warm the model
4. Open the HITL queue page: `https://$(oc -n pd-personas get route pd-hitl -o jsonpath={.spec.host})/queue`
5. Open the Tekton dashboard for `pd-cctv`
6. Stage one short CCTV clip in `tests/samples/`

## Live demo (target 7 min)

### 1. Frame the problem (45 sec)

> "Police departments have hours of CCTV footage but minutes of analyst time. We're going to drop a clip into S3 and watch it become structured intelligence — searchable narrative, tagged entities, a chain-of-custody trail — in under 90 seconds, on commodity infrastructure."

### 2. Drop a clip (15 sec)

```bash
SAMPLE_LOCAL=tests/samples/<your-clip>.mp4 bash bootstrap/04_seed_samples.sh
```

Show the S3 console: the clip lands in `clips/police-department/`.

### 3. Watch the perception pipeline run (90 sec)

> "An in-cluster watcher polls S3 every 60 seconds. As soon as it sees the new key, it POSTs to a Tekton EventListener, which materialises a 5-task PipelineRun."

```bash
oc -n pd-cctv get pr -w
```

In the Tekton dashboard: walk through the DAG.

> "`pull-clip` downloads from S3 and computes a SHA-256. Then three tasks run in parallel: `vlm-caption` calls Qwen2.5-VL on the GPU for an image-grounded narrative; `whisper-asr` runs faster-whisper on CPU; `yolo-detect` runs YOLOv8n on CPU. `structure-and-write` joins them — Pydantic schemas, BGE-small embedding, single-transaction write to Aurora pgvector."

### 4. Show the structured evidence (60 sec)

```bash
oc -n pd-cctv exec deploy/redis -n ai-demo -- redis-cli ping  # tangent: confirms Redis reachable
oc -n ai-demo run pd-demo-psql --rm -i --tty=false --restart=Never \
  --image=docker.io/library/postgres:16 \
  --overrides='{"spec":{"containers":[{"name":"x","image":"docker.io/library/postgres:16","stdin":true,"envFrom":[{"secretRef":{"name":"aurora-credentials"}}]}]}}' \
  -- bash -c 'PGPASSWORD=$password psql -h $endpoint -U $username -d $database \
       -c "SELECT clip_id, prose FROM pd_cctv.narrations ORDER BY created_at DESC LIMIT 1;"'
```

> "Notice the prose is grounded in what the VLM actually saw, not a hallucinated summary. The `entities` and `events` tables let downstream queries do graph walks — find me every clip where this person appears."

### 5. Talk to the personas (90 sec)

```bash
HOST=$(oc -n pd-personas get route pd-persona -o jsonpath='{.spec.host}')
curl -sk -H 'Content-Type: application/json' \
  -d '{"q":"What happened in the most recent clip?","k":4}' \
  https://$HOST/chat/detective | jq
```

> "Three persona agents share one Llama 3.1 8B served through Portkey. Detective writes investigative narrative; Patrol issues BOLO entries; Evidence Clerk produces evidence-packet manifests. Same retrieval graph, different prompt and different output schema."

Run the same query against `/chat/patrol` and `/chat/evidence_clerk`.

### 6. HITL approval (60 sec)

Switch to the `/hitl/queue` browser tab.

> "Every persona response is parked in Redis with a 10-minute TTL and *not* released until an operator approves it. The decision — approve, edit-and-approve, or reject — is appended to the append-only custody log."

Approve one. Reject one with a reason. Show the custody-log row appearing in psql:

```sql
SELECT actor, action, ts FROM pd_cctv.custody_log ORDER BY ts DESC LIMIT 5;
```

### 7. GPU choreography (45 sec)

> "We have one T4 GPU. The platform's Llama and our Qwen2.5-VL both want it. Knative scale-to-zero choreographs the swap — neither holds the GPU when idle, and a Prometheus alert fires if both ever go Ready."

```bash
oc -n pd-cctv get prometheusrule pd-gpu-mutex -o yaml | head -30
```

### 8. Wrap (30 sec)

> "Everything you saw lives in `company-demos/police-department/` as plain YAML — same convention as the platform repo, no Kustomize, no Helm. Deploy is one `oc apply`. Teardown is one `oc delete`. The platform repo is untouched. The same pattern transplants to a healthcare or retail demo with a find-replace of the `pd-` prefix."

## After the demo

```bash
oc -n ai-demo patch isvc llama-3-1-8b --type=merge \
  -p '{"spec":{"predictor":{"minReplicas":0}}}'
```

(Bring Llama back to default after the VLM has scaled down.)
