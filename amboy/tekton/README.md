# Amboy — OpenShift Pipelines (Tekton)

The **non-ML** functionality expressed as OpenShift Pipelines (Tekton). These run
**alongside** the interactive app and `deploy.sh`; they do **not** touch the OpenShift
AI model serving or the Data Science Pipeline (model training) — that stays as-is.

Principle: **reuse, don't reimplement.** The pipelines orchestrate the existing
in-cluster BuildConfigs and the already-deployed services (deid-gateway,
compare-agent) via their HTTP APIs.

## Resources
- `00-rbac.yaml` — SA `amboy-pipeline` + Roles/RoleBindings (iis-ai-ai + iis-ai-ui).
- `tasks.yaml` — reusable Tasks: `amboy-oc` (oc/bash in the OpenShift CLI image),
  `amboy-py` (python+httpx in the amboy image).
- `amboy-doc-process.yaml` · `amboy-comparison.yaml` · `amboy-governance.yaml` ·
  `amboy-build-deploy.yaml` — the four Pipelines.
- `workspace-template.yaml` — volumeClaimTemplate for the build-deploy workspace.

Apply: `oc apply -f tekton/00-rbac.yaml -f tekton/tasks.yaml -f tekton/amboy-*.yaml`
(deploy.sh also applies these). All carry `demo: amboy` for teardown.

## Run them
> NOTE: `oc get pipeline` is ambiguous (Tekton + Kubeflow both register it) — use the
> fully-qualified `pipelines.tekton.dev` / `pipelineruns.tekton.dev`.

**Document processing** — de-identify a report into a stored artifact:
```
tkn pipeline start amboy-doc-process -n iis-ai-ai --serviceaccount amboy-pipeline \
  -p artifact_name="Acme FY2025" \
  -p text="Acme Corp FY2025. Revenue 138.9M USD. Borrower Jane Doe SSN 900-12-3456."
```

**Comparison run** — comparability -> index -> compare for two artifacts:
```
tkn pipeline start amboy-comparison -n iis-ai-ai --serviceaccount amboy-pipeline \
  -p artifact_a=<id> -p artifact_b=<id> -p name="Acme FY24 vs FY25"
```
The result appears under **AI Insights from Documents** with report-aware prompts.

**Governance / ops**:
```
tkn pipeline start amboy-governance -n iis-ai-ai --serviceaccount amboy-pipeline -p action=seed
tkn pipeline start amboy-governance -n iis-ai-ai --serviceaccount amboy-pipeline -p action=audit-export
```

**Build & deploy** — clone -> build both images -> roll the app services -> smoke
(does not touch the model predictor):
```
tkn pipeline start amboy-build-deploy -n iis-ai-ai --serviceaccount amboy-pipeline \
  -w name=src,volumeClaimTemplateFile=tekton/workspace-template.yaml
```

Without the `tkn` CLI, create a `PipelineRun` with `oc create -f -` (set
`spec.taskRunTemplate.serviceAccountName: amboy-pipeline` and the params/workspace).

## Optional (not installed)
Pipelines-as-Code is available on the cluster — a `Repository` CR could git-trigger
`amboy-build-deploy` on push. Left out by default.
