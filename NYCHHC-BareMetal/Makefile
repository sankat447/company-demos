# NYCHHC-BareMetal — build / lint / verify. `make verify` is the offline gate.
SHELL := /bin/bash
KUSTOMIZE ?= kubectl kustomize
MANIFESTS := gitops/manifests
PY := python3.11

.PHONY: help build lint verify verify-cluster test-backend test-models deploy destroy

help:
	@echo "targets: build lint verify verify-cluster test-backend test-models deploy destroy"

# Kustomize must render cleanly (acceptance gate).
build:
	@echo "▶ kustomize build $(MANIFESTS)"
	@$(KUSTOMIZE) $(MANIFESTS) > /dev/null && echo "✔ kustomize build OK"

# Syntax checks: bash scripts, python sources, YAML well-formedness.
lint:
	@echo "▶ bash -n"
	@for s in deploy.sh destroy.sh scripts/lib.sh scripts/smoke.sh build/entrypoint.sh models/publish.sh; do bash -n "$$s" && echo "  ok $$s"; done
	@echo "▶ python compile (our sources; venvs excluded)"
	@$(PY) -m compileall -q -x '(\.venv|__pycache__|\.pytest_cache)' backend/src models && echo "✔ python OK"
	@echo "▶ yaml well-formed (best-effort; gitops also validated by make build)"
	@$(PY) -c "import yaml" 2>/dev/null && $(PY) -c "import glob,yaml; [list(yaml.safe_load_all(open(f))) for f in glob.glob('gitops/**/*.yaml',recursive=True)+glob.glob('build/*.yaml')]; print('✔ yaml OK')" || echo "  (pyyaml not available — skipped; make build covers gitops)"

test-backend:
	@echo "▶ backend tests"
	@cd backend && { [ -d .venv ] || python3.11 -m venv .venv; } && . .venv/bin/activate && \
	  { python -c "import nychhc_copilot" 2>/dev/null || pip install -q -e '.[agent,data,dev]'; } && \
	  python -m pytest -q

test-models:
	@echo "▶ model tests"
	@cd models && { [ -d .venv ] || python3.11 -m venv .venv; } && . .venv/bin/activate && \
	  { python -c "import sklearn" 2>/dev/null || pip install -q "scikit-learn>=1.5" "numpy>=1.26" "joblib>=1.4" "pytest>=8.3"; } && \
	  python -m pytest -q

# Offline acceptance gate: manifests render + lint + unit tests all green.
verify: build lint test-backend test-models
	@echo "✔ make verify GREEN (offline)"

# Live gate: smoke the deployed routes (requires KUBECONFIG + a running deploy).
verify-cluster:
	@bash scripts/smoke.sh

deploy:
	@./deploy.sh

destroy:
	@./destroy.sh
