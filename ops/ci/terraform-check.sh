#!/usr/bin/env bash
set -euo pipefail
terraform fmt -check -recursive infra
for root in bootstrap production github; do
  terraform -chdir="infra/$root" init -backend=false -input=false -lockfile=readonly
  terraform -chdir="infra/$root" validate
done
terraform -chdir=infra/production test
terraform -chdir=infra/bootstrap test
