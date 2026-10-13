# EC2 deployment and recovery

Merge a pull request into **main** to deploy. All three repositories have `CI and EC2 deployment` workflows: Tests → Publish immutable release → Verify EC2 activation. The final job succeeds only after EC2 reports the exact source SHA activated and checked. PR jobs have no production credentials. The main-only production environment governs publication.

GitHub-hosted runners build Docker images for backend and AI. Backend API and worker always use the same image SHA. Blockchain CI builds a Fabric 3.1.4 package; EC2 upgrades only when the chaincode source hash changes. No PM2 is needed: Docker restart policies handle containers and systemd handles the outbound release agent. EC2 never executes PR workflows. Runtime `.env`, Firebase credentials, client identity, TLS certificates and trained model weights stay on EC2.

## Daily operation

SSH as usual, then:

```bash
sudo f2fctl status
sudo f2fctl check
sudo f2fctl logs
```

The authoritative Compose definition is `/opt/farm2fork/ops/compose.yml`, with runtime settings in `/opt/farm2fork/backend.env` and immutable image selections in `/opt/farm2fork/deployment-images.env`. The previous walkthrough's Compose files are bootstrap backups; do not use them to update production.

The outbound systemd timer checks each public repository's main reference approximately every minute. Only complete `deploy-FULL_SHA` releases are eligible. Deployment receipts are publicly readable at `https://api.farm2fork.tech/_deploy/status/backend`, `/ai` and `/blockchain`; they expose SHAs and status, not credentials or operational errors. A newer main commit may supersede an intermediate commit before activation.

## Failures

Candidate failures leave existing containers running. Post-activation failures restore the previous application image and check its dependencies. A transaction journal recovers interrupted deployments before processing any new release. Failed SHAs are not repeatedly redeployed. After correcting a runtime configuration problem:

```bash
sudo f2fctl retry backend
```

Use `ai` or `blockchain` for their respective release. Source fixes should go through another PR to main. Re-running Actions for an already published commit does not overwrite its immutable artifact. A failed draft release may be rebuilt before publication.

For an intentional application rollback, revert the problematic change in GitHub and merge the revert PR into main. It produces a newly tested release of the previous code. Emergency automatic rollback retains the previous image locally. Do not use `docker system prune -a`, `docker compose down -v`, or the blockchain network-down/reset scripts on production.

## Fabric

One server lock serializes deployments across all repositories. An upgrade reads the committed sequence, installs and approves the new package, and commits sequence + 1. Unchanged source only verifies the existing ledger. Before upgrades a consistent cold snapshot stops the worker, peer and orderer briefly. Images, peer/orderer ledger volumes, identities and channel artifacts are preserved. Recovery after an upgrade deploys the previous package at a higher sequence; it never restores an older ledger over current state. Future chaincode changes must preserve old state-schema compatibility for forward recovery.

```bash
sudo f2fctl backup
```

Snapshots are under `/opt/farm2fork/backups`, readable only by root. Restore requires a planned maintenance window with worker, peer and orderer stopped, the matching identities and both volumes. Never unpack a snapshot over a running network. Local snapshots do not protect against losing the EC2 disk: off-instance storage and an actual restore drill are still needed for disaster recovery. Atlas backup policy is managed separately.

## Operations changes and prerequisites

`ops` is installed root-owned from reviewed source. Application release archives cannot silently replace privileged operational scripts. To update those files, review their diff, copy them to EC2, validate Compose/scripts and restart/reload the affected controller or proxy deliberately.

Only HTTPS/HTTP are published for application services; Fabric host ports are loopback-only, Redis and AI have no public ports. Cloudflare's published address ranges are configured as Caddy's trusted proxies. Backend trusts one Caddy hop. Refresh those ranges when Cloudflare changes them. The existing Origin CA certificate must be renewed before expiry.

Trained AI weights are mounted from `/opt/farm2fork/models/best_model.pth`. Without them quality is unavailable (503), while rule-based price estimates continue to work. Set `AI_REQUIRE_TRAINED=true` in `backend.env` and recreate AI when a trained checkpoint becomes mandatory. No fabricated weights are shipped by CI. Model files are independent runtime assets and require separate validation/backups.

Payments remain disabled until Safepay's real environment and keys are supplied. Local uploads persist in `farm2fork_uploads`; configure Cloudinary or establish an off-instance upload backup for real use. Authenticated browser/mobile acceptance needs a real user session. This setup provides single-host deployments with brief service restart downtime; it does not provide high availability.
