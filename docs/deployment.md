# GHCR and VPS deployment

One Next.js monolith runs on Node 24. Bun 1.4.4 installs the locked workspace during the image build. The application, development server, smoke tests and demo fixtures default to port **1111**. Local `PORT` and Next's `--port` argument can override the default. Compose always uses container port 1111.

## Release flow

The existing CI check runs first. PRs additionally build the Linux amd64 image and verify UI/health, real non-root Chromium and saved workflow execution through the production HTTP routes. The buggy coupon workflow must fail with expected 90000 and actual 100000; its corrected revision must pass with actual 90000. Both runs must expose owned PNGs, and their reports and evidence must survive a container restart. The smoke uses the same dropped capabilities and no-new-privileges setting as Compose.

Docker builds enable Next standalone output. The packaging script copies the lockfile-resolved Playwright installer and completes the packages at the standalone server's resolved dependency locations, including dynamically loaded browser metadata omitted by static tracing. A Linux build is authoritative; Windows builds leave standalone off to avoid symlink privilege requirements.

Only a successful push to `main` publishes `ghcr.io/madacoda/veriflow:sha-<commit>`. Publication pushes the exact image exercised by the container smoke test. VPS deployment uses its immutable `@sha256:...` digest. PRs never publish or connect to the VPS. Feature-branch pushes run the normal check; the PR runs the container check.

Dev 1 reviews and merges this deployment PR. Set the repository Actions variable `VPS_DEPLOY_ENABLED` to `true` after provisioning the server and secrets. Leave it unset to publish images without deploying. This variable must be repository-scoped because job conditions are evaluated before loading the production environment.

## GitHub configuration

Create the GitHub environment `production`. Store these Actions secrets there, or at repository scope:

| Secret            | Value                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `VPS_HOST`        | VPS hostname or IPv4 address, for this installation `217.216.73.206`                             |
| `VPS_USER`        | SSH account, currently `root`; it must be able to use Docker and write the deployment directory  |
| `VPS_SSH_KEY`     | Entire private key file, including BEGIN/END lines; the local passwordless key is named `server` |
| `VPS_KNOWN_HOSTS` | Verified OpenSSH known_hosts entry for the server                                                |
| `VPS_PORT`        | Optional SSH port; defaults to `22`                                                              |
| `VPS_PATH`        | Optional absolute deployment directory; defaults to `/opt/veriflow`                              |

Install only `server.pub` in the server account's `authorized_keys`. Never commit the private key or runtime secrets. Use the already verified known_hosts entry; do not replace host verification with `StrictHostKeyChecking=no`. Non-default SSH ports need a `[host]:port` known_hosts entry.

No registry PAT is required. Publishing uses the workflow's `GITHUB_TOKEN` with `packages: write`. Deployment uses a separate token with `packages: read`, sent only over SSH stdin to a temporary Docker config which is deleted when deployment exits. The package must grant this repository Actions access; publishing it from this repository normally establishes that association.

## Provision the VPS once

Install Docker Engine, Docker Compose **2.30 or newer** (raw env-file support), Bash and `flock`. Use a Linux amd64 host. The supplied image includes Chromium and its Linux dependencies.

As the deployment user, create the application environment outside the repository:

```sh
install -d -m 700 /opt/veriflow
install -m 600 /dev/null /opt/veriflow/app.env
```

Populate `app.env` with server-only configuration, for example:

```dotenv
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
OPENAI_BASE_URL=https://api.openai.com/v1
```

Provision that file only once; recreating it with the install command would truncate existing configuration. `NODE_ENV`, `STORAGE_DIR`, `PORT` and `HOSTNAME` are set by Compose. `app.env` uses raw parsing so dollar signs in secrets are preserved. Optional Compose settings belong in `/opt/veriflow/deploy.env`, not in `app.env`:

```dotenv
VPS_BIND_ADDRESS=127.0.0.1
VPS_APP_PORT=1111
```

The default binds only localhost. Configure an HTTPS reverse proxy to `http://127.0.0.1:1111`, with access controls while the platform has no multi-user authentication. For a private demo without a proxy, use an SSH tunnel:

```powershell
ssh -i "$env:USERPROFILE\.ssh\server" -L 1111:127.0.0.1:1111 root@217.216.73.206
```

Then open `http://localhost:1111`. An intentional public bind requires `VPS_BIND_ADDRESS=0.0.0.0` and appropriate firewall/access controls. SSH is still on port 22 unless separately configured; application port 1111 does not change SSH.

## Persistence, health and rollback

The service runs as the image's non-root `node` user with an init process, 1 GiB shared memory, a 2 GiB memory limit, a two-CPU limit, a 512-process limit and a named `veriflow-data` volume at `/data`. Keep one replica and one writer. The repository's current filesystem store does not support horizontal scaling. On the shared VPS, set `VERIFLOW_MAX_CONCURRENT_RUNS=1` in `app.env`.

Each workflow attempt uploads a distinct release directory containing Compose and the deployment script. Re-running the same commit never overwrites the previous rollback bundle. A server-side lock serializes replacements, and the workflow skips superseded main commits. Images are pulled before replacing the application. Only a healthy container advances `current-release`.

If the health gate fails, the script restores the previous release's Compose file and locally retained image digest, then reports a failed deployment. A failed first deployment removes its service without deleting the data volume. Registry credentials are cleaned up in both cases. Do not prune the previous image or remove the volume. Rollback restores code/configuration, not data; future incompatible schema migrations require a separate migration/backup policy.

This is a single-container replacement with brief downtime, not a zero-downtime deployment. There is no run-draining interface yet: an active run can be interrupted and the existing coordinator marks it as an infrastructure error on recovery. Schedule releases between demo runs. The real browser adapter is integrated. AI HTTP integration and credentials are separate product work; a healthy container does not claim the complete MVP is wired.

## HTTPS and access gate

The site is `https://veriflow.madacoda.dev`. Nginx terminates TLS and proxies only to `127.0.0.1:1111`. The dashboard, API, evidence and static assets all require HTTP Basic authentication until product authentication is implemented. Access is for trusted operators: they can start browser jobs. Do not embed gate credentials into workflows, target URLs, reports or GitHub secrets.

Use [deploy/nginx/veriflow.conf](../deploy/nginx/veriflow.conf) for the dedicated virtual host. It includes TLS 1.2/1.3, security headers, private/no-store responses, a 12 MiB request limit, bounded proxy timeouts, rate limiting, cross-origin write rejection, and access logs without query strings or credentials. It removes the gate Authorization header before proxying to Next.js. Preserve the existing Cloudflare trusted-proxy IP configuration when calculating client addresses.

Provision an HTTP-only bootstrap virtual host with `server_name veriflow.madacoda.dev` and the template's ACME location. Return 503 for all other HTTP requests until HTTPS is ready. Install Certbot and `apache2-utils`, then obtain the certificate:

```sh
certbot certonly --webroot -w /var/www/veriflow-acme \
  -d veriflow.madacoda.dev --email me@madacoda.dev --agree-tos --non-interactive
htpasswd -cB /etc/nginx/veriflow.htpasswd madacoda
chown root:www-data /etc/nginx/veriflow.htpasswd
chmod 640 /etc/nginx/veriflow.htpasswd
```

The htpasswd command prompts securely; use `-c` only for initial creation. Rotate an existing password with `htpasswd -B /etc/nginx/veriflow.htpasswd madacoda`. Keep plaintext credentials in a password manager or a local file restricted to its owner, outside the checkout.

Install the TLS virtual host and [renewal hook](../deploy/nginx/renew-hook.sh) at `/etc/letsencrypt/renewal-hooks/deploy/veriflow-nginx` (mode 755). Always run `nginx -t` before reloading. Check `certbot.timer` and run `certbot renew --dry-run --run-deploy-hooks`. Retain the ACME location without authentication for renewals.

For Cloudflare proxying, create a **Configuration Rule limited to hostname `veriflow.madacoda.dev` with SSL = Full (strict)**, or set this DNS record to DNS-only and point it to the VPS. The origin uses a public Let's Encrypt certificate. Do not change the entire zone to strict while other applications have HTTP-only origins. Browser-to-Cloudflare HTTPS alone does not encrypt the Cloudflare-to-origin connection. Keep the HTTP fallback at 503 until the HTTPS origin connection is verified, then enable the template's HTTP-to-HTTPS redirect. Flexible mode plus that redirect causes a loop.

Validate unauthenticated requests to `/`, `/api/projects`, `/health` and `/_next/` return 401 over HTTPS, valid credentials reach the application, and a cross-origin POST returns 403. Verify port 1111 is bound only to loopback and other virtual hosts still respond. Nginx files and certificates are managed separately from application releases; CI does not overwrite other sites.

The included demo can be exercised by the server browser at `http://127.0.0.1:1111/demo?bug=1` (known fail) and `?bug=0` (known pass). These are server-side target URLs; do not put the public site's Basic Auth password in a workflow. Browser-origin allowlisting is not a network sandbox, so only trusted operators should receive access.

## Initial deployment before the lead merges

A one-time bootstrap may build the exact verified PR commit on the VPS while the lead reviews the deployment PR. Run `scripts/container-smoke.sh` against that image before starting production. Store its immutable local `sha256:...` image ID in the release's `image.ref`, alongside `compose.yaml`, and record the healthy release in `/opt/veriflow/current-release`. The first GHCR deployment can roll back to this local ID with `--pull never`; all new automated releases still require a GHCR registry digest. Do not prune the bootstrap image until a later healthy release is retained.

Automatic publishing/deployment starts only after Dev 1 merges the PR into main. Runtime secrets and password hashes are server configuration and are never committed. Back up `veriflow-data` and `/opt/veriflow/app.env` before destructive maintenance; image rollback does not restore data. Off-host backups and product-level identity remain production follow-up work.

## Validation

Run the normal merge gate in REVIEW.md. Additional checks are:

```sh
shellcheck scripts/*.sh scripts/tests/*.sh
bash scripts/tests/deploy.test.sh
bash scripts/tests/transport.test.sh
docker build -t veriflow:test .
bash scripts/container-smoke.sh veriflow:test
```

The release orchestration tests explicitly use fake Docker/lock adapters to verify success, failed pulls, failed first deployment, rollback and credential cleanup. The container CI job verifies the real application, browser and storage on Linux. No live server release occurs merely by opening this PR.

References: [GitHub container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Playwright Docker guidance](https://playwright.dev/docs/docker), [Compose up and health waiting](https://docs.docker.com/reference/cli/docker/compose/up/).
