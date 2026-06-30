# Lessons Learned — NYCHHC-BareMetal

Carried over from the AWS NYCHHC build, the amboy baremetal build, and the
police-department demo. Baked into the code/scripts so we don't re-learn them.

1. **Deterministic router > small-model tool-calling.** The headline asks are answered by
   `agent/react.py → route()` against real Postgres — no LLM. Ported verbatim; it's why
   chat is reliable. The LLM (Claude via Portkey) is an optional fallback only.

2. **Teardown race.** The ArgoCD app has `selfHeal` + (would) re-create objects. `destroy.sh`
   **disables automated sync before deleting the Application**, then label-sweeps, then drops
   schemas/bucket. Deleting the app first without disabling sync re-creates objects mid-teardown.

3. **Bootstrap Jobs must be robust under arbitrary UID.** The mc/boto3 jobs set `HOME=/tmp`
   (an arbitrary UID has no writable HOME); a hung wave-1 Job blocks ALL later ArgoCD sync waves.

4. **`oc start-build --wait`.** `--follow` alone does NOT return non-zero on a failed build, so a
   broken image would silently pass the deploy. Both builds use `--follow --wait`.

5. **`max_tokens` on every Portkey/Anthropic request.** Anthropic-via-Portkey 400s without it.
   `llm/portkey.py` always sends `max_tokens` (+ `x-portkey-provider: anthropic`). Confirmed on
   this stack by the amboy demo.

6. **Internal-registry `:latest` digest caching serves stale images.** KServe bypasses the image
   trigger, so `deploy.sh` Phase 6 pins each InferenceService to the freshly-built digest
   (`oc get istag nychhc:latest -o jsonpath={.image.metadata.name}`) and `application.yaml`
   `ignoreDifferences` + `RespectIgnoreDifferences` keep the pin. Regular Deployments rely on the
   ImageStream `lookupPolicy.local: true` to resolve `:latest` to the digest at admission.

7. **KServe sometimes drops the model ClusterIP** (only the headless `-predictor` remains). We own
   a stable ClusterIP Service per model (`22-noshow-model.yaml`, `23-forecast-model.yaml`)
   selecting `serving.kserve.io/inferenceservice=<name>` + `component=predictor` on `:8080`.

8. **Single-stage UBI python.** The multi-stage `/opt/app-root/lib → lib64` symlink silently
   drops pip packages. `build/Dockerfile` is single-stage.

9. **Joblib unpickle skew.** Train and serve with the SAME sklearn version. The image pins
   `scikit-learn==1.9.0` (the version the committed artifacts were trained with). The predictor
   loads MinIO-first with a baked fallback so it never hard-fails.

10. **Cross-namespace, no proxy gymnastics.** Frontend (`iis-ai-ui`) and backend (`iis-ai-ai`)
    are in different tiers, so a route-name string-replace can't derive the backend URL. The SPA
    talks **same-origin**; nginx proxies `/api/*` to `nychhc-backend.iis-ai-ai.svc` (SSE needs
    `proxy_buffering off`). The MinIO bootstrap Job runs in `iis-ai-ai` (same ns as its image) and
    reaches MinIO over svc DNS — no cross-ns image pull.

11. **`oc exec POD -- python - <<EOF` needs `-i`** or stdin isn't forwarded (silent empty script).

12. **Inline YAML / shell quoting.** Single-quote `cat <<'EOF'` for inline YAML containing `$vars`
    meant for the pod; quote paths/values containing `&` or `#` (the PG password `Demo1234#` is
    URL-escaped to `%23` in the DSN).
