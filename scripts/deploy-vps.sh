#!/usr/bin/env bash
set -euo pipefail

: "${VPS_HOST:?Missing VPS_HOST}"
: "${VPS_USER:?Missing VPS_USER}"
: "${VPS_SSH_KEY:?Missing VPS_SSH_KEY}"
: "${VPS_KNOWN_HOSTS:?Missing VPS_KNOWN_HOSTS}"
: "${GHCR_TOKEN:?Missing workflow registry token}"
: "${GHCR_USER:?Missing registry user}"
: "${VERIFLOW_IMAGE:?Missing immutable image reference}"
: "${GITHUB_SHA:?Missing release commit}"
VPS_PORT=${VPS_PORT:-22}
VPS_PATH=${VPS_PATH:-/opt/veriflow}

# These values become SSH arguments/remote paths; reject shell syntax and options.
[[ "$VPS_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$VPS_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ "$VPS_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$VPS_PORT > 0 && 10#$VPS_PORT < 65536))
[[ "$VPS_PATH" =~ ^(/[a-zA-Z0-9_-]+)+$ ]]
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$VERIFLOW_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
[[ "$GHCR_USER" != *"'"* && "$GHCR_USER" != *$'\n'* ]]

umask 077
ssh_dir=$(mktemp -d)
trap 'rm -rf -- "$ssh_dir"' EXIT
printf '%s\n' "$VPS_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset VPS_SSH_KEY VPS_KNOWN_HOSTS
ssh_options=(-i "$ssh_dir/key" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target="$VPS_USER@$VPS_HOST"
image_digest=${VERIFLOW_IMAGE##*@sha256:}
release="$VPS_PATH/releases/$GITHUB_SHA-$image_digest"
ssh "${ssh_options[@]}" -p "$VPS_PORT" "$target" "mkdir -p '$release'"
scp "${ssh_options[@]}" -P "$VPS_PORT" compose.yaml scripts/vps-release.sh "$target:$release/"
# Registry authentication travels only over SSH stdin, never command arguments.
printf '%s\n' "$GHCR_TOKEN" | ssh "${ssh_options[@]}" -p "$VPS_PORT" "$target" \
  "bash '$release/vps-release.sh' '$VPS_PATH' '$VERIFLOW_IMAGE' '$GHCR_USER'"
