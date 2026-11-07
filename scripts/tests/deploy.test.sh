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
touch "$root/app.env" "$old/compose.yaml" "$new/compose.yaml"
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
if grep -q ' up ' "$DOCKER_TEST_LOG"; then exit 1; fi
[[ $(cat "$root/current-release") == "$old" ]]
unset FAIL_PULL

rm -- "$root/current-release"
: > "$DOCKER_TEST_LOG"
if printf 'fixture-token\n' | bash "$new/vps-release.sh" "$root" "$new_image" fixture-user; then
  echo 'Expected failed first deployment to fail.' >&2; exit 1
fi
grep -q ' down$' "$DOCKER_TEST_LOG"
if grep -q -- '--volumes' "$DOCKER_TEST_LOG"; then exit 1; fi
[[ ! -e "$root/current-release" && -e "$root/app.env" ]]
[[ ! -e $(cat "$DOCKER_TEST_CONFIG") ]]
echo 'Release tests passed: healthy deployment, rollback, failed pull and first failure.'
