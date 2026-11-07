#!/usr/bin/env bash
set -euo pipefail
image=${1:?Supply the already tested local image}
name="veriflow-compose-test-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
scratch=$(mktemp -d)
export VERIFLOW_IMAGE VERIFLOW_ENV_FILE VPS_APP_PORT VPS_BIND_ADDRESS COMPOSE_TEST_VOLUME
VERIFLOW_IMAGE=$(docker image inspect --format '{{.Id}}' "$image")
[[ "$VERIFLOW_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
VERIFLOW_ENV_FILE="$scratch/app.env"
VPS_APP_PORT=0
VPS_BIND_ADDRESS=127.0.0.1
COMPOSE_TEST_VOLUME="$name-data"
touch "$VERIFLOW_ENV_FILE"
cat > "$scratch/override.yaml" <<'EOF'
volumes:
  data:
    name: ${COMPOSE_TEST_VOLUME:?}
EOF
compose=(docker compose --project-name "$name" --env-file /dev/null
  -f compose.yaml -f "$scratch/override.yaml")
cleanup() {
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 120
container=$("${compose[@]}" ps -q web)
[[ "$(docker inspect --format '{{.Image}}' "$container")" == "$VERIFLOW_IMAGE" ]]
echo 'Real Compose launched the retained local image ID with pull disabled and isolated storage.'
