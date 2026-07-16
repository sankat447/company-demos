# Amboy Tekton pipelines on AWS

Same four pipelines as `../amboy-baremetal/tekton/` (build-deploy, doc-process,
comparison, governance). Only two files are AWS-specific and checked in here:

- `00-rbac.yaml` — hand-merged UNION of the two per-tier baremetal Roles
  (blind namespace-merge would let one `amboy-pipeline` Role overwrite the other).
- `workspace-template.yaml` — RWX storage class `efs-sc` instead of cephfs.

The other five manifests (`tasks.yaml` + the four pipelines) are sed-transformed
from the baremetal source of truth at deploy time by `../deploy.sh` Phase 7
(`iis-ai-ai`/`iis-ai-ui` -> `amboy`, which also fixes the internal-registry image
paths and service DNS baked into the embedded scripts). Run them with:

```bash
tkn pipeline start amboy-doc-process -n amboy --serviceaccount amboy-pipeline \
  -p doc_name=my-report --showlog
tkn pipeline start amboy-comparison -n amboy --serviceaccount amboy-pipeline --showlog
tkn pipeline start amboy-governance -n amboy --serviceaccount amboy-pipeline -p action=audit-export --showlog
tkn pipeline start amboy-build-deploy -n amboy --serviceaccount amboy-pipeline \
  -w name=src,volumeClaimTemplateFile=tekton/workspace-template.yaml --showlog
```

Use FQNs with `oc` (`pipelines.tekton.dev`, `pipelineruns.tekton.dev`) — bare
`pipeline` is ambiguous with Kubeflow's kind.
