"""Compile the NPI-tagger pipeline to KFP v2 IR and upload it to the OpenShift AI
Pipeline Server, then ensure the `amboy-npi-tagger` Experiment exists. Runs in-cluster
as a one-off Job (amboy image, SA `amboy`) — the SA token passes the DSP oauth-proxy
(it can `get` the ds-pipeline route) and the service-CA validates TLS."""
import os
import sys
import uuid

sys.path.insert(0, "/app")

import kfp
from kfp import compiler

from app.pipeline.npi_tagger_pipeline import npi_tagger

NAME = "amboy-npi-tagger"
OUT = "/tmp/amboy_npi_tagger.yaml"
HOST = os.environ.get("DSP_HOST", "https://ds-pipeline-amboy-dsp.iis-ai-ai.svc:8443")
TOKEN = open("/var/run/secrets/kubernetes.io/serviceaccount/token").read().strip()
CA = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"


def main() -> int:
    compiler.Compiler().compile(npi_tagger, OUT)
    print(f"compiled pipeline -> {OUT}")

    client = kfp.Client(host=HOST, existing_token=TOKEN, ssl_ca_cert=CA)

    pid = None
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
