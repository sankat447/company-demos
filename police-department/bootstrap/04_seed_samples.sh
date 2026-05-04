#!/usr/bin/env bash
# =============================================================================
#  04_seed_samples.sh — drop a sample clip into S3 to trigger the pipeline.
#
#  Modes:
#    SAMPLE_LOCAL=/path/to/clip.mp4 -> upload that file
#    (default)                       -> generate a 6-second synthetic clip with
#                                       ffmpeg via an ephemeral pod and upload
#
#  The synthetic option is useful when the operator does not have a CCTV
#  clip handy. It produces a stationary scene that the VLM still describes
#  legibly enough to demonstrate the pipeline plumbing end-to-end.
# =============================================================================
SCRIPT_NAME=04_seed_samples
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — seed sample clip"
require_cmd aws

S3_KEY="clips/police-department/sample-$(date -u +%Y%m%dT%H%M%SZ).mp4"
S3_URI="s3://$PD_BUCKET/$S3_KEY"

if [ -n "${SAMPLE_LOCAL:-}" ]; then
  [ -f "$SAMPLE_LOCAL" ] || { log_err "SAMPLE_LOCAL not found: $SAMPLE_LOCAL"; exit 1; }
  log_info "uploading $SAMPLE_LOCAL to $S3_URI"
  aws s3 cp "$SAMPLE_LOCAL" "$S3_URI"
else
  log_info "generating synthetic 6s clip..."
  TMP=$(mktemp -d)
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -hide_banner -loglevel error \
      -f lavfi -i "color=c=black:s=640x360:d=6" \
      -vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='pd-cctv synthetic clip %{pts:hms}':x=20:y=20:fontsize=24:fontcolor=white" \
      -an -c:v libx264 -pix_fmt yuv420p \
      "$TMP/clip.mp4" || \
    ffmpeg -hide_banner -loglevel error \
      -f lavfi -i "color=c=black:s=640x360:d=6" \
      -an -c:v libx264 -pix_fmt yuv420p \
      "$TMP/clip.mp4"
    log_info "uploading synthetic clip to $S3_URI"
    aws s3 cp "$TMP/clip.mp4" "$S3_URI"
    rm -rf "$TMP"
  else
    log_warn "ffmpeg not available locally; skipping synthetic-clip generation."
    log_warn "Provide SAMPLE_LOCAL=<path-to-mp4> and re-run."
    exit 1
  fi
fi

log_ok "uploaded: $S3_URI"
log_info "the pd-s3-watcher CronJob will pick it up within 60s and trigger the pipeline."
log_info "next: oc -n pd-cctv get pipelineruns -w"
