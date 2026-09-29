"""Guards for the CV helper scripts mounted into pd-task-vlm-caption.

Run: python3 -m pytest police-department/tests/test_cv_scripts.py  (or plain python3)
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PIPE = ROOT / "manifests/pipeline"
# LESSONS_LEARNED 17.40: Tekton place-scripts writes every step script, base64-encoded,
# through ONE shell argument -> Linux MAX_ARG_STRLEN (128 KiB) is the ceiling. History
# matches: ~110 KB of scripts failed (~147 KB encoded), 89 KB worked (~119 KB encoded).
MAX_ARG_STRLEN = 131_072
SAFETY_MARGIN = 4_096


def test_configmap_matches_sources():
    cm = (PIPE / "pd-cv-scripts-configmap.yaml").read_text()
    before = cm
    subprocess.run([sys.executable, str(ROOT / "scripts/gen_cv_scripts_configmap.py")], check=True, capture_output=True)
    after = (PIPE / "pd-cv-scripts-configmap.yaml").read_text()
    assert before == after, "pd-cv-scripts-configmap.yaml is stale — run scripts/gen_cv_scripts_configmap.py"


def test_scripts_compile():
    for f in (PIPE / "cv-scripts").glob("*.py"):
        compile(f.read_text(), str(f), "exec")


def test_vlm_caption_inline_scripts_under_arg_max():
    import re
    text = (PIPE / "pd-task-vlm-caption.yaml").read_text()
    blocks = [m.group(1) for m in re.finditer(r"\n    script: \|\n((?:(?: {6}.*)?\n)+)", text)]
    dedented = [re.sub(r"(?m)^ {6}", "", b) for b in blocks]
    encoded = sum((len(b.encode()) + 2) // 3 * 4 + 250 for b in dedented)   # base64 + per-step wrapper
    assert encoded < MAX_ARG_STRLEN - SAFETY_MARGIN, (
        f"place-scripts argument ~{encoded} B (scripts {sum(len(b.encode()) for b in dedented)} B across "
        f"{len(blocks)} steps) exceeds {MAX_ARG_STRLEN - SAFETY_MARGIN} B — move logic into pd-cv-scripts")
    print(f"  place-scripts argument ~{encoded} B of {MAX_ARG_STRLEN} ({len(blocks)} steps)")

if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("PASS", name)
