# GHCR and VPS deployment

This setup keeps one Next.js monolith, Node.js 24, Bun 1.4.4 for dependency/build commands, and a single persistent writer. The default app port is **1111** in development, production, browser checks and the container. Set the shell's PORT to override local CLI/test ports. Container traffic always uses 1111; VPS_APP_PORT changes only the published host port.

## Pipeline

CI first runs the repository merge gate. The container job then builds a Linux amd64 image and verifies UI/health, non-root Chromium launch, real PNG bytes and project persistence across a container restart. Pull requests run these checks without publishing or connecting to a VPS.

After a successful push to main, the same tested image is pushed to `ghcr.io/madacoda/veriflow:sha-<full-commit>`. Publication uses the workflow GITHUB_TOKEN with packages:write; no personal registry secret is required. Deployment consumes the registry's immutable `@sha256:...` reference. The package inherits repository access; existing packages must grant this repository Actions access. Package visibility is not changed by the workflow.

The production deployment job runs only when repository variable `VPS_DEPLOY_ENABLED` is exactly `true`. It serializes deployments, skips superseded main commits and uses the production GitHub Environment, including any protection rules configured there. It never merges PRs.

## GitHub configuration

Add these repository secrets, or secrets in the **production** Environment:

| Secret          | Required | Value                                                                                                                              |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| VPS_HOST        | Yes      | VPS DNS hostname or IPv4 address, without scheme/path                                                                              |
| VPS_USER        | Yes      | Dedicated SSH login user with Docker access                                                                                        |
| VPS_SSH_KEY     | Yes      | Complete private deployment key; its public key belongs in that user's authorized_keys                                             |
| VPS_KNOWN_HOSTS | Yes      | Pinned OpenSSH known_hosts entry verified against the VPS console/provider fingerprint; use `[host]:port` for nondefault SSH ports |
| VPS_PORT        | No       | SSH port; default 22                                                                                                               |
| VPS_PATH        | No       | Absolute deployment directory; default /opt/veriflow; letters, digits, slash, underscore and hyphen only                           |

Registry publishing and VPS pulling both use short-lived GITHUB_TOKEN credentials. The pull token travels over SSH stdin and is held only in a temporary Docker config removed on exit. Do not create a long-lived GHCR_TOKEN secret. SSH host verification is mandatory; the workflow never automatically trusts a network-discovered key.

Add repository **variable** `VPS_DEPLOY_ENABLED=true` after provisioning the VPS. Leaving it unset keeps publication enabled and VPS deployment disabled. No secret values or deployment-enablement settings are created by this PR.

## Provision once

Use a Linux amd64 VPS with Docker Engine, Docker Compose **2.30+**, Bash, OpenSSH and flock. The deployment user must be able to run Docker and write VPS_PATH. Docker access is privileged host access; keep this account limited to deployment.

Create the directory and runtime configuration on the VPS, substituting the real deployment user:

```sh
sudo install -d -m 750 -o deploy -g deploy /opt/veriflow
sudo install -m 600 -o deploy -g deploy /dev/null /opt/veriflow/.env
```

Copy the keys from the root `.env.example` into `/opt/veriflow/.env` and fill runtime values on the VPS. OPENAI_API_KEY and other application secrets stay there; they are not Docker build arguments or committed files. Compose reads this file with raw values so dollar signs in credentials remain literal. Do not put SSH or registry credentials in it.

By default, the app is published at `127.0.0.1:1111`. Point an HTTPS reverse proxy with appropriate access control at that address; the current platform is single-user and has no multi-user authentication. If direct network access is intended, explicitly set VPS_BIND_ADDRESS in the VPS .env. Keep one replica because filesystem persistence has one process owner.

The named volume `veriflow-data` mounts at `/data` and is initialized for container UID/GID 1000. Back up this volume before changing persistence formats. Reusing an existing volume requires compatible ownership. The image includes Chromium installed by the exact lockfile-resolved Playwright installer, but real run/API wiring still depends on the separately reviewed browser and AI integration tasks. Unconfigured run adapters continue to return 503.

## Release and recovery

Each deployment copies Compose and the release script into `VPS_PATH/releases/<commit>`. The remote script locks the deployment directory, validates configuration and pulls the new image before replacing the service. Compose waits up to 120 seconds for its health check. Only a healthy release becomes `current-release`.

If startup fails, the previous release's Compose file and image digest are restored without pulling or deleting the data volume. A failed first deployment removes its failed service but preserves data. Rollback still returns a failed workflow result. This is a single-service replacement with brief downtime; application/data migrations are not rolled back. A failure before pull/start leaves the previous container alone. A host/SSH outage during replacement may require reconnecting and rerunning the release; the workflow does not claim transactional recovery from host failure.

For manual recovery, use the previous release's `image.ref` and Compose file:

```sh
cd /opt/veriflow
export VERIFLOW_ENV_FILE=/opt/veriflow/.env
export VERIFLOW_IMAGE="$(cat releases/<previous-commit>/image.ref)"
docker compose --project-name veriflow --project-directory /opt/veriflow \
  --env-file /opt/veriflow/.env -f releases/<previous-commit>/compose.yaml \
  up -d --no-build --pull never --wait --wait-timeout 120
```

Use only releases whose data format is compatible with the current volume. Update `current-release` to that recovered release after verifying health. Keep previous images available locally; the deployment never prunes images or volumes.

## Verification

Run the standard REVIEW.md gate plus `bash scripts/tests/deploy.test.sh`. That script uses clearly labeled fake Docker/lock adapters to verify success, failed pull, rollback and first-deployment cleanup without contacting a server.

With Docker available:

```sh
docker build -t veriflow:local .
bash scripts/container-smoke.sh veriflow:local
```

The container smoke uses a temporary named volume and removes only its own container/volume. The real VPS SSH path requires the configured secrets and host; a successful image check does not prove an actual deployment occurred.

## References

- [Next.js standalone output and monorepo tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Compose health waits](https://docs.docker.com/reference/cli/docker/compose/up/)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
