# Amboy NPI-Safe demo (AWS) — validation + lifecycle.
# App code/tests are single-sourced in ../amboy-baremetal; offline gates run there.
BASE ?= ../amboy-baremetal
PYTHON ?= $(shell [ -x $(BASE)/.venv/bin/python ] && echo $(BASE)/.venv/bin/python || echo python3)
KUBECTL ?= kubectl

.PHONY: help verify verify-cluster build lint deploy destroy reset

help:
	@echo "make verify         OFFLINE gate (runs in $(BASE)): privacy + metrics + grounding"
	@echo "make build          render + validate the AWS kustomize overlay"
	@echo "make lint           yaml/json/python/bash lint (AWS files)"
	@echo "make verify-cluster LIVE gate: ingest, /detokenize 403, prompt/NPI scan, audit"
	@echo "make deploy|destroy|reset  scoped AWS deploy / teardown / between-demo reset"

verify:
	$(MAKE) -C $(BASE) verify

build:
	$(KUBECTL) kustomize gitops/manifests >/dev/null && echo "✔ kustomize build OK (AWS overlay)"

lint:
	@find gitops tekton build -name '*.yaml' -print0 \
	  | xargs -0 -n1 $(PYTHON) -c "import sys,yaml; list(yaml.safe_load_all(open(sys.argv[1])))" && echo "✔ yaml"
	@find gitops -name '*.json' -print0 | xargs -0 -n1 $(PYTHON) -c "import sys,json; json.load(open(sys.argv[1]))" && echo "✔ json"
	@$(PYTHON) -c "import ast; ast.parse(open('build/compile_aws.py').read())" && echo "✔ python"
	@bash -n deploy.sh destroy.sh demo-reset.sh tests/e2e.sh && echo "✔ bash"

verify-cluster:
	bash tests/e2e.sh

deploy:
	./deploy.sh

destroy:
	./destroy.sh

reset:
	./demo-reset.sh
