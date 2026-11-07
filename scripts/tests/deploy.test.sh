#!/usr/bin/env bash
set -euo pipefail
# Fake Docker/lock adapters exercise release orchestration without a VPS.
# The separate container CI smoke test uses a real image, volume and Chromium.
workspace=$(pwd)
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/app/releases/old" "$test_root/app/releases/new"
export DOCKER_TEST_LOG="$test_root/docker.log"
export DOCKER_TEST_CONFIG="$test_root/docker-config-path"
cat > "$test_root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s | %s\n' "${VERIFLOW_IMAGE:-}" "$*" >> "$DOCKER_TEST_LOG"
printf '%s' "$DOCKER_CONFIG" > "$DOCKER_TEST_CONFIG"
if [[ "$1" == login ]]; then cat >/dev/null; fi
if [[ "$*" == *' pull' && "${FAIL_PULL:-}" == true ]]; then exit 42; fi
if [[ "$*" == *' up '* && "${VERIFLOW_IMAGE:-}" == "${FAIL_IMAGE:-not-set}" ]]; then exit 42; fi
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/flock"
chmod +x "$test_root/bin/docker" "$test_root/bin/flock"
export PATH="$test_root/bin:$PATH"
root="$test_root/app"
old="$root/releases/old"
new="$root/releases/new"
old_image="ghcr.io/madacoda/veriflow@sha256:$(printf 'a%.0s' {1..64})"
new_image="ghcr.io/madacoda/veriflow@sha256:$(printf 'b%.0s' {1..64})"
touch "$root/.env" "$old/compose.yaml" "$new/compose.yaml"
cp "$workspace/scripts/vps-release.sh" "$old/"
cp "$workspace/scripts/vps-release.sh" "$new/"
printf 'fixture-token\n' | bash "$old/vps-release.sh" "$root" "$old_image" fixture-user
[[ $(cat "$root/current-release") == "$old" ]]
[[ ! -e $(cat "$DOCKER_TEST_CONFIG") ]]

export FAIL_IMAGE="$new_image"
if printf 'fixture-token\n' | bash "$new/vps-release.sh" "$root" "$new_image" fixture-user; then
  echo 'Expected unhealthy deployment to fail.' >&2; exit 1
fi
[[ $(cat "$root/current-release") == "$old" ]]
grep -q -- '--pull never --wait' "$DOCKER_TEST_LOG"
[[ ! -e $(cat "$DOCKER_TEST_CONFIG") ]]

export FAIL_PULL=true
: > "$DOCKER_TEST_LOG"
if printf 'fixture-token\n' | bash "$new/vps-release.sh" "$root" "$new_image" fixture-user; then
  echo 'Expected failed pull to fail deployment.' >&2; exit 1
fi
if grep -q ' up ' "$DOCKER_TEST_LOG"; then
  echo 'A failed pull must not replace the existing service.' >&2; exit 1
fi
[[ $(cat "$root/current-release") == "$old" ]]
unset FAIL_PULL

rm -- "$root/current-release"
: > "$DOCKER_TEST_LOG"
if printf 'fixture-token\n' | bash "$new/vps-release.sh" "$root" "$new_image" fixture-user; then
  echo 'Expected failed first deployment to fail.' >&2; exit 1
fi
grep -q ' down$' "$DOCKER_TEST_LOG"
if grep -q -- '--volumes' "$DOCKER_TEST_LOG"; then
  echo 'Failed deployment must not delete persistent volumes.' >&2; exit 1
fi
[[ ! -e "$root/current-release" && -e "$root/.env" ]]
[[ ! -e $(cat "$DOCKER_TEST_CONFIG") ]]
echo 'Release tests passed: healthy deployment, rollback, failed pull and first failure.'

# Fake SSH/SCP adapters prove rebuilding the same commit cannot overwrite the
# previous image's release folder. No network connections or real keys are used.
export SSH_TEST_LOG="$test_root/ssh.log"
export SSH_TEST_TOKEN="$test_root/ssh-token"
cat > "$test_root/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_TEST_LOG"
if [[ "$*" == *vps-release.sh* ]]; then cat > "$SSH_TEST_TOKEN"; fi
FAKE
cat > "$test_root/bin/scp" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_TEST_LOG"
FAKE
chmod +x "$test_root/bin/ssh" "$test_root/bin/scp"
export VPS_HOST=fixture.example VPS_USER=deploy VPS_PATH=/opt/veriflow VPS_PORT=22
export VPS_SSH_KEY=fixture-key VPS_KNOWN_HOSTS=fixture-host-key
export GHCR_USER=fixture-user GHCR_TOKEN=fixture-token
GITHUB_SHA=$(printf 'c%.0s' {1..40})
export GITHUB_SHA
export VERIFLOW_IMAGE="$old_image"
bash "$workspace/scripts/deploy-vps.sh"
export VERIFLOW_IMAGE="$new_image"
bash "$workspace/scripts/deploy-vps.sh"
grep -Fq "mkdir -p '/opt/veriflow/releases/$GITHUB_SHA-${old_image##*@sha256:}'" "$SSH_TEST_LOG"
grep -Fq "mkdir -p '/opt/veriflow/releases/$GITHUB_SHA-${new_image##*@sha256:}'" "$SSH_TEST_LOG"
grep -q 'StrictHostKeyChecking=yes' "$SSH_TEST_LOG"
[[ $(cat "$SSH_TEST_TOKEN") == fixture-token ]]
if grep -q 'fixture-token\|fixture-key' "$SSH_TEST_LOG"; then
  echo 'Secret values must not appear in SSH/SCP arguments.' >&2; exit 1
fi
echo 'SSH orchestration tests passed: isolated image releases, pinned hosts and stdin token.'
