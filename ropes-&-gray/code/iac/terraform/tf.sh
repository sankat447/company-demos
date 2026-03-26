#!/usr/bin/env bash
# Safe terraform wrapper - always inits first
cd "$(dirname "$0")"
terraform init -upgrade -input=false > /dev/null 2>&1
terraform "$@"
