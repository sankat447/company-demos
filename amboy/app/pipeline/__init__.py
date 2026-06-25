"""Amboy NPI-tagger training as an OpenShift AI Data Science Pipeline (KFP v2).

The same stages the in-app console used to run as a thread are here expressed as a
real Kubeflow Pipelines v2 DAG, executed by the OpenShift AI Pipeline Server and
tracked under Experiments and runs. Components run on the amboy image and reuse
app.common / app.compare_agent.training helpers; creds come from config.py defaults
(which match the in-stack MinIO/Postgres), so no secret injection is needed.
"""
