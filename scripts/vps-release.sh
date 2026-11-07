#!/usr/bin/env bash
set -euo pipefail

root=${1:?Missing deployment directory}
image=${2:?Missing image digest}
registry_user=${3:?Missing registry user}
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
[[ -f "$root/app.env" ]] || { echo 'Provision the VPS runtime app.env first.' >&2; exit 1; }
root=$(cd -- "$root" && pwd -P)
[[ "$release" == "$root/releases/"* ]]

# Only one writer/deployment may replace this monolith at a time.
exec 9> "$root/.deploy.lock"
flock -w 300 9
umask 077
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT
IFS= read -r registry_token
printf '%s\n' "$registry_token" | docker login ghcr.io --username "$registry_user" --password-stdin
unset registry_token

export VERIFLOW_ENV_FILE="$root/app.env"
export VERIFLOW_IMAGE="$image"
settings=/dev/null
if [[ -f "$root/deploy.env" ]]; then settings="$root/deploy.env"; fi
# Runtime secrets use raw env_file parsing and never Compose interpolation.
compose=(docker compose --project-name veriflow --project-directory "$root" --env-file "$settings")
"${compose[@]}" -f "$release/compose.yaml" config --quiet
"${compose[@]}" -f "$release/compose.yaml" pull
printf '%s\n' "$image" > "$release/image.ref"

if "${compose[@]}" -f "$release/compose.yaml" up -d --no-build --wait --wait-timeout 120; then
  printf '%s\n' "$release" > "$root/.current-release.tmp"
  mv -- "$root/.current-release.tmp" "$root/current-release"
  echo 'Deployment is healthy on container port 1111.'
else
  echo 'New image failed health checks; restoring the previous release.' >&2
  if [[ -s "$root/current-release" ]]; then
    previous=$(cat "$root/current-release")
    [[ "$previous" == "$root/releases/"* && -f "$previous/image.ref" ]]
    export VERIFLOW_IMAGE
    VERIFLOW_IMAGE=$(cat "$previous/image.ref")
    [[ "$VERIFLOW_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
    "${compose[@]}" -f "$previous/compose.yaml" up -d --no-build --pull never --wait --wait-timeout 120
  else
    # No previous release exists. Remove only this failed service; keep its data.
    "${compose[@]}" -f "$release/compose.yaml" down
  fi
  exit 1
fi
