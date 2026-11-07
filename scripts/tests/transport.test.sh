#!/usr/bin/env bash
set -euo pipefail
# Fake SSH/SCP: validate secret transport, host checking and release isolation.
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin"
export TRANSPORT_LOG="$test_root/transport.log"
export KEY_PATH_LOG="$test_root/key-path"
cat > "$test_root/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TRANSPORT_LOG"
[[ "$1" == -i && -s "$2" ]]
printf '%s' "$2" > "$KEY_PATH_LOG"
if grep -q $'\r' "$2"; then exit 1; fi
[[ "$*" == *'StrictHostKeyChecking=yes'* ]]
[[ "$*" == *'BatchMode=yes'* ]]
if [[ "$*" == *'bash '* ]]; then
  IFS= read -r token
  [[ "$token" == fixture-registry-token ]]
fi
FAKE
cat > "$test_root/bin/scp" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TRANSPORT_LOG"
[[ "$*" == *'StrictHostKeyChecking=yes'* ]]
FAKE
chmod +x "$test_root/bin/ssh" "$test_root/bin/scp"
export PATH="$test_root/bin:$PATH"
export VPS_HOST=example.test VPS_USER=deploy VPS_PORT=22 VPS_PATH=/opt/veriflow
export VPS_SSH_KEY=$'fixture-private-key\r\n'
export VPS_KNOWN_HOSTS='fixture-known-host'
export GHCR_TOKEN=fixture-registry-token GHCR_USER=fixture-user
export GITHUB_SHA
GITHUB_SHA=$(printf 'a%.0s' {1..40})
export GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 VERIFLOW_IMAGE
VERIFLOW_IMAGE="ghcr.io/madacoda/veriflow@sha256:$(printf 'b%.0s' {1..64})"
bash scripts/deploy-vps.sh
[[ ! -e $(cat "$KEY_PATH_LOG") ]]
grep -q "$GITHUB_SHA-123-1" "$TRANSPORT_LOG"
export GITHUB_RUN_ATTEMPT=2
bash scripts/deploy-vps.sh
grep -q "$GITHUB_SHA-123-2" "$TRANSPORT_LOG"
! grep -q 'fixture-private-key\|fixture-registry-token' "$TRANSPORT_LOG"
[[ ! -e $(cat "$KEY_PATH_LOG") ]]

: > "$TRANSPORT_LOG"
export VPS_HOST='example.test;echo injected'
if bash scripts/deploy-vps.sh; then
  echo 'Expected invalid host to reject before any SSH call.' >&2; exit 1
fi
[[ ! -s "$TRANSPORT_LOG" ]]
echo 'Transport tests passed: strict host keys, stdin token, cleanup, unique retries and invalid input.'
