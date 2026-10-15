#!/usr/bin/env bash
# All command-interpolated inputs are validated before being sent through SSH.
set -euo pipefail
: "${GCP_PROJECT_ID:?}" "${GCP_ZONE:?}" "${PROD_VM:?}"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]+$ ]]
[[ "$GCP_ZONE" =~ ^[a-z0-9-]+$ ]]
[[ "$PROD_VM" =~ ^[a-z][a-z0-9-]+$ ]]
operation="${1:?deploy, rollback or status}"
case "$operation" in
  deploy)
    image="${2:?image digest}"; revision="${3:?commit SHA}"
    [[ "$image" =~ ^[a-z0-9-]+-docker\.pkg\.dev/[a-z0-9-]+/geometrydash-ui-production/web@sha256:[a-f0-9]{64}$ ]]
    [[ "$revision" =~ ^[a-f0-9]{40}$ ]]
    command="/usr/local/lib/geometrydash-ui/release.py deploy $image $revision"
    ;;
  rollback) command="/usr/local/lib/geometrydash-ui/release.py rollback" ;;
  status) command="/usr/local/lib/geometrydash-ui/release.py status" ;;
  *) echo "Unsupported operation" >&2; exit 2 ;;
esac
if [[ "$operation" == status ]]; then
  command="sudo $command"
else
  # systemd owns the transaction if the runner loses its SSH connection.
  unit="geometrydash-ui-release-$(date +%s)-${RANDOM}"
  command="sudo systemd-run --unit=$unit --wait --collect --property=RuntimeMaxSec=600 $command"
fi
gcloud compute ssh "$PROD_VM" --project="$GCP_PROJECT_ID" --zone="$GCP_ZONE" \
  --tunnel-through-iap --quiet --ssh-key-expire-after=15m --command="$command"
