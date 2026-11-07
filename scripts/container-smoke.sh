#!/usr/bin/env bash
set -euo pipefail
image=${1:?Supply the image to test}
name="veriflow-smoke-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
volume="$name-data"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --name "$name" --init --shm-size=1g \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:1111:1111 -v "$volume:/data" "$image"
wait_healthy() {
  for ((attempt=0; attempt<60; attempt++)); do
    if curl --fail --silent http://127.0.0.1:1111/health >/dev/null; then return; fi
    sleep 1
  done
  docker logs "$name"
  return 1
}
wait_healthy
body=$(curl --fail --silent http://127.0.0.1:1111/)
grep -q Veriflow <<< "$body"
docker exec "$name" node -e '
  const assert = require("node:assert/strict");
  const { chromium } = require("/opt/playwright");
  (async () => {
    assert.notEqual(process.getuid(), 0);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto("http://127.0.0.1:1111/health");
      assert.match(await page.innerText("body"), /"status":"ok"/);
      const png = await page.screenshot();
      assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exit(1); });
'
state=$(docker exec -i "$name" node --input-type=module - run < scripts/container-http-smoke.mjs)
docker restart "$name"
wait_healthy
docker exec -i "$name" node --input-type=module - verify "$state" < scripts/container-http-smoke.mjs
echo 'Container smoke passed: UI, health, non-root Chromium, real HTTP fail/pass, owned PNGs and restart persistence.'
