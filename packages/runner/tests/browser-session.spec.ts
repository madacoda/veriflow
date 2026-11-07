import { chromium, test, expect, type Browser } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflow, type Command } from "@veriflow/core";
import { PlaywrightSessionFactory } from "../src/browser-session.ts";
import { startBrowserTarget } from "../unit/browser-target.ts";

let target: Awaited<ReturnType<typeof startBrowserTarget>>;
test.beforeAll(async () => {
  target = await startBrowserTarget();
});
test.afterAll(async () => {
  await target.close();
});

const noopSignal = () => new AbortController().signal;
const command = (
  action: Command["action"],
  extra: object,
  stepId = "step",
): Command => ({ action, stepId, timeoutMs: 5000, ...extra }) as Command;

async function setup() {
  const storageRoot = await mkdtemp(join(tmpdir(), "veriflow-b1-"));
  const browsers: Browser[] = [];
  const factory = new PlaywrightSessionFactory({
    storageRoot,
    launchBrowser: async () => {
      const browser = await chromium.launch();
      browsers.push(browser);
      return browser;
    },
  });
  return {
    storageRoot,
    browsers,
    factory,
    cleanup: async () => {
      for (const browser of browsers) await browser.close();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

for (const buggy of [false, true]) {
  test(`real workflow ${buggy ? "fails" : "passes"} and finalizes owned PNGs`, async ({
    browserName,
  }, testInfo) => {
    test.setTimeout(60000);
    expect(browserName).toBe("chromium");
    const fixture = await setup();
    try {
      const result = await runWorkflow(
        {
          schemaVersion: "1",
          id: "coupon",
          name: "Coupon",
          steps: [
            {
              id: "open",
              code: "redirect",
              url: `${target.origin}/demo?bug=${Number(buggy)}`,
            },
            {
              id: "coupon",
              code: "fill",
              target: { by: "label", value: "Coupon" },
              value: "SAVE10",
            },
            {
              id: "apply",
              code: "click",
              target: { by: "testId", value: "apply-coupon" },
            },
            {
              id: "check",
              code: "check",
              target: { by: "label", value: "Accept terms" },
            },
            {
              id: "checked",
              code: "assert",
              target: { by: "testId", value: "terms" },
              expectation: { kind: "checked", value: true },
            },
            {
              id: "uncheck",
              code: "uncheck",
              target: { by: "testId", value: "terms" },
            },
            {
              id: "total",
              // Leave time for the failed observation and its owned PNG.
              timeoutMs: 10_000,
              code: "assert",
              target: { by: "testId", value: "order-total" },
              expectation: { kind: "text", value: "90000" },
            },
          ],
        },
        {
          runId: "run-coupon",
          allowedOrigins: [target.origin],
          artifactDirectory: "runs/run-coupon",
        },
        fixture.factory,
        noopSignal(),
      );
      expect(result.status).toBe(buggy ? "failed" : "passed");
      expect(result.steps.at(-1)).toMatchObject({
        expected: "90000",
        actual: buggy ? "100000" : "90000",
      });
      if (buggy) expect(result.steps.at(-1)?.failureKind).toBe("assertion");
      expect(result.evidence).toHaveLength(7);
      for (const artifact of result.evidence) {
        expect(artifact.runId).toBe("run-coupon");
        expect(artifact.artifactPath.startsWith("runs/run-coupon/")).toBe(true);
        const path = join(fixture.storageRoot, artifact.artifactPath);
        expect((await stat(path)).size).toBeGreaterThan(8);
        expect([...(await readFile(path)).subarray(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        if (artifact.stepId === "total")
          await testInfo.attach(buggy ? "known-fail.png" : "known-pass.png", {
            body: await readFile(path),
            contentType: "image/png",
          });
      }
      expect(fixture.browsers.every((browser) => !browser.isConnected())).toBe(
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  });
}

test("blocks missing exact targets, bounds observations and closes idempotently", async () => {
  const fixture = await setup();
  try {
    const session = await fixture.factory.open(
      { runId: "observe", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    await session.execute(
      command("navigate", { url: `${target.origin}/demo` }),
      noopSignal(),
    );
    const result = await session.execute(
      command("fill", { target: { by: "label", value: "Cou" }, value: "x" }),
      noopSignal(),
    );
    expect(result).toMatchObject({
      status: "blocked",
      failureKind: "prerequisite",
    });
    const observed = await session.observe(10, noopSignal());
    expect(observed.text.length).toBeLessThanOrEqual(10);
    expect(observed.truncated).toBe(true);
    expect(observed.targets).toContainEqual({
      by: "testId",
      value: "coupon-input",
    });
    await expect(session.observe(20001, noopSignal())).rejects.toThrow();
    await session.evidence();
    await session.close();
    await session.close();
    expect(fixture.browsers[0].isConnected()).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("observed exact test IDs round-trip without selecting their trimmed counterpart", async () => {
  const fixture = await setup();
  try {
    const session = await fixture.factory.open(
      { runId: "exact-observation", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    await session.execute(
      command("navigate", { url: `${target.origin}/demo?exact-targets=1` }),
      noopSignal(),
    );
    const observation = await session.observe(1000, noopSignal());
    const padded = observation.targets.find(
      (entry) => entry.by === "testId" && entry.value === " padded ",
    );
    const other = observation.targets.find(
      (entry) => entry.by === "testId" && entry.value === "padded",
    );
    expect(padded).toBeDefined();
    expect(other).toBeDefined();
    expect(observation.targets).toContainEqual({
      by: "label",
      value: "Padded field",
    });
    expect(
      await session.execute(
        command("fill", { target: padded, value: "intended" }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "passed" });
    const page = fixture.browsers[0].contexts()[0].pages()[0];
    await expect(page.getByTestId(" padded ")).toHaveValue("intended");
    await expect(page.getByTestId("padded")).toHaveValue("");
    expect(
      await session.execute(
        command("fill", { target: other, value: "other" }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "passed" });
    await expect(page.getByTestId(" padded ")).toHaveValue("intended");
    await expect(page.getByTestId("padded")).toHaveValue("other");
    expect(await session.evidence()).toHaveLength(3);
    expect(fixture.browsers[0].isConnected()).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("rejects initial and redirected disallowed origins without reaching destination", async () => {
  const fixture = await setup();
  const destination = await startBrowserTarget();
  try {
    for (const [id, url] of [
      ["initial", `${destination.origin}/demo`],
      [
        "redirect",
        `${target.origin}/redirect?to=${encodeURIComponent(`${destination.origin}/demo`)}`,
      ],
    ]) {
      const session = await fixture.factory.open(
        { runId: id, allowedOrigins: [target.origin] },
        noopSignal(),
      );
      expect(
        await session.execute(command("navigate", { url }), noopSignal()),
      ).toMatchObject({ status: "blocked" });
      await session.evidence();
      await session.close();
    }
    expect(destination.requests()).toBe(0);
    expect(fixture.browsers.every((browser) => !browser.isConnected())).toBe(
      true,
    );
  } finally {
    await destination.close();
    await fixture.cleanup();
  }
});

test("abort during an action and action timeout terminate browser resources", async () => {
  const fixture = await setup();
  try {
    for (const mode of ["cancel", "timeout"]) {
      const controller = new AbortController();
      const session = await fixture.factory.open(
        { runId: mode, allowedOrigins: [target.origin] },
        noopSignal(),
      );
      await session.execute(
        command("navigate", { url: `${target.origin}/demo` }),
        noopSignal(),
      );
      const pending = session.execute(
        command("fill", {
          target: { by: "testId", value: "disabled" },
          value: "x",
          timeoutMs: mode === "timeout" ? 150 : 5000,
        }),
        controller.signal,
      );
      if (mode === "cancel") setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toThrow();
      await session.close();
    }
    expect(fixture.browsers.every((browser) => !browser.isConnected())).toBe(
      true,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("partial opens and pre-cancelled opens clean up without leaked browsers", async () => {
  const fixture = await setup();
  try {
    await expect(
      fixture.factory.open(
        { runId: "pre", allowedOrigins: [target.origin] },
        AbortSignal.abort(),
      ),
    ).rejects.toThrow();
    expect(fixture.browsers).toHaveLength(0);
    const controller = new AbortController();
    let browser: Browser | undefined;
    const factory = new PlaywrightSessionFactory({
      storageRoot: fixture.storageRoot,
      launchBrowser: async () => {
        browser = await chromium.launch();
        fixture.browsers.push(browser);
        controller.abort();
        return browser;
      },
    });
    await expect(
      factory.open(
        { runId: "partial", allowedOrigins: [target.origin] },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(browser?.isConnected()).toBe(false);
    await expect(
      fixture.factory.open(
        { runId: "../escape", allowedOrigins: [target.origin] },
        noopSignal(),
      ),
    ).rejects.toThrow();
    await expect(
      fixture.factory.open(
        {
          runId: "valid",
          artifactDirectory: "runs/other",
          allowedOrigins: [target.origin],
        },
        noopSignal(),
      ),
    ).rejects.toThrow();
  } finally {
    await fixture.cleanup();
  }
});

test("allowed redirects and asynchronous targets/assertions work within the budget", async () => {
  const fixture = await setup();
  try {
    const session = await fixture.factory.open(
      { runId: "async", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    const url = `${target.origin}/redirect?to=${encodeURIComponent("/demo?bug=0&delayed=1")}`;
    expect(
      await session.execute(command("navigate", { url }), noopSignal()),
    ).toMatchObject({ status: "passed" });
    expect(
      await session.execute(
        command("fill", {
          target: { by: "testId", value: "late" },
          value: "ready",
        }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "passed" });
    await session.execute(
      command("fill", {
        target: { by: "label", value: "Coupon" },
        value: "SAVE10",
      }),
      noopSignal(),
    );
    await session.execute(
      command("click", { target: { by: "testId", value: "apply-coupon" } }),
      noopSignal(),
    );
    expect(
      await session.execute(
        command("assert", {
          target: { by: "testId", value: "order-total" },
          expectation: { kind: "text", value: "90000" },
        }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "passed", actual: "90000" });
    expect((await session.observe(1000, noopSignal())).url).toBe(
      `${target.origin}/demo`,
    );
    await session.evidence();
  } finally {
    await fixture.cleanup();
  }
});

test("action-caused redirects cannot contact another origin", async () => {
  const fixture = await setup();
  const destination = await startBrowserTarget();
  try {
    const session = await fixture.factory.open(
      { runId: "action-nav", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    const redirect = `${target.origin}/redirect?to=${encodeURIComponent(destination.origin + "/demo")}`;
    await session.execute(
      command("navigate", {
        url: `${target.origin}/demo?to=${encodeURIComponent(redirect)}`,
      }),
      noopSignal(),
    );
    expect(
      await session.execute(
        command("click", { target: { by: "testId", value: "navigate" } }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "blocked" });
    expect(destination.requests()).toBe(0);
    await session.evidence();
  } finally {
    await destination.close();
    await fixture.cleanup();
  }
});

test("malformed commands and browser failures never become assertion failures", async () => {
  const fixture = await setup();
  try {
    const session = await fixture.factory.open(
      { runId: "invalid", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    await expect(
      session.execute(
        command("navigate", {
          url: `${target.origin.replace("://", "://user:secret@")}/demo`,
        }),
        noopSignal(),
      ),
    ).rejects.toThrow("credentials");
    await expect(
      session.execute(
        command("assert", {
          target: { by: "testId", value: "total" },
          expectation: { kind: "unknown", value: "" },
        }),
        noopSignal(),
      ),
    ).rejects.toThrow();
    await expect(
      session.execute(
        command("setChecked", {
          target: { by: "testId", value: "terms" },
          checked: true,
          script: "ignored?",
        }),
        noopSignal(),
      ),
    ).rejects.toThrow();
    await fixture.browsers[0].close();
    await expect(
      session.execute(
        command("navigate", { url: `${target.origin}/demo` }),
        noopSignal(),
      ),
    ).rejects.toThrow();
    await session.close();
  } finally {
    await fixture.cleanup();
  }
});

test("screenshot write failure prevents complete evidence and still releases resources", async () => {
  const fixture = await setup();
  try {
    const session = await fixture.factory.open(
      { runId: "capture-failure", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    await rm(join(fixture.storageRoot, "runs", "capture-failure"), {
      recursive: true,
    });
    await expect(
      session.execute(
        command("navigate", { url: `${target.origin}/demo` }),
        noopSignal(),
      ),
    ).rejects.toThrow("Screenshot capture");
    await expect(session.evidence()).rejects.toThrow("incomplete");
    await session.close();
    expect(fixture.browsers[0].isConnected()).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("popup requests without a frame are blocked without reaching their redirect", async () => {
  const fixture = await setup();
  const destination = await startBrowserTarget();
  try {
    const session = await fixture.factory.open(
      { runId: "popup", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    const redirect = `${target.origin}/redirect?to=${encodeURIComponent(destination.origin + "/demo")}`;
    await session.execute(
      command("navigate", {
        url: `${target.origin}/demo?to=${encodeURIComponent(redirect)}`,
      }),
      noopSignal(),
    );
    expect(
      await session.execute(
        command("click", {
          target: { by: "testId", value: "popup" },
        }),
        noopSignal(),
      ),
    ).toMatchObject({ status: "blocked" });
    expect(destination.requests()).toBe(0);
    await session.evidence();
    expect(fixture.browsers[0].isConnected()).toBe(false);
  } finally {
    await destination.close();
    await fixture.cleanup();
  }
});

test("a policy rejection during real screenshot capture cannot return passed", async () => {
  const fixture = await setup();
  const destination = await startBrowserTarget();
  try {
    const session = await fixture.factory.open(
      { runId: "capture-policy", allowedOrigins: [target.origin] },
      noopSignal(),
    );
    await session.execute(
      command("navigate", { url: `${target.origin}/demo` }),
      noopSignal(),
    );
    const page = fixture.browsers[0].contexts()[0].pages()[0];
    const screenshot = page.screenshot.bind(page);
    // Timing seam only: request enforcement and screenshot bytes remain real Chromium.
    page.screenshot = async (options) => {
      await page.evaluate(
        async (url) => {
          await fetch(url).catch(() => {});
        },
        `${target.origin}/redirect?to=${encodeURIComponent(destination.origin + "/demo")}`,
      );
      return screenshot(options);
    };
    let result;
    try {
      result = await session.execute(
        command("click", {
          target: { by: "testId", value: "apply-coupon" },
        }),
        noopSignal(),
      );
    } finally {
      // Restore before Playwright's own failure-artifact/finalization hooks run.
      page.screenshot = screenshot;
    }
    expect(result).toMatchObject({ status: "blocked" });
    expect(destination.requests()).toBe(0);
    await expect(session.observe(100, noopSignal())).rejects.toThrow("policy");
    expect(await session.evidence()).toHaveLength(2);
  } finally {
    await destination.close();
    await fixture.cleanup();
  }
});

test("cancellation during pending context creation closes the allocated browser", async () => {
  const fixture = await setup();
  try {
    const controller = new AbortController();
    const factory = new PlaywrightSessionFactory({
      storageRoot: fixture.storageRoot,
      launchBrowser: async () => {
        const browser = await chromium.launch();
        fixture.browsers.push(browser);
        browser.newContext = async () => {
          const closed = new Promise<void>((resolve) =>
            browser.once("disconnected", () => resolve()),
          );
          controller.abort();
          await closed;
          throw new Error("Context creation interrupted");
        };
        return browser;
      },
    });
    await expect(
      factory.open(
        { runId: "opening-abort", allowedOrigins: [target.origin] },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(fixture.browsers[0].isConnected()).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});
