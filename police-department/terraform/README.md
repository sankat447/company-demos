# police-department/terraform — REFERENCE ONLY

This directory is **not applied** by the demo's bootstrap scripts. The active S3-to-pipeline bridge is the in-cluster CronJob `pd-s3-watcher` (see `manifests/pipeline/pd-s3-watcher-cronjob.yaml`), which polls every 60 s.

If a customer demo needs sub-second clip latency, the Lambda + EventBridge approach in `lambda-s3-bridge.tf.example` is an upgrade path. To enable it:

1. Rename `lambda-s3-bridge.tf.example` to `lambda-s3-bridge.tf`.
2. Set vars:
   ```
   export TF_VAR_eventlistener_url="https://pd-perception-el-pd-cctv.<cluster-domain>/"
   export TF_VAR_aws_region=us-east-1
   ```
3. `terraform init && terraform plan && terraform apply`
4. Disable the in-cluster watcher to avoid double-triggering:
   ```
   oc -n pd-cctv patch cronjob/pd-s3-watcher --type=merge -p '{"spec":{"suspend":true}}'
   ```

The Lambda is intentionally outside the platform repo (`ai-demo-stack-aws`). The platform's Terraform must remain unmodified by this demo.

## Why not the Lambda by default?

- Lambda apply requires AWS-write credentials and IAM role provisioning that fall outside the cluster's GitOps boundary.
- The CronJob is fully observable in OCP (logs, ConfigMap-backed cursor) without leaving the cluster.
- 60 s cadence is more than sufficient for a live demo (uploaders pause briefly for the operator to narrate).
- Teardown is `oc delete` instead of `terraform destroy`.
