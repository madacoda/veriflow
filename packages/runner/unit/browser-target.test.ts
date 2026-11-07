import { test } from "node:test";
import assert from "node:assert/strict";
import { startBrowserTarget } from "./browser-target.ts";

test("browser fixture owns an ephemeral loopback port and closes idempotently", async () => {
  const target = await startBrowserTarget();
  try {
    const response = await fetch(`${target.origin}/demo?bug=0`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /coupon-input/);
    const redirect = await fetch(
      `${target.origin}/redirect?to=%2Fdemo%3Fbug%3D1`,
      { redirect: "manual" },
    );
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "/demo?bug=1");
  } finally {
    await target.close();
  }
  await target.close();
  await assert.rejects(fetch(`${target.origin}/demo`));
});
