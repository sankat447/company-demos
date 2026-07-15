"""Seed role — generate the two synthetic reports and upload them to the MinIO
raw bucket (idempotent). Run as a one-off Job by deploy.sh (AMBOY_ROLE=seed)."""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import generate  # noqa: E402

from app.common import config, objstore  # noqa: E402


def _ensure_bucket(client, name):
    try:
        client.create_bucket(Bucket=name)
    except Exception:
        pass  # already exists


def main() -> int:
    client = objstore.client()
    for b in (config.S3_BUCKET_RAW, config.S3_BUCKET_DEID):
        _ensure_bucket(client, b)
    rng = random.Random(generate.SEED)
    for year in (2024, 2025):
        report = generate.build_report(year, rng)
        if generate.validate(report):
            print(f"REFUSING upload: unsafe PII in {year}", file=sys.stderr)
            return 1
        objstore.put_json(config.S3_BUCKET_RAW, f"report_{year}.json", report)
        print(f"seeded amboy-raw/report_{year}.json ({len(report['loan_appendix'])} loans)")
    print("seed complete (idempotent).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
