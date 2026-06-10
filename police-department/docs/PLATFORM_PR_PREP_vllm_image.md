# Platform-side fix needed: `vllm-runtime` image tag

> **For the platform-repo owner.** Police-Department demo cannot complete a smoke run while `llama-3-1-8b` in `ai-demo` is `Failed`, and that failure is rooted in the platform repo, not the demo. This doc is the exact, minimal change needed and the apply runbook.

---

## TL;DR

| Repo | File | Line | Change |
|---|---|---|---|
| `https://github.com/sankat447/ai-demo-stack-aws` | `gitops/config/inference/vllm-servingruntime.yaml` | 26 | `quay.io/modh/vllm:rhoai-2.16` → `quay.io/modh/vllm:rhoai-2.25-cuda` |

That is the only file in the platform repo that references the dead tag (verified with `grep -rn "rhoai-2.16" .` — single match). Demo side already shipped the same fix in commit [`aabbf69`](https://github.com/sankat447/company-demos/commit/aabbf69) on `feature/police-department-v1`.

---

## Why this is needed

Both the platform's `llama-3-1-8b` and the demo's `pd-qwen25-vl-7b` InferenceServices reference `runtime: vllm-runtime`, which pulls `quay.io/modh/vllm:rhoai-2.16`. That tag was retired upstream — `quay.io` returns **HTTP 404** on the manifest lookup. Both InferenceServices therefore fail at revision creation:

```
RevisionFailed: Unable to fetch image "quay.io/modh/vllm:rhoai-2.16":
  failed to resolve image to digest: HEAD https://quay.io/v2/modh/vllm/manifests/rhoai-2.16:
  unexpected status code 404 Not Found
```

`quay.io/modh/vllm` now publishes per-accelerator tags (`rhoai-2.25-{cuda,rocm,gaudi}`). For RHOAI 2.25.6 on the cluster's NVIDIA T4, the right tag is `rhoai-2.25-cuda`. Verified pullable on 2026-05-05:

```bash
$ curl -sIo /dev/null -w "%{http_code}\n" \
    https://quay.io/v2/modh/vllm/manifests/rhoai-2.25-cuda
200
```

---

## Exact unified diff

```diff
--- a/gitops/config/inference/vllm-servingruntime.yaml
+++ b/gitops/config/inference/vllm-servingruntime.yaml
@@ -23,7 +23,11 @@ spec:
     autoSelect: true
   containers:
   - name: kserve-container
-    image: quay.io/modh/vllm:rhoai-2.16
+    # quay.io retired the bare rhoai-2.16 tag and now publishes per-accelerator
+    # variants. rhoai-2.25-cuda matches the RHOAI 2.25.x operator on this
+    # cluster's NVIDIA T4 GPU; the bare tag is no longer pullable (HTTP 404).
+    # Bump in lockstep with RHOAI operator upgrades.
+    image: quay.io/modh/vllm:rhoai-2.25-cuda
     command: ["python", "-m", "vllm.entrypoints.openai.api_server"]
     args:
     - "--port=8080"
```

The hunk leaves every other field untouched (model formats, args, env, resources, volumes). The added comment is optional but useful — pick one form.

---

## Two ways to apply

### Option A — clean-PR-via-gh-CLI (recommended, leaves a paper trail)

Run from the platform repo's worktree (currently `main` at `66d7a92`):

```bash
cd /Users/sanjeevkumar/GitHub/ai-demo-stack-aws

# 1. branch
git checkout -b fix/vllm-runtime-rhoai-2.25-cuda

# 2. apply the one-line edit (with the explanatory comment)
python3 - <<'PY'
from pathlib import Path
p = Path("gitops/config/inference/vllm-servingruntime.yaml")
src = p.read_text()
old = '    image: quay.io/modh/vllm:rhoai-2.16\n'
new = (
    "    # quay.io retired the bare rhoai-2.16 tag and now publishes per-accelerator\n"
    "    # variants. rhoai-2.25-cuda matches the RHOAI 2.25.x operator on this\n"
    "    # cluster's NVIDIA T4 GPU; the bare tag is no longer pullable (HTTP 404).\n"
    "    # Bump in lockstep with RHOAI operator upgrades.\n"
    "    image: quay.io/modh/vllm:rhoai-2.25-cuda\n"
)
assert old in src, "expected line not found — file may have changed"
p.write_text(src.replace(old, new))
print("patched")
PY

# 3. validate
ruby -ryaml -e "YAML.load_stream(File.read('gitops/config/inference/vllm-servingruntime.yaml'))" \
  && echo "yaml OK"

# 4. commit
git add gitops/config/inference/vllm-servingruntime.yaml
git commit -m "$(cat <<'EOF'
fix(inference): pin vllm-runtime to rhoai-2.25-cuda

quay.io retired the bare rhoai-2.16 tag (HEAD https://quay.io/v2/modh/
vllm/manifests/rhoai-2.16 -> 404). The replacement publishes per-
accelerator variants; rhoai-2.25-cuda matches the RHOAI 2.25.x operator
running on the ai-demo cluster's NVIDIA T4 GPU. Without this fix,
llama-3-1-8b InferenceService stays Failed at revision creation, and
every downstream consumer (Open WebUI chat, langchain server, the
police-department demo's persona service) hits 503.

The same one-line change has already shipped on the police-department
demo's parallel ServingRuntime in pd-cctv as commit aabbf69 of
sankat447/company-demos (feature/police-department-v1).
EOF
)"

# 5. push + open PR
git push -u origin fix/vllm-runtime-rhoai-2.25-cuda
gh pr create --base main --title "fix(inference): pin vllm-runtime to rhoai-2.25-cuda" --body "$(cat <<'EOF'
## Summary
- `quay.io/modh/vllm:rhoai-2.16` was retired (HEAD returns 404).
- All vllm-backed InferenceServices on the cluster (`llama-3-1-8b` in
  `ai-demo`, `pd-qwen25-vl-7b` in `pd-cctv`) fail at revision creation.
- Bumping to `rhoai-2.25-cuda` (the live tag for RHOAI 2.25.x + NVIDIA)
  unblocks both. Single-file change.

## Test plan
- [ ] `oc apply -f gitops/config/inference/vllm-servingruntime.yaml` (or merge
      and let openshift-gitops pick it up).
- [ ] Force a re-revision: `oc -n ai-demo delete isvc llama-3-1-8b` then
      ArgoCD will recreate it from `gitops/config/inference/llama-inferenceservice.yaml`.
- [ ] `oc -n ai-demo get isvc llama-3-1-8b` → READY=True within ~2 min.
- [ ] Open WebUI / langchain chat hits Llama successfully (cold-start aside).

## Demo-side parallel
The `police-department` demo at `sankat447/company-demos`
`feature/police-department-v1` (commit aabbf69) already applies the
identical change to its in-namespace `vllm-runtime` in `pd-cctv`. The two
need to land together for an end-to-end smoke run.
EOF
)"
```

### Option B — direct push to `main` (only if your branch protection allows it)

```bash
cd /Users/sanjeevkumar/GitHub/ai-demo-stack-aws
# (same edit step as Option A, then:)
git add gitops/config/inference/vllm-servingruntime.yaml
git commit -m "fix(inference): pin vllm-runtime to rhoai-2.25-cuda"
git push origin main
```

Either way, the **diff is one functional line** (plus a comment block).

---

## Post-merge runbook (cluster-side)

```bash
export KUBECONFIG=/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig

# 1. Force ArgoCD to refresh the source for the two affected Apps
for app in vllm-runtime llama-inference; do
  oc -n openshift-gitops annotate application.argoproj.io "$app" \
    argocd.argoproj.io/refresh=hard --overwrite
done

# 2. Verify the runtime image landed on the cluster
oc -n ai-demo get servingruntime vllm-runtime \
  -o jsonpath='{.spec.containers[0].image}{"\n"}'
# expected: quay.io/modh/vllm:rhoai-2.25-cuda

# 3. Force re-revision on the InferenceService (it's still pinned to the failed
#    Knative revision generated under the old tag; deleting + reapply rolls a fresh one)
oc -n ai-demo delete inferenceservice llama-3-1-8b
# ArgoCD's selfHeal recreates it from llama-inferenceservice.yaml within ~10 s
oc -n ai-demo get isvc llama-3-1-8b -w
# wait for READY=True

# 4. Smoke
oc -n ai-demo get ksvc llama-3-1-8b-predictor -o jsonpath='{.status.url}{"\n"}'
# curl that URL with a small chat completion payload via the platform's portkey
```

For the demo side (already wired):
```bash
# pd-cctv side already on rhoai-2.25-cuda after demo commit aabbf69. To re-roll:
oc -n pd-cctv delete inferenceservice pd-qwen25-vl-7b
# ArgoCD pd-inference Application recreates it.
oc -n pd-cctv get isvc pd-qwen25-vl-7b -w
```

---

## Rollback plan

If `rhoai-2.25-cuda` ever turns out to be incompatible with the model artefacts on this cluster (we have no reason to expect that — the model is a stock Llama 3.1 8B and a stock Qwen2.5-VL 7B), revert the commit:

```bash
cd /Users/sanjeevkumar/GitHub/ai-demo-stack-aws
git revert <merge-commit>
git push
```

But note: the *original* `rhoai-2.16` tag will still be 404. The viable rollback target is **another live tag**, not `rhoai-2.16`. As of this doc, all live tags are: `rhoai-2.16-{cuda,rocm,gaudi}` (note the suffix this time) and `rhoai-2.25-{cuda,rocm,gaudi}`. Run `curl -s 'https://quay.io/api/v1/repository/modh/vllm/tag/?onlyActiveTags=true&limit=200' | jq -r '.tags[].name'` to refresh the list before any rollback decision.

---

## Verification this doc is current

- Demo commit on `feature/police-department-v1`: [`aabbf69`](https://github.com/sankat447/company-demos/commit/aabbf69)
- Platform repo state at the time of writing: `main` `@66d7a92`, clean working tree.
- Live tag check: `https://quay.io/v2/modh/vllm/manifests/rhoai-2.25-cuda` → HTTP 200 (verified 2026-05-05).
- One match for `rhoai-2.16` in the platform repo: `gitops/config/inference/vllm-servingruntime.yaml:26`.

## Why is this in the **demo** repo's `docs/` and not in `ai-demo-stack-aws`?

Hard rule from `police-department/CLAUDE.md`: the demo subsystem never writes to the platform repo. This doc is the handoff artefact — when you (or anyone) drives the change, do it through the platform repo's normal review path. The demo cannot self-heal that side.
