#!/usr/bin/env python3
"""SigV4-signed AppSync GraphQL call as the current IAM principal.
Usage: GQL=<endpoint> AWS_PROFILE=... python3 appsync_iam.py '<query>' '<variables-json>'"""
import json, os, sys, urllib.request, urllib.error
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session

endpoint = os.environ["GQL"]
region = os.environ.get("AWS_REGION", "us-east-1")
query = sys.argv[1]
variables = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

creds = Session().get_credentials()
if creds is None:
    sys.exit("no AWS credentials")
creds = creds.get_frozen_credentials()

body = json.dumps({"query": query, "variables": variables}).encode()
awsreq = AWSRequest(method="POST", url=endpoint, data=body,
                    headers={"Content-Type": "application/json"})
SigV4Auth(creds, "appsync", region).add_auth(awsreq)
req = urllib.request.Request(endpoint, data=body, headers=dict(awsreq.headers), method="POST")
try:
    with urllib.request.urlopen(req) as resp:
        print(resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTPError", e.code, e.read().decode())
    sys.exit(1)
