# Amboy NPI-Safe demo — validation + lifecycle.
# Uses a local venv (pyyaml + httpx) when present; run `make setup` once on a
# fresh clone. Falls back to system python3 otherwise.
PYTHON ?= $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)
KUBECTL ?= kubectl

.PHONY: help setup verify verify-cluster build data lint deploy destroy

setup:
	$(shell command -v python3) -m venv .venv && ./.venv/bin/pip install -q --upgrade pip pyyaml httpx && echo "✔ venv ready (.venv)"

help:
	@echo "make data           generate synthetic reports (seeded)"
	@echo "make verify         OFFLINE gate: privacy invariants + metrics + grounding"
	@echo "make build          render + validate the kustomize manifests"
	@echo "make lint           yaml/json/python/bash lint"
	@echo "make verify-cluster LIVE gate: ingest, /detokenize 403, prompt/NPI scan"
	@echo "make deploy|destroy  scoped baremetal deploy/teardown"

data:
	$(PYTHON) data/generate.py

verify: data
	@echo "── privacy invariants ──"      && $(PYTHON) tests/privacy_invariants.py
	@echo "── metrics-engine ──"          && $(PYTHON) tests/test_metrics.py
	@echo "── narrate-only grounding ──"  && $(PYTHON) tests/test_grounding.py
	@echo "✔ make verify GREEN"

build:
	$(KUBECTL) kustomize gitops/manifests >/dev/null && echo "✔ kustomize build OK"

lint:
	@find gitops -name '*.yaml' -print0 | xargs -0 -n1 $(PYTHON) -c "import sys,yaml; list(yaml.safe_load_all(open(sys.argv[1])))" && echo "✔ yaml"
	@find gitops -name '*.json' -print0 | xargs -0 -n1 $(PYTHON) -c "import sys,json; json.load(open(sys.argv[1]))" && echo "✔ json"
	@find app data tests -name '*.py' -print0 | xargs -0 -n1 $(PYTHON) -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" && echo "✔ python"
	@bash -n deploy.sh destroy.sh build/entrypoint.sh tests/e2e.sh && echo "✔ bash"

verify-cluster:
	bash tests/e2e.sh

deploy:
	./deploy.sh

destroy:
	./destroy.sh
