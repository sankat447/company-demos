"""Seed the BASE PII model (Piiranha) into the in-stack MinIO/S3 so the model is
stored locally and served from there (no external/HF traffic). Source is the
image's baked copy (local_files_only -> no network). Idempotent. Run as a one-off
Job (AMBOY_ROLE=seed_base)."""
import os
import sys

from app.common import config, db, objstore

MODEL = os.environ.get("AMBOY_PII_MODEL", "iiiorg/piiranha-v1-detect-personal-information")
BASE_VERSION = os.environ.get("AMBOY_PII_BASE_VERSION", "piiranha-base-v1")


def main() -> int:
    prefix = f"models/base/{BASE_VERSION}/"
    c = objstore.client()
    have = c.list_objects_v2(Bucket=config.S3_BUCKET_DEID, Prefix=prefix).get("KeyCount", 0)
    if have:
        print(f"base model already in S3 ({prefix}, {have} objects)")
    else:
        from huggingface_hub import snapshot_download
        path = snapshot_download(MODEL, local_files_only=True)  # baked cache; no network
        n = 0
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, path)
                c.upload_file(fp, config.S3_BUCKET_DEID, prefix + rel)
                n += 1
        print(f"uploaded base model -> s3://{config.S3_BUCKET_DEID}/{prefix} ({n} files)")
    try:
        with db.connect() as conn:
            db.register_model_version(conn.cursor(), BASE_VERSION, "piiranha (base)", None, 0, prefix)
        print("registered base model version")
    except Exception as e:
        print(f"version register skipped: {type(e).__name__}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
