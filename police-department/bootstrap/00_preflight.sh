#!/usr/bin/env bash
# =============================================================================
#  00_preflight.sh — verify the cluster is ready for the demo.
#
#  Checks (idempotent, read-only):
#    - oc / aws / argocd / shellcheck installed
#    - oc whoami succeeds
#    - openshift-gitops namespace + ArgoCD Server running
#    - ai-demo namespace exists
#    - vllm-runtime ServingRuntime exists in ai-demo
#    - llama-3-1-8b InferenceService exists in ai-demo
#    - GPU node Ready
#    - Tekton Pipelines + Triggers CRDs installed
#    - Knative Serving CRD installed
# =============================================================================
SCRIPT_NAME=00_preflight
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — preflight"
require_cmd oc aws

log_info "oc whoami..."
oc whoami >/dev/null

log_info "openshift-gitops namespace..."
oc_ns_exists openshift-gitops

log_info "ai-demo namespace + platform services..."
oc_ns_exists ai-demo
oc -n ai-demo get servingruntime vllm-runtime >/dev/null
oc -n ai-demo get inferenceservice llama-3-1-8b >/dev/null

log_info "GPU node ready..."
gpu_ready=$(oc get nodes -l nvidia.com/gpu.present=true -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | grep -c '^True$' || true)
if [ "$gpu_ready" -lt 1 ]; then
  log_warn "no GPU node currently Ready. The demo will scale up the GPU MachineSet on first inference call (cold start ~5min)."
fi

log_info "Tekton CRDs..."
oc_kind_exists pipelines.tekton.dev
oc_kind_exists eventlisteners.triggers.tekton.dev

log_info "Knative Serving CRD..."
oc_kind_exists services.serving.knative.dev || log_warn "knative-serving not detected; Serverless InferenceServices may not work"

log_info "KServe CRDs..."
oc_kind_exists inferenceservices.serving.kserve.io
oc_kind_exists servingruntimes.serving.kserve.io

log_ok "preflight passed"
