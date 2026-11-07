import { test, expect } from "@playwright/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightSessionFactory } from "../src/browser-session.ts";
import { startGenerationContextTarget } from "../unit/generation-context-target.ts";

test("exact role targets execute alongside existing label and testId targets", async () => {
  const target = await startGenerationContextTarget();
  const root = await mkdtemp(join(tmpdir(), "veriflow-role-"));
  const signal = AbortSignal.timeout(20000);
  const session = await new PlaywrightSessionFactory({
    storageRoot: root,
  }).open({ runId: "role-fixture", allowedOrigins: [target.origin] }, signal);
  try {
    await session.execute(
      {
        action: "navigate",
        stepId: "open",
        timeoutMs: 5000,
        url: `${target.origin}/unique`,
      },
      signal,
    );
    const observation = await session.observe(2000, signal);
    expect(observation.targets).toContainEqual({
      by: "role",
      role: "button",
      value: "Apply coupon",
    });
    expect(observation.targets).toContainEqual({
      by: "label",
      value: "Coupon",
    });
    expect(observation.targets).toContainEqual({
      by: "testId",
      value: "coupon-input",
    });
    expect(
      (
        await session.execute(
          {
            action: "fill",
            stepId: "fill",
            timeoutMs: 5000,
            target: { by: "label", value: "Coupon" },
            value: "SAVE10",
          },
          signal,
        )
      ).status,
    ).toBe("passed");
    expect(
      (
        await session.execute(
          {
            action: "click",
            stepId: "apply",
            timeoutMs: 5000,
            target: { by: "role", role: "button", value: "Apply coupon" },
          },
          signal,
        )
      ).status,
    ).toBe("passed");
    expect(
      (
        await session.execute(
          {
            action: "assert",
            stepId: "verify",
            timeoutMs: 5000,
            target: { by: "role", role: "status", value: "Coupon result" },
            expectation: { kind: "text", value: "Applied" },
          },
          signal,
        )
      ).status,
    ).toBe("passed");
  } finally {
    await session.close();
    await target.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ambiguous role names block and are not advertised as usable targets", async () => {
  const target = await startGenerationContextTarget();
  const root = await mkdtemp(join(tmpdir(), "veriflow-role-ambiguous-"));
  const signal = AbortSignal.timeout(15000);
  const session = await new PlaywrightSessionFactory({
    storageRoot: root,
  }).open(
    { runId: "ambiguous-fixture", allowedOrigins: [target.origin] },
    signal,
  );
  try {
    await session.execute(
      {
        action: "navigate",
        stepId: "open",
        timeoutMs: 5000,
        url: `${target.origin}/ambiguous`,
      },
      signal,
    );
    expect((await session.observe(2000, signal)).targets).not.toContainEqual({
      by: "role",
      role: "button",
      value: "Buy item",
    });
    const result = await session.execute(
      {
        action: "click",
        stepId: "buy",
        timeoutMs: 3000,
        target: { by: "role", role: "button", value: "Buy item" },
      },
      signal,
    );
    expect(result).toMatchObject({
      status: "blocked",
      failureKind: "prerequisite",
      reason: "Target matched multiple elements",
    });
  } finally {
    await session.close();
    await target.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("inspection scopes page context, rejects mutations and creates no artifacts", async () => {
  const target = await startGenerationContextTarget();
  const root = await mkdtemp(join(tmpdir(), "veriflow-inspection-"));
  const signal = AbortSignal.timeout(20000);
  const session = await new PlaywrightSessionFactory({
    storageRoot: root,
  }).open(
    {
      runId: "inspection-fixture",
      purpose: "inspection",
      allowedOrigins: [target.origin],
    },
    signal,
  );
  try {
    for (const [path, scope, text] of [
      ["public", "main", "Public arena preview"],
      ["guarded", "main", "Player account required"],
      ["dialog", "dialog", "Password"],
    ]) {
      await session.execute(
        {
          action: "navigate",
          stepId: path,
          timeoutMs: 5000,
          url: `${target.origin}/${path}`,
        },
        signal,
      );
      const observed = await session.observe(2000, signal);
      expect(observed.scope).toBe(scope);
      expect(observed.text).toContain(text);
      expect(observed.navigationStatus).toBe(200);
      if (path === "public")
        expect(observed.text).not.toContain("Player features locked");
    }
    await expect(
      session.execute(
        {
          action: "click",
          stepId: "forbidden",
          timeoutMs: 1000,
          target: { by: "role", role: "button", value: "Sign in" },
        },
        signal,
      ),
    ).rejects.toThrow("Inspection permits navigation and observation only");
    expect(await session.evidence()).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(target.mutations()).toBe(0);
  } finally {
    await session.close();
    await target.close();
    await rm(root, { recursive: true, force: true });
  }
});
