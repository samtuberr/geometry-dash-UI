#!/usr/bin/env bash
set -euo pipefail
for name in GCP_PROJECT_ID GCP_REGION GCP_ZONE PROD_DOMAIN; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing production environment variable: $name. Follow PRODUCTION_SETUP.md." >&2
    exit 1
  fi
done
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]+$ ]]
[[ "$GCP_REGION" =~ ^[a-z0-9-]+$ ]]
[[ "$GCP_ZONE" == "$GCP_REGION"-* ]]
[[ "$PROD_DOMAIN" =~ ^[a-z0-9.-]+$ && "$PROD_DOMAIN" == *.* ]]
[[ "${GITHUB_REF:-}" == refs/heads/main ]] || { echo 'Production requires main.' >&2; exit 1; }
