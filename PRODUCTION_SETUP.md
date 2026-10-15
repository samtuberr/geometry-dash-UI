# geometrydash-ui: production setup and operations

This is the setup guide for the **implemented production configuration**. Everything is prepared in this repository; account connection and live deployment happen when you run the steps below. The existing meshseg project is unrelated. Use a **new, billing-enabled GCP project** exclusively for geometrydash-ui production.

Only production is active in the code. Dev and staging examples are commented out or use an inactive `.example` extension. [The earlier deployment design](GCP_DEPLOYMENT.md) and [Hebrew explanation](GCP_DEPLOYMENT_HE.html) describe the later multi-environment/HA expansion; they are not the current provisioning instructions.

## What is included

| Area | Implementation |
| --- | --- |
| App | Multi-stage Docker build; digest-pinned Node and non-root nginx bases; read-only container |
| Production | One standard Debian 12 `e2-small` VM, 20 GiB balanced disk, static IPv4, dedicated VPC/subnet |
| Access | Public 80/443; SSH only over IAP with OS Login; container ports bind to localhost |
| HTTPS | Host nginx, Let's Encrypt via Certbot, automatic renewal and expiry alerts |
| Release | Test the built container, export it, publish that exact image, deploy by immutable registry digest |
| Recovery | Blue/green slots, durable transaction, automatic fail-back, manual rollback and digest-based rebuild recovery |
| State | Separate private, versioned GCS buckets for bootstrap, production and GitHub configuration |
| Identity | Separate runtime, publisher, deployer, infrastructure and read-only drift service accounts; keyless GitHub federation |
| Monitoring | HTTPS uptime from multiple regions, CPU/memory/disk and missing-agent alerts, certificate expiry, dashboard and Ops Agent logs |
| Cost | One VM; no GKE, load balancer, Cloud NAT or inactive environment running; optional alerts-only billing budget |

**Availability boundary:** two release slots on one VM protect releases, not host/zone availability. This setup has a single point of failure. A two-zone MIG and load balancer remain a later, separately costed change.

## 1. Supply your account settings

Install Terraform **1.16.6**, Google Cloud CLI, GitHub CLI and Python 3 on your administration machine. Node 24 and Docker are needed for local application/CI checks, not for Terraform setup. Commands below use Bash from the repository root; Cloud Shell or WSL are suitable.

Create a new project in the GCP console, link your billing/trial account, and record its ID and numeric project number. Your existing project must not be selected. Sharing a billing account shares remaining trial credit; it does not connect application resources.

Authenticate locally:

```bash
gcloud auth login
gcloud auth application-default login
gh auth login
```

The bootstrap operator needs permission to enable APIs, manage this new project's IAM/service accounts/WIF/registry/state/logging, and provision its resources. A project Owner can perform the one-time bootstrap. CI does **not** receive Owner or project IAM administrator. Configuring the optional billing budget additionally requires budget permissions on the billing account.

Read your IDs:

```bash
gcloud projects describe YOUR_NEW_PROJECT_ID --format='value(projectNumber)'
gh api repos/YOUR_OWNER/YOUR_REPOSITORY --jq '{repository_id: .id, owner_id: .owner.id}'
```

Copy and edit **one settings file**:

```bash
cp infra/account.example.json infra/account.json
# Edit infra/account.json with your project, GitHub IDs, domain and email.
python3 ops/configure.py infra/account.json
```

Use the exact GitHub owner/repository casing. Keep `enable_gcp_deployments` **false** until setup is complete. `billing_account_id` may stay empty; fill it to provision the project budget. `monthly_budget_usd` is an alert threshold, not a price estimate or spending cap. `admin_members` grants the listed humans VM root administration through OS Login.

The generator writes ignored local Terraform inputs and backend configuration. It makes no API calls. Use `--force` only when intentionally regenerating those local files. All three roots and GitHub variables derive from the same settings, avoiding region/domain mismatches. No service-account key JSON is required.

## 2. Bootstrap identities, registry and state

Run these using your administrator identity, not a CI service account:

```bash
terraform -chdir=infra/bootstrap init -input=false
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
```

Inspect every plan before applying. Bootstrap enables APIs and creates the registry, five service accounts, federation and IAM, state buckets, seven-day default log retention, and optionally the budget. It does not create another environment.

The first apply uses local state because its state bucket does not exist yet. Immediately migrate that state to its own bucket:

```bash
cp infra/bootstrap/backend.tf.example infra/bootstrap/backend.tf
terraform -chdir=infra/bootstrap init -migrate-state -backend-config=bootstrap.backend.hcl
terraform -chdir=infra/bootstrap state list
terraform -chdir=infra/bootstrap output
```

Answer Terraform's state-migration prompt after checking the destination. Keep any local state backup secure until migration is confirmed; do not commit it. The production CI identity can access **only the production state bucket**, not bootstrap/GitHub state. Do not copy, import or reference the unrelated project's Terraform state.

Bootstrap is intentionally administered locally. Changing trust/IAM through the application deployment identity would defeat the separation.

## 3. Provision production and connect DNS

```bash
terraform -chdir=infra/production init -input=false -backend-config=production.backend.hcl
terraform -chdir=infra/production plan -out=production.tfplan
terraform -chdir=infra/production apply production.tfplan
terraform -chdir=infra/production output
```

Create an **A record** for `domain` pointing to `public_ipv4`. DNS hosting/domain purchase is intentionally outside this repository; use your DNS provider. Remove any stale AAAA record for this hostname because the VM has no configured public IPv6. Keep the DNS record direct to the VM during initial certificate issuance. If a CAA record exists, it must permit Let's Encrypt.

Wait for VM bootstrap to finish. Substitute the configured values in these commands:

```bash
gcloud compute ssh geometrydash-ui-production \
  --project=YOUR_NEW_PROJECT_ID --zone=YOUR_ZONE --tunnel-through-iap \
  --command='sudo journalctl -u google-startup-scripts.service --no-pager -n 100'
```

The first public HTTP response redirects to HTTPS; HTTPS becomes available on the first successful release, after Certbot validates DNS. Uptime checks can report failure before that release. Port 80 remains open for certificate renewals and redirects; SSH is not public.

If bootstrap is incomplete, correct the cause and rerun it through IAP:

```bash
gcloud compute ssh geometrydash-ui-production \
  --project=YOUR_NEW_PROJECT_ID --zone=YOUR_ZONE --tunnel-through-iap \
  --command='sudo google_metadata_script_runner startup'
```

The startup script is idempotent and installs Docker, nginx, Certbot, Ops Agent and reviewed deployment scripts. It fetches distribution/Google agent packages during bootstrap, so a fresh VM requires outbound internet access through its own IPv4. Host package installation is not a byte-for-byte immutable machine image; application images are immutable. Consider a baked, patched VM image for the later MIG.

## 4. Create the GitHub resources

Commit/push the reviewed repository files to GitHub and let **Checks** run before making its checks mandatory. The GitHub Terraform root manages the **existing repository's** production environment, main-only deployment policy, variables and branch protection; it does not create or import the repository itself.

Provide a GitHub token locally with permission to administer that repository's environments, Actions variables and branch protection. `gh auth token` can supply it if your CLI token has those permissions. Public/private repository plans differ in support for environment reviewers and protected branches. Required reviewers are optional (`reviewer_user_ids`); a solo maintainer can approve their own manual run.

```bash
export GITHUB_TOKEN="$(gh auth token)"
terraform -chdir=infra/github init -input=false -backend-config=github.backend.hcl
terraform -chdir=infra/github plan -out=github.tfplan
terraform -chdir=infra/github apply github.tfplan
unset GITHUB_TOKEN
```

If matching environment/branch protection resources already exist, import them into this **new GitHub root** before applying instead of creating competing owners. If the repository's plan does not support branch protection, set `manage_branch_protection=false`; review access accordingly. Branch protection requires the named checks and prohibits force pushes/deletion. The default PR review approval count is zero to support a solo owner; raise it when there is a second reviewer.

After the VM, DNS and GitHub environment are ready, set `enable_gcp_deployments=true` in `infra/account.json`, regenerate with `--force`, and apply **only the GitHub root** again. This updates the repository's `ENABLE_GCP_DEPLOYMENTS` switch. WIF may need several minutes to propagate after bootstrap.

GitHub-to-GCP trust requires **all** of: immutable repository and owner IDs; `main`; the `production` environment; an allowed event; and one of the four exact workflow paths. Workflow-specific bindings decide which service account that workflow can use. PR checks receive no GCP identity. [Google's federation guidance](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)

## 5. Run a production release

Open **Actions → Production release → Run workflow → main**. The workflow is manual while there is only production.

1. Run dependency audit and all 24 existing unit tests, Terraform validation/policy tests, workflow/shell linting and release transaction tests.
2. Build the application image once. Scan it for fixable high/critical vulnerabilities and test its HTTP contract and all six existing Chromium journeys against the container.
3. Export that tested image as a short-lived Actions artifact. The publisher job loads it and pushes it to your new production Artifact Registry repository without rebuilding.
4. Deploy its `sha256` digest through IAP. The host checks the image label, health, assets, worker, JSON sample and deep links before switching nginx, then verifies the public HTTPS revision.
5. Verify from the GitHub runner too and retain `production-release-record` containing current/previous images for 90 days.

The registry tag includes commit/run/attempt and is immutable. The digest is the deployment identity. The container runs as UID 101 with dropped capabilities, a read-only filesystem, bounded memory/processes/logs and localhost-only ports. The workload itself needs no GCP secrets.

Two slots use ports 8081/8082 **inside production**. They are not dev or staging environments. The prior container remains available until that slot is needed again; rollback can recreate it from its recorded digest. Browser assets are copied into an append-only hashed asset directory, preserving import workers for old tabs. HTML/version responses are not cached. A full browser reload still discards the user's in-memory imported workspace.

The host serializes all release operations using a lock and writes a transaction record before changes. If preparation, TLS, proxy switching or public validation fails, it restores the prior committed release. If the VM/process stops mid-transaction, the next boot or deployment restores the last committed release. A runner disconnect does not terminate the systemd-owned transaction; inspect host status before retrying.

## 6. Operate and recover

### Roll back a bad release

Run **Production rollback** on `main` with both inputs empty. It deploys the previous successful digest, checks it and records the result. There is no previous release before the first successful deployment; an initial failed deployment cannot roll back to a nonexistent version.

For human inspection:

```bash
gcloud compute ssh geometrydash-ui-production \
  --project=YOUR_NEW_PROJECT_ID --zone=YOUR_ZONE --tunnel-through-iap \
  --command='sudo /usr/local/lib/geometrydash-ui/release.py status'
```

Inspect `/var/log/geometrydash-ui/releases.jsonl`, `journalctl -u 'geometrydash-ui-release-*'`, nginx logs and Docker logs through IAP. A failed Actions run is not proof that the host rolled back: an SSH/network interruption can happen after a successful commit. Check the state record and `/version.json` before taking another action.

### Reboot or rebuild

Ordinary reboots retain the disk and release state. `geometrydash-ui-recover.service` restores the committed container/proxy configuration before nginx starts. Test this once after setup.

For loss of the VM/disk, recreate it with the production Terraform root and the same static IP, wait for bootstrap, then use **Production rollback** with `recovery_digest` and `recovery_revision` from a previously successful release record. It pulls that approved image from the production registry, validates it and obtains a fresh TLS certificate. GitHub artifacts expire after 90 days: save the current and previous release records in your own durable operations records before expiry. Registry cleanup is deliberately disabled, so those images are retained until you explicitly remove them.

Full rebuild does not recover the old VM's retained browser assets; previously open tabs may need a reload/reimport. Initial recovery targets are detection within five minutes and application rollback within five minutes, with a VM rebuild target of thirty minutes. These are goals to measure in your account, not verified guarantees.

### Infrastructure changes

Run **Production infrastructure** on `main`. Leave `apply=false` for a plan only. With `apply=true`, its apply job uses the exact saved plan produced by that run, at the same commit. If reviewers are configured, inspect the plan artifact before approving the apply job. Without reviewers, choosing `apply=true` authorizes the sequential apply; use a plan-only run first if you want an additional review.

Routine CI rejects resource deletions/replacements. Use a planned local maintenance procedure for such changes; review the saved plan, arrange recovery, and explicitly disable VM deletion protection when required. Terraform state locking and one GitHub concurrency group serialize infrastructure, releases, rollback and drift. GitHub retains at most one pending run per concurrency group; a newer queued run can replace an older pending run, so confirm an intended rollback actually starts.

Changes to host scripts are embedded in VM metadata by Terraform. Updating metadata does not immediately execute the new scripts. After reviewing/applying those changes, rerun `google_metadata_script_runner startup` during a maintenance window or reboot, then verify the site. It can briefly restart the current container. Application-only releases do not need Terraform.

**Production drift detection** runs weekly and on demand with a separate read-only identity. Exit code 2 is reported as drift; other nonzero codes are execution errors. It never applies or writes state. Subscribe to Actions failure notifications. Optional production reviewers also gate scheduled jobs; approve them or operate drift checks manually under that policy.

### Monitoring and budget acceptance checks

- Confirm alert email delivery with a test notification; complete channel verification if requested.
- Confirm HTTPS checks succeed from multiple locations and `/version.json` reports the expected commit.
- Confirm CPU, memory and disk metrics appear in the geometrydash-ui dashboard. A missing-series alert cannot establish a baseline before the agent has ever reported.
- Confirm nginx and release logs arrive in Cloud Logging; the default bucket keeps seven days.
- Check `systemctl status certbot.timer` and run `sudo certbot renew --dry-run` once after certificate issuance.
- Trigger and recover a short, controlled availability failure; record actual detection/recovery time.
- Verify your budget and remaining trial credit. The optional budget excludes credits so it measures underlying usage and sends standard billing notifications at 50/80/100%; it does not shut down resources. Keep an account-wide budget too if your unrelated project shares billing. [Budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets)

This implementation's monthly cost is **not** the old guide's production-plus-staging total. Price one VM, one 20 GiB disk, one IPv4, registry/state storage, log/metric/uptime usage and transfer for your region. Domain registration and GitHub runner usage are separate. Validate against remaining credit before applying. [GCP calculator](https://cloud.google.com/products/calculator), [Observability pricing](https://cloud.google.com/stackdriver/pricing)

Monitor disk usage because retained assets and images accumulate. Do not run indiscriminate Docker/registry pruning: retain at least current and previous digests, plus assets needed by supported open browser sessions. Review and remove explicitly selected older releases during maintenance, after saving recovery records. A full long-lived asset archive can be moved to dedicated object storage/CDN in a later architecture.

## 7. Local checks and security maintenance

```bash
npm ci
npm audit --audit-level=high
npm test
python3 -m unittest discover -s ops/tests -v
bash ops/ci/terraform-check.sh
docker build --build-arg VCS_REF="$(git rev-parse HEAD)" -t geometrydash-ui-local .
docker run --rm -d --name geometrydash-ui-local --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --cap-drop ALL --security-opt no-new-privileges:true -p 127.0.0.1:8080:8080 geometrydash-ui-local
python3 ops/smoke.py http://127.0.0.1:8080 "$(git rev-parse HEAD)"
python3 ops/ci/check-proxy.py geometrydash-ui-local
npx playwright install --with-deps chromium
npx playwright test --config=playwright.ci.config.ts
docker stop geometrydash-ui-local
```

Terraform tests use mocked providers and require no cloud credentials; they cannot prove live IAM, quota, DNS or API acceptance. Terraform security scanning, source secret scanning, image scanning, audit and lint gates run in GitHub Actions. Three resource-local scanner exceptions document deliberate choices: public web ingress, a VM public IP in this low-cost profile, and no mandatory signed commits for the solo-maintainer setup. SSH remains IAP-only and main requires checks/PRs; do not broaden those exceptions.

Prepared and locally verified on 2026-10-15: 24 application unit tests, six browser journeys against the built container, 15 deployment/configuration tests, four mocked Terraform test runs, container HTTP checks, real nginx validation of initial HTTP/TLS configurations and restoration after an invalid configuration, workflow/shell linting, dependency audit and security scans. No live GCP apply, GitHub environment creation, federation login, public DNS/ACME issuance or cloud alert delivery has been performed; those are the account-specific acceptance steps above.

Dependabot tracks npm, Docker bases, Actions and Terraform providers. Review coordinated version updates: provider locks and `.terraform-version`/workflow Terraform versions must stay consistent. High/critical fixable image vulnerabilities block release; unfixed findings still require review. Host Debian security updates are enabled through unattended upgrades; schedule any required reboots.

### Teardown

Disable `ENABLE_GCP_DEPLOYMENTS` through the GitHub configuration first. Save recovery records/state backups, then set `deletion_protection=false` locally and apply that change before a separately reviewed production destroy. The regular workflow rejects deletion. Review public IP, disk, registry and state storage charges after removal; stopping a VM is not a full teardown.

Bootstrap state buckets and registry have Terraform `prevent_destroy` and must be explicitly retired only after exporting needed state/images. GitHub resources have their own root; destroying that root removes managed protection/variables, so plan that separately. Do not use the unrelated project's credentials/state to clean up these resources.

<!-- FUTURE DEV/STAGING: no active provisioning or workflows. Revisit
infra/environments.future.tf.example and the architecture guide when ready. -->
