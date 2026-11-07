#!/usr/bin/env bash
set -euo pipefail
# Fixture-only certificate/password and an echo upstream; no VPS access.
name="veriflow-nginx-test-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
scratch=$(mktemp -d)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
chmod 755 "$scratch"
mkdir -p "$scratch/conf" "$scratch/cert" "$scratch/acme/.well-known/acme-challenge"
cp deploy/nginx/veriflow.conf "$scratch/conf/veriflow.conf"
cat > "$scratch/conf/upstream.conf" <<'EOF'
# Explicit fake upstream verifies header stripping independently of Next.js.
server {
    listen 127.0.0.1:1111;
    location / { return 200 "fixture:$http_authorization"; }
}
EOF
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -subj /CN=veriflow.madacoda.dev \
  -keyout "$scratch/cert/privkey.pem" -out "$scratch/cert/fullchain.pem" >/dev/null 2>&1
printf 'fixture:%s\n' "$(openssl passwd -apr1 'fixture-only-password')" > "$scratch/htpasswd"
chmod 644 "$scratch/htpasswd" "$scratch/cert/privkey.pem"
printf 'acme-fixture' > "$scratch/acme/.well-known/acme-challenge/probe"
docker run -d --name "$name" \
  -p 127.0.0.1::443 -p 127.0.0.1::80 \
  -v "$scratch/conf:/etc/nginx/conf.d:ro" \
  -v "$scratch/cert:/etc/letsencrypt/live/veriflow.madacoda.dev:ro" \
  -v "$scratch/htpasswd:/etc/nginx/veriflow.htpasswd:ro" \
  -v "$scratch/acme:/var/www/veriflow-acme:ro" nginx:stable
tls_port=$(docker port "$name" 443/tcp)
http_port=$(docker port "$name" 80/tcp)
tls="https://127.0.0.1:${tls_port##*:}"
plain="http://127.0.0.1:${http_port##*:}"
# --insecure is limited to this locally generated, disposable certificate.
curl_args=(--silent --show-error --insecure --max-time 10 --noproxy '*'
  -H 'Host: veriflow.madacoda.dev')
for ((attempt=0; attempt<30; attempt++)); do
  code=$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "$tls/health" 2>/dev/null) || code=000
  if [[ "$code" == 401 ]]; then break; fi
  sleep 1
done
docker exec "$name" nginx -t
expect_status() {
  local expected=$1 code
  shift
  code=$(curl "${curl_args[@]}" -D "$scratch/headers" -o "$scratch/body" -w '%{http_code}' "$@")
  [[ "$code" == "$expected" ]] || { echo "Nginx fixture expected $expected, got $code" >&2; exit 1; }
}
for path in / /api/projects /health /_next/static/probe /api/projects/p/runs/r/evidence/e; do
  expect_status 401 "$tls$path"
  expect_status 401 -u fixture:incorrect "$tls$path"
  expect_status 200 -u fixture:fixture-only-password "$tls$path"
  [[ "$(cat "$scratch/body")" == 'fixture:' ]]
done
for origin in https://veriflow.madacoda.dev ''; do
  expect_status 200 -u fixture:fixture-only-password -X POST -H "Origin: $origin" "$tls/api/projects"
  [[ "$(cat "$scratch/body")" == 'fixture:' ]]
done
for origin in https://attacker.example null https://veriflow.madacoda.dev.attacker.example; do
  expect_status 403 -u fixture:fixture-only-password -X POST -H "Origin: $origin" "$tls/api/projects"
done
expect_status 200 "$plain/.well-known/acme-challenge/probe"
[[ "$(cat "$scratch/body")" == 'acme-fixture' ]]
expect_status 404 "$plain/.well-known/acme-challenge/missing"
expect_status 308 "$plain/health?fixture_secret=do-not-log"
grep -Fq 'https://veriflow.madacoda.dev/health?fixture_secret=do-not-log' "$scratch/headers"
expect_status 200 -u fixture:fixture-only-password "$tls/health?fixture_secret=do-not-log"
docker exec "$name" cat /var/log/nginx/veriflow.access.log > "$scratch/access.log"
if grep -Eq 'do-not-log|fixture-only-password|Basic ' "$scratch/access.log"; then
  echo 'Nginx access log exposed fixture credentials or query strings' >&2
  exit 1
fi
echo 'Nginx fixture passed: syntax, authentication, cross-origin writes, header stripping, ACME, redirect and redacted logs.'
