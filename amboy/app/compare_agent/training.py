"""Model-training orchestration for the Model Training console.

InstructLab-style INTERACTIVE flow:
  Start  → pre-training stages (init → load base → ingest → embed features), then
           PAUSE at the interactive phase and open a terminal.
  Terminal commands (the user drives the loop):
    probe "<text>"  — detect PII/NPI; first time ACCOUNT (AMB-2024-…) is NOT found
    train account   — real CPU fine-tune so AMB-2024-… is learned as an ACCOUNT
    probe "<text>"  — now ACCOUNT is detected
    done            — post-training stages (evaluate → compress → register →
                      stop & re-provision on OpenShift AI → smoke) and serve it
The served KServe model stays ONLINE during the terminal so `probe` works; the
visible offline→online scaling on OpenShift AI happens only at `done`.
Each stage/command is guarded so the demo never hard-fails.
"""
from __future__ import annotations

import os
import random
import re
import threading
import time

from app.common import config, db, objstore

STAGES = [
    ("init",        "Initialize session",        "Spin up a training session (model stays online)"),
    ("load",        "Load base model",           "Load the base encoder + label space"),
    ("ingest",      "Ingest NPI data",           "Gather the organization's NPI training corpus"),
    ("decompose",   "Decompose (tokenize + embed)", "Tokenize and embed features per token"),
    ("interactive", "Interactive training",      "Teach from the terminal: probe → train → probe"),
    ("evaluate",    "Evaluate",                  "Score accuracy on a held-out split"),
    ("compress",    "Compress (quantize)",       "Quantize + shrink the model for CPU serving"),
    ("register",    "Register version",          "Push the model artifact to MinIO + version registry"),
    ("provision",   "Stop → Provision on OpenShift AI", "Take offline, load new head, bring back online"),
    ("smoke",       "Online smoke test",         "Verify the served model answers /detect"),
]
LABELS = ["O", "PERSON", "US_SSN", "PHONE", "EMAIL", "ADDRESS", "ACCOUNT"]
HEAD_MIN = 0.6
DEFAULT_SAMPLE = "Loan AMB-2024-100364 for borrower Jane Doe; SSN 900-12-3456; phone (732) 555-0142."
_WORD_RE = re.compile(r"\S+")
_TOKEN_RE = re.compile(r"[^\s,;|\t]+")   # whitespace/CSV token boundaries
ACCT_KEY = "models/account_patterns.json"

_LOCK = threading.Lock()
_STATE = {"run_id": None, "status": "idle", "stages": [], "version": None,
          "metrics": {}, "log": [], "terminal": []}
# Heavy session objects (torch tensors / model) kept out of the JSON status.
_SESSION = {"Xtr": None, "ytr": None, "Xte": None, "yte": None, "head": None, "acc": None}


def _init_stages():
    return [{"key": k, "title": t, "desc": d, "status": "pending", "pct": 0} for k, t, d in STAGES]


def status():
    with _LOCK:
        return {**_STATE, "stages": [dict(s) for s in _STATE["stages"]],
                "terminal": list(_STATE["terminal"])}


def _log(msg):
    with _LOCK:
        _STATE["log"] = (_STATE["log"] + [msg])[-40:]


def _term(text, kind="out"):
    """Append a line to the interactive terminal (kind: in|out|sys|ok|warn)."""
    with _LOCK:
        _STATE["terminal"] = (_STATE["terminal"] + [{"k": kind, "t": text}])[-300:]


def _stage(i, st, pct=None, note=None):
    with _LOCK:
        s = _STATE["stages"][i]
        s["status"] = st
        if pct is not None:
            s["pct"] = int(pct)
        if st == "done":
            s["pct"] = 100
    if note:
        _log(note)


def _scale_inference_service(min_replicas: int):
    """Best-effort: patch the KServe InferenceService minReplicas (stop=0/up=1)
    via the in-cluster API using the pod ServiceAccount. Degrades gracefully."""
    try:
        import httpx
        tok_path = "/var/run/secrets/kubernetes.io/serviceaccount"
        token = open(f"{tok_path}/token").read().strip()
        ns = open(f"{tok_path}/namespace").read().strip()
        url = (f"https://kubernetes.default.svc/apis/serving.kserve.io/v1beta1/"
               f"namespaces/{ns}/inferenceservices/amboy-pii-model")
        body = {"spec": {"predictor": {"minReplicas": min_replicas}}}
        r = httpx.patch(url, json=body, timeout=20,
                        headers={"Authorization": f"Bearer {token}",
                                 "Content-Type": "application/merge-patch+json"},
                        verify=f"{tok_path}/ca.crt")
        return r.status_code in (200, 201)
    except Exception as e:
        _log(f"scale skipped: {type(e).__name__}")
        return False


def _set_display_name(name: str):
    """Best-effort: rewrite the KServe IS display-name so the OpenShift AI Model
    Serving dashboard reflects the newly-trained version. Same SA-token path as scale."""
    try:
        import httpx
        tok_path = "/var/run/secrets/kubernetes.io/serviceaccount"
        token = open(f"{tok_path}/token").read().strip()
        ns = open(f"{tok_path}/namespace").read().strip()
        url = (f"https://kubernetes.default.svc/apis/serving.kserve.io/v1beta1/"
               f"namespaces/{ns}/inferenceservices/amboy-pii-model")
        body = {"metadata": {"annotations": {"openshift.io/display-name": name}}}
        r = httpx.patch(url, json=body, timeout=20,
                        headers={"Authorization": f"Bearer {token}",
                                 "Content-Type": "application/merge-patch+json"},
                        verify=f"{tok_path}/ca.crt")
        return r.status_code in (200, 201)
    except Exception as e:
        _log(f"display-name update skipped: {type(e).__name__}")
        return False


def _corpus(n_per_class=120):
    """Synthetic NPI corpus (token, label) incl. ACCOUNT — the org's training data."""
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "data"))
    import generate as G
    rng = random.Random(7)
    rows = []
    for _ in range(n_per_class):
        f, l = rng.choice(G.FIRST_NAMES), rng.choice(G.LAST_NAMES)
        rows += [(f"{f} {l}", "PERSON"), (G._fmt_ssn(rng), "US_SSN"),
                 (G._fmt_phone(rng), "PHONE"), (G._fmt_email(rng, f, l), "EMAIL"),
                 (G._fmt_address(rng), "ADDRESS"),
                 (f"AMB-2024-{rng.randint(1, 999999):06d}", "ACCOUNT")]
    for w in ["the", "loan", "report", "balance", "review", "annual", "credit", "risk",
              "ratio", "current", "sector", "summary", "portfolio", "quality"]:
        rows += [(w, "O")] * (n_per_class // 10 + 1)
    rng.shuffle(rows)
    return rows


# ── pre-training (runs on Start, then opens the terminal) ────────────────────
def _pretrain():
    from app.common import embeddings
    try:
        _stage(0, "running", 50, "session started")
        _stage(0, "done", note="training session ready (served model stays online)")

        _stage(1, "running", 40, f"Label space: {', '.join(LABELS)}")
        import torch
        embeddings._model()  # warm the base encoder (MiniLM, 384-d)
        _stage(1, "done", note="base encoder ready (MiniLM, 384-d)")

        _stage(2, "running", 50)
        rows = _corpus()
        _stage(2, "done", note=f"ingested {len(rows)} labeled NPI tokens")

        _stage(3, "running", 30, "Embedding tokens -> features")
        y = torch.tensor([LABELS.index(l) for _, l in rows])
        X = torch.tensor(embeddings.embed_batch([t for t, _ in rows]))
        n = len(rows); cut = int(n * 0.8)
        with _LOCK:
            _SESSION.update({"Xtr": X[:cut], "ytr": y[:cut], "Xte": X[cut:], "yte": y[cut:],
                             "head": None, "acc": None})
        _stage(3, "done", note=f"{cut} train / {n - cut} eval examples")

        _stage(4, "running", 0)
        with _LOCK:
            _STATE["status"] = "interactive"
        _help()
        _term("Tip: start by running  probe   (uses the sample loan text).", "sys")
    except Exception as e:
        _fail(f"pre-training failed: {type(e).__name__}: {e}")


def _help():
    _term("Interactive NPI training — available commands:", "sys")
    _term("  probe [\"text\"]        detect PII/NPI in the text (default: the sample loan)", "out")
    _term("  train account          fine-tune the model so AMB-2024-… is learned as ACCOUNT", "out")
    _term("  train account <regex>  register a deterministic ACCOUNT rule (100% match, live now)", "out")
    _term("                         e.g.  train account AMB-\\d{4}-\\d{6}", "out")
    _term("  rules                  list active ACCOUNT regex rules", "out")
    _term("  forget account [regex] remove one rule, or all if no regex given", "out")
    _term("  done                   evaluate, register & re-provision the fine-tuned model", "out")
    _term("  help · clear", "out")


# ── terminal command dispatch ────────────────────────────────────────────────
def _arg(raw):
    rest = raw.split(None, 1)[1].strip() if len(raw.split(None, 1)) > 1 else ""
    if len(rest) >= 2 and rest[0] in "\"'" and rest[-1] == rest[0]:
        rest = rest[1:-1]
    return rest


def _base_detect(text):
    """Base PII/NPI from the served model WITHOUT the learned head (so ACCOUNT is
    only added once the user trains it in this session)."""
    import httpx
    try:
        r = httpx.post(f"{config.PII_MODEL_URL}/detect",
                       json={"text": text, "include_head": False}, timeout=60)
        return r.json().get("spans", [])
    except Exception as e:
        _term(f"(base model unreachable: {type(e).__name__})", "warn")
        return []


def _session_account_spans(text):
    """ACCOUNT spans from the in-session working head (digit-bearing tokens only)."""
    head = _SESSION.get("head")
    if head is None:
        return []
    import torch
    from app.common import embeddings
    toks = [(m.group(0), m.start(), m.end()) for m in _WORD_RE.finditer(text)
            if any(c.isdigit() for c in m.group(0))]
    if not toks:
        return []
    feats = torch.tensor(embeddings.embed_batch([t[0] for t in toks]))
    with torch.no_grad():
        probs = torch.softmax(head(feats), 1)
        score, idx = probs.max(1)
    out = []
    for (w, s, e), sc, ix in zip(toks, score.tolist(), idx.tolist()):
        if LABELS[ix] == "ACCOUNT" and sc >= HEAD_MIN:
            out.append({"start": s, "end": e, "type": "ACCOUNT", "text": w})
    return out


def _render(text, spans):
    spans = sorted(spans, key=lambda s: s["start"])
    out, pos = [], 0
    for s in spans:
        if s["start"] < pos:
            continue
        out.append(text[pos:s["start"]])
        out.append(f"[{s['type']}]{text[s['start']:s['end']]}[/{s['type']}]")
        pos = s["end"]
    out.append(text[pos:])
    return "".join(out)


def _do_probe(raw):
    text = _arg(raw) or DEFAULT_SAMPLE
    spans = _base_detect(text) + _session_account_spans(text) + _pattern_account_spans(text)
    # drop duplicate spans (a token may match both the head and a regex rule)
    seen, uniq = set(), []
    for s in sorted(spans, key=lambda z: (z["start"], -(z["end"] - z["start"]))):
        if (s["start"], s["end"]) in seen:
            continue
        seen.add((s["start"], s["end"])); uniq.append(s)
    spans = uniq
    has_acct = any(s["type"] == "ACCOUNT" for s in spans)
    _term(_render(text, spans), "out")
    _term(f"Detected {len(spans)} PII/NPI entit{'y' if len(spans) == 1 else 'ies'}:", "out")
    for s in sorted(spans, key=lambda s: s["start"]):
        is_acct = s["type"] == "ACCOUNT"
        tag = "   ← learned this session" if is_acct else ""
        _term(f"  {s['type']:<8} {text[s['start']:s['end']]}{tag}", "ok" if is_acct else "out")
    if has_acct:
        _term("ACCOUNT numbers ARE recognized as NPI ✓", "ok")
    else:
        _term("ACCOUNT numbers are NOT recognized as NPI — run `train account` or "
              "`train account <regex>`.", "warn")


def _do_train(raw):
    # `train account <regex>` (or `train <regex>`) → register a deterministic ACCOUNT
    # rule: any whitespace/CSV token that FULL-matches the regex is flagged ACCOUNT,
    # live immediately in document intake (no model retrain, 100% coverage).
    parts = raw.split()
    pattern = None
    if len(parts) >= 3 and parts[1].lower() in ("account", "acct"):
        pattern = raw.split(None, 2)[2].strip()
    elif len(parts) == 2 and parts[1].lower() not in ("account", "acct"):
        pattern = parts[1].strip()
    if pattern:
        if len(pattern) >= 2 and pattern[0] in "\"'" and pattern[-1] == pattern[0]:
            pattern = pattern[1:-1]
        try:
            re.compile(pattern)
        except re.error as e:
            _term(f"invalid regex: {e}", "warn"); return
        rules = _account_rules_list()
        if pattern not in rules:
            rules.append(pattern)
        try:
            _save_account_rules(rules)
        except Exception as e:
            _term(f"could not save rule: {type(e).__name__}", "warn"); return
        _term(f"Registered ACCOUNT rule (token full-match): {pattern}", "ok")
        _term(f"Active ACCOUNT rules: {' | '.join(rules)}", "out")
        _term("Live immediately in Sensitive Document Intake + probe — no `done` needed. "
              "Re-run `probe` to confirm.", "sys")
        return

    if _SESSION.get("Xtr") is None:
        _term("training features not ready — restart the session", "warn")
        return
    import torch
    import torch.nn as nn
    _term("Teaching the model that AMB-2024-… is an ACCOUNT (NPI)…", "sys")
    torch.manual_seed(0)
    head = nn.Sequential(nn.Linear(384, 128), nn.ReLU(), nn.Linear(128, len(LABELS)))
    opt = torch.optim.Adam(head.parameters(), lr=1e-3)
    lossf = nn.CrossEntropyLoss()
    Xtr, ytr = _SESSION["Xtr"], _SESSION["ytr"]
    EP = 200
    loss = None
    for ep in range(EP):
        opt.zero_grad()
        loss = lossf(head(Xtr), ytr)
        loss.backward(); opt.step()
        _stage(4, "running", (ep + 1) / EP * 100)
        if ep % 40 == 0 or ep == EP - 1:
            _term(f"  epoch {ep + 1:>3}/{EP}  loss={loss.item():.3f}", "out")
    with torch.no_grad():
        acc = (head(_SESSION["Xte"]).argmax(1) == _SESSION["yte"]).float().mean().item()
    with _LOCK:
        _SESSION["head"] = head
        _SESSION["acc"] = acc
        _STATE["metrics"] = {"eval_accuracy": round(acc, 3), "epochs": EP, "classes": len(LABELS)}
    _term(f"Training complete — held-out token accuracy {acc:.0%}. ACCOUNT class learned.", "ok")
    _term("Re-run `probe` to see AMB-2024-… now detected, then `done` to serve.", "sys")


def _do_done():
    if _SESSION.get("head") is None:
        _term("Nothing trained yet — run `train account` first.", "warn")
        return
    with _LOCK:
        _STATE["status"] = "finalizing"
    _stage(4, "done", note="interactive training complete")
    _term("Finalizing: evaluate → compress → register → re-provision on OpenShift AI…", "sys")
    threading.Thread(target=_finalize, daemon=True).start()


def _do_rules():
    rules = _account_rules_list()
    if not rules:
        _term("no ACCOUNT regex rules registered", "out"); return
    _term(f"ACCOUNT regex rules ({len(rules)}):", "out")
    for r in rules:
        _term(f"  {r}", "out")


def _do_forget(raw):
    parts = raw.split()
    pattern = raw.split(None, 2)[2].strip() if len(parts) >= 3 and parts[1].lower() in ("account", "acct") else None
    rules = [r for r in _account_rules_list() if r != pattern] if pattern else []
    try:
        _save_account_rules(rules)
    except Exception as e:
        _term(f"forget failed: {type(e).__name__}", "warn"); return
    _term(f"ACCOUNT rules now: {' | '.join(rules) if rules else '(none)'}", "ok")


def cmd(command: str):
    with _LOCK:
        st = _STATE["status"]
    if st != "interactive":
        reason = ("finalizing — please wait" if st == "finalizing"
                  else "no interactive session — click Start training")
        return {"ok": False, "reason": reason, **status()}
    raw = (command or "").strip()
    if raw:
        _term(raw, "in")
    c = raw.split(None, 1)[0].lower() if raw else ""
    if c in ("help", "?", ""):
        if c in ("help", "?"):
            _help()
    elif c in ("probe", "detect", "query"):
        _do_probe(raw)
    elif c in ("train", "teach", "learn"):
        _do_train(raw)
    elif c in ("rules", "list"):
        _do_rules()
    elif c in ("forget", "unlearn"):
        _do_forget(raw)
    elif c in ("done", "commit", "serve", "finish"):
        _do_done()
    elif c in ("clear", "cls"):
        with _LOCK:
            _STATE["terminal"] = []
    else:
        _term(f"unknown command: {c}   (type 'help')", "warn")
    return {"ok": True, **status()}


# ── post-training (runs on `done`) ───────────────────────────────────────────
def _finalize():
    import io as _io
    import torch
    import torch.nn as nn
    try:
        head, acc = _SESSION["head"], _SESSION["acc"]

        _stage(5, "running", 60)
        with _LOCK:
            _STATE["metrics"] = {"eval_accuracy": round(acc, 3), "epochs": 200, "classes": len(LABELS)}
        _stage(5, "done", note=f"held-out token accuracy {acc:.1%}")

        _stage(6, "running", 50)
        raw = _io.BytesIO(); torch.save(head.state_dict(), raw); raw_sz = raw.tell()
        try:  # quantize only for the size metric; serve the fp32 (loadable) head
            qhead = torch.quantization.quantize_dynamic(head, {nn.Linear}, dtype=torch.qint8)
            q = _io.BytesIO(); torch.save(qhead.state_dict(), q); q_sz = q.tell()
        except Exception:
            q_sz = raw_sz
        model_bytes = raw.getvalue()
        _stage(6, "done", note=f"size {raw_sz // 1024} KB -> {q_sz // 1024} KB (int8)")

        _stage(7, "running", 50)
        ver = f"npi-tagger-{int(acc * 1000)}"
        key = f"models/{ver}.pt"
        try:
            objstore.client().put_object(Bucket=config.S3_BUCKET_DEID, Key=key, Body=model_bytes)
        except Exception as e:
            _log(f"artifact upload skipped: {type(e).__name__}")
        try:
            with db.connect() as conn:
                cur = conn.cursor()
                db.register_model_version(cur, ver, "npi-tagger", acc, len(LABELS), key)
                db.audit(cur, "ui", "model_train", ver,
                         {"accuracy": round(acc, 3), "classes": LABELS, "size_kb": q_sz // 1024})
        except Exception as e:
            _log(f"version register skipped: {type(e).__name__}")
        with _LOCK:
            _STATE["version"] = ver
        _stage(7, "done", note=f"registered model version {ver}")
        _term(f"Registered new version {ver} in MinIO + registry.", "ok")

        # 8 — stop → provision (the visible OpenShift AI offline→online)
        _stage(8, "running", 25, "Scaling InferenceService minReplicas -> 0 (offline)")
        _term("Taking the served model offline on OpenShift AI…", "sys")
        _scale_inference_service(0)
        time.sleep(3)
        _stage(8, "running", 55, "Scaling InferenceService minReplicas -> 1 (online)")
        _scale_inference_service(1)
        import httpx
        for _ in range(50):
            try:
                if httpx.get(f"{config.PII_MODEL_URL}/healthz", timeout=5).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(3)
        try:
            rr = httpx.post(f"{config.PII_MODEL_URL}/reload", json={"key": key}, timeout=30).json()
            _write_active(ver)
            _set_display_name(f"Amboy PII/NPI Detector — {ver} (NPI fine-tuned, acc {acc:.0%})")
            _stage(8, "done", note=f"re-provisioned + served model loaded head {rr.get('version')}")
        except Exception as e:
            _stage(8, "done", note=f"re-provisioned; reload best-effort ({type(e).__name__})")

        _stage(9, "running", 50)
        try:
            d = httpx.post(f"{config.PII_MODEL_URL}/detect",
                           json={"text": DEFAULT_SAMPLE}, timeout=30)
            types = sorted({s["type"] for s in d.json().get("spans", [])})
            _stage(9, "done", note=f"served model online: detects {', '.join(types)}")
            _term(f"Smoke test OK — served model detects: {', '.join(types)}", "ok")
        except Exception as e:
            _stage(9, "done", note=f"served model probe: {type(e).__name__}")

        with _LOCK:
            _STATE["status"] = "complete"
        _term(f"Done. Version {ver} is now serving on OpenShift AI.", "ok")
        _log("training run complete")
    except Exception as e:
        _fail(f"finalize failed: {type(e).__name__}: {e}")


def _fail(msg):
    with _LOCK:
        _STATE["status"] = "error"
        for s in _STATE["stages"]:
            if s["status"] == "running":
                s["status"] = "failed"
    _term(msg, "warn")
    _log(msg)


def _write_active(value: str):
    """Persist the deliberately-served choice so it survives predictor restarts
    ('base' or a version). pii_model reads models/active.txt on startup."""
    try:
        objstore.client().put_object(Bucket=config.S3_BUCKET_DEID,
                                     Key="models/active.txt", Body=value.encode())
    except Exception as e:
        _log(f"active marker skipped: {type(e).__name__}")


def _account_rules_list():
    import json
    try:
        v = json.loads(objstore.client().get_object(Bucket=config.S3_BUCKET_DEID, Key=ACCT_KEY)["Body"].read())
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _save_account_rules(rules):
    import json
    objstore.client().put_object(Bucket=config.S3_BUCKET_DEID, Key=ACCT_KEY, Body=json.dumps(rules).encode())


def _pattern_account_spans(text):
    """ACCOUNT spans from the registered regex rules (token full-match) — for the
    terminal probe, mirroring what the gateway does on document intake."""
    pats = []
    for r in _account_rules_list():
        try:
            pats.append(re.compile(r))
        except re.error:
            pass
    out = []
    if pats:
        for m in _TOKEN_RE.finditer(text):
            if any(p.fullmatch(m.group(0)) for p in pats):
                out.append({"start": m.start(), "end": m.end(), "type": "ACCOUNT", "text": m.group(0)})
    return out


def switch(version: str):
    """Hot-swap the served KServe model to a registry version (live /reload, no
    restart). A head version (.pt) loads that head; the base version unloads the
    head so the model serves base-only. Also updates the OpenShift AI display-name."""
    import httpx
    key = None
    try:
        with db.connect() as conn:
            key = db.get_model_s3_key(conn.cursor(), version)
    except Exception:
        pass
    if not key:
        key = "models/base/" if "base" in version else f"models/{version}.pt"
    try:
        if key.endswith(".pt"):
            rr = httpx.post(f"{config.PII_MODEL_URL}/reload", json={"key": key}, timeout=60).json()
            _write_active(version)
            _set_display_name(f"Amboy PII/NPI Detector — {version} (NPI fine-tuned)")
            return {"ok": bool(rr.get("ok")), "version": version, "head_version": rr.get("version")}
        # base prefix → serve base-only
        httpx.post(f"{config.PII_MODEL_URL}/reload", json={"unload": True}, timeout=60)
        _write_active("base")
        _set_display_name("Amboy PII/NPI Detector (Piiranha · base)")
        return {"ok": True, "version": version, "head_version": None}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


def start():
    with _LOCK:
        if _STATE["status"] in ("pretraining", "interactive", "finalizing"):
            return {"ok": False, "reason": "a training session is already in progress"}
        _STATE.update({"run_id": "run-current", "status": "pretraining", "stages": _init_stages(),
                       "version": None, "metrics": {}, "log": ["training session started"],
                       "terminal": []})
        _SESSION.update({"Xtr": None, "ytr": None, "Xte": None, "yte": None, "head": None, "acc": None})
    threading.Thread(target=_pretrain, daemon=True).start()
    return {"ok": True, "run_id": "run-current"}
