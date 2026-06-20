"""MinIO/S3 helpers. Raw bucket holds NPI (never read by the LLM path); deid
bucket holds token-only documents."""
from __future__ import annotations

import json

from . import config


def client():
    import boto3  # lazy
    return boto3.client(
        "s3", endpoint_url=config.S3_ENDPOINT,
        aws_access_key_id=config.S3_ACCESS_KEY,
        aws_secret_access_key=config.S3_SECRET_KEY,
        region_name="us-east-1")


def get_json(bucket: str, key: str) -> dict:
    body = client().get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body)


def put_json(bucket: str, key: str, obj: dict) -> None:
    data = json.dumps(obj, indent=2).encode()
    c = client()
    try:                              # prefer SSE; MinIO needs KMS for this
        c.put_object(Bucket=bucket, Key=key, Body=data, ServerSideEncryption="AES256")
    except Exception:
        c.put_object(Bucket=bucket, Key=key, Body=data)
