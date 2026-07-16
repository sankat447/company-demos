"""Compile the UNMODIFIED baremetal NPI-tagger pipeline and re-plumb it for the
AWS stack, then upload it to the OpenShift AI Pipeline Server (+ ensure the
amboy-npi-tagger Experiment). Mounted into the amboy-pipeline-upload Job via the
amboy-compile-aws ConfigMap; runs on the amboy image (baremetal source at /app).

Why the re-plumb: the pipeline components read endpoints/creds from
app/common/config.py env vars. On baremetal the defaults matched the in-stack
services so task pods needed no env; on AWS they must point at Aurora / S3 / the
`amboy` namespace. KFP v2 task-pod env comes from the compiled IR, so this script
post-processes it (config plumbing only -- the pipeline DAG stays single-sourced
in amboy-baremetal/app/pipeline):
  - every executor container inherits this Job's non-secret AMBOY_* endpoint env
    (wired in by the amboy-aws-env ConfigMap)
  - secrets ride kfp-kubernetes platformSpec `secretAsEnv` entries resolved from
    the amboy-creds Secret at task-pod runtime (never plaintext in the IR/DB)

NOTE: keep this file ASCII-only -- the DSP MariaDB PipelineSpec column is latin1.
"""
import os
import sys
import uuid

sys.path.insert(0, "/app")

import yaml
import kfp
from kfp import compiler

from app.pipeline.npi_tagger_pipeline import npi_tagger

NAME = "amboy-npi-tagger"
OUT = "/tmp/amboy_npi_tagger.yaml"
HOST = os.environ.get("DSP_HOST", "https://ds-pipeline-amboy-dsp.amboy.svc:8443")
TOKEN = open("/var/run/secrets/kubernetes.io/serviceaccount/token").read().strip()
CA = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"

# amboy-creds secretKey -> env var name config.py reads (runtime-resolved by DSP)
SECRET_AS_ENV = [
    ("PG_PASSWORD", "AMBOY_PG_PASSWORD"),
    ("S3_ACCESS_KEY", "AMBOY_S3_ACCESS_KEY"),
    ("S3_SECRET_KEY", "AMBOY_S3_SECRET_KEY"),
    ("VAULT_TOKEN", "AMBOY_VAULT_TOKEN"),
]
# Exact allowlist of non-secret endpoint env the task pods need (the config.py
# surface). A prefix sweep would also drag in the AMBOY_* SERVICE env vars
# kubernetes injects for every amboy-* Service in the namespace.
_PLAIN_ENV = [
    "AMBOY_PG_HOST", "AMBOY_PG_PORT", "AMBOY_PG_DB", "AMBOY_PG_USER",
    "AMBOY_S3_ENDPOINT", "AMBOY_S3_BUCKET_RAW", "AMBOY_S3_BUCKET_DEID",
    "AMBOY_PORTKEY_BASE_URL", "AMBOY_VAULT_ADDR", "AMBOY_KEYCLOAK_URL",
    "AMBOY_MLFLOW_URL", "AMBOY_PII_MODEL_URL",
    "AMBOY_PRESIDIO_ANALYZER_URL", "AMBOY_PRESIDIO_ANONYMIZER_URL",
    "AMBOY_METRICS_ENGINE_URL", "AMBOY_DEID_GATEWAY_URL",
    "AMBOY_COMPARE_AGENT_URL", "DSP_HOST", "RHOAI_DASHBOARD",
]


def _aws_env():
    """Non-secret endpoint env inherited from this Job's environment."""
    return [{"name": k, "value": os.environ[k]} for k in _PLAIN_ENV if k in os.environ]


def replumb(path):
    """KFP compiled files are (up to) TWO YAML documents: the PipelineSpec and,
    when kubernetes platform features are used, a separate PlatformSpec doc.
    Embedding `platforms` INTO the PipelineSpec makes the upload fail with
    'unknown template format: pipeline spec is invalid' -- keep them separate."""
    with open(path) as f:
        docs = [d for d in yaml.safe_load_all(f) if d]
    ir = docs[0]
    platform = next((d for d in docs[1:] if "platforms" in d), {"platforms": {}})
    envs = _aws_env()
    executors = ir.get("deploymentSpec", {}).get("executors", {})
    k8s_execs = {}
    for name, ex in executors.items():
        c = ex.get("container")
        if not c:
            continue
        have = {e.get("name") for e in c.get("env", [])}
        c.setdefault("env", []).extend(e for e in envs if e["name"] not in have)
        k8s_execs[name] = {"secretAsEnv": [{
            "secretName": "amboy-creds",
            "keyToEnv": [{"secretKey": sk, "envVar": ev} for sk, ev in SECRET_AS_ENV],
        }]}
    kube = platform.setdefault("platforms", {}).setdefault("kubernetes", {})
    existing = kube.setdefault("deploymentSpec", {}).setdefault("executors", {})
    for name, cfg in k8s_execs.items():
        existing.setdefault(name, {}).update(cfg)
    with open(path, "w") as f:
        yaml.safe_dump_all([ir, platform], f, sort_keys=False)
    print(f"replumbed {len(k8s_execs)} executors for AWS "
          f"({len(envs)} env vars + amboy-creds secretAsEnv)")


def main() -> int:
    compiler.Compiler().compile(npi_tagger, OUT)
    print(f"compiled pipeline -> {OUT}")
    replumb(OUT)

    client = kfp.Client(host=HOST, existing_token=TOKEN, ssl_ca_cert=CA)

    try:
        pid = client.get_pipeline_id(NAME)
    except Exception:
        pid = None

    if pid:
        client.upload_pipeline_version(
            pipeline_package_path=OUT, pipeline_id=pid,
            pipeline_version_name=f"{NAME}-{uuid.uuid4().hex[:8]}")
        print(f"uploaded new version to existing pipeline {pid}")
    else:
        p = client.upload_pipeline(pipeline_package_path=OUT, pipeline_name=NAME)
        print(f"uploaded pipeline {NAME} ({getattr(p, 'pipeline_id', p)})")

    try:
        client.create_experiment(name=NAME, description="Amboy NPI-tagger training runs")
        print(f"ensured experiment {NAME}")
    except Exception as e:
        print(f"experiment note: {type(e).__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
