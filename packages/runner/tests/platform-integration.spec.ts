import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoWorkflow } from "@veriflow/core/fixtures";
import { startBrowserTarget } from "../unit/browser-target.ts";
import { authFixtureEnv, fixtureHeaders } from "../unit/auth-fixture.ts";

/** Built HTTP routes, isolated storage, OS-assigned port; no source-module loader. */
async function startPlatform(root: string, adapter: "browser" | "fake") {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("next/dist/bin/next")),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: fileURLToPath(new URL("../../../apps/web/", import.meta.url)),
      env: {
        ...process.env,
        ...authFixtureEnv,
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "",
        OPENAI_BASE_URL: "",
        STORAGE_DIR: root,
        VERIFLOW_RUN_ADAPTER: adapter,
        VERIFLOW_FAKE_OUTCOME: "failed",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = once(child, "exit");
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })());
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Isolated platform failed to start")),
        15000,
      );
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      void exited.then(() => {
        clearTimeout(timer);
        reject(new Error("Isolated platform exited"));
      });
    });
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(`${origin}/health`, {
                signal: AbortSignal.timeout(1000),
              })
            ).status;
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
async function post(origin: string, path: string, body: unknown) {
  return fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...fixtureHeaders(origin) },
    body: JSON.stringify(body),
  });
}
test("production catalog and generation routes expose safe envelopes without a provider fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-generation-http-"));
  let platformToClose: Awaited<ReturnType<typeof startPlatform>> | undefined;
  try {
    const platform = await startPlatform(root, "fake");
    platformToClose = platform;
    const catalog = await get(platform.origin, "/api/templates");
    expect(catalog.templates[0].id).toBe("functional-exact-total");
    expect(catalog.templates[0].version).toBe("1.0.0");
    expect(catalog.templates).toHaveLength(15);
    const { project } = await (
      await post(platform.origin, "/api/projects", {
        title: "Generation route fixture",
        url: `${platform.origin}/demo`,
      })
    ).json();
    const projectTemplates = await get(
      platform.origin,
      `/api/projects/${project.id}/templates`,
    );
    expect(projectTemplates.templates).toHaveLength(9);
    const responsive = projectTemplates.templates.find(
      (item: { id: string }) => item.id === "responsive-viewports",
    );
    const templateDraft = await post(
      platform.origin,
      `/api/projects/${project.id}/templates`,
      {
        templateId: responsive.id,
        parameters: responsive.defaults,
      },
    );
    expect(templateDraft.status).toBe(200);
    expect((await templateDraft.json()).workflow.category).toBe("responsive");
    const path = `/api/projects/${project.id}/workflows`;
    const unavailable = await post(platform.origin, `${path}/generate`, {
      objective: "Check SAVE10",
    });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe("adapter_unavailable");
    expect((await get(platform.origin, path)).workflows).toEqual([]);
    expect(
      (
        await post(platform.origin, path, {
          workflow: { ...demoWorkflow, id: "generate" },
          expectedRevision: null,
        })
      ).status,
    ).toBe(201);
    expect(
      (await get(platform.origin, `${path}/generate?revision=1`)).workflow
        .workflow.id,
    ).toBe("generate");
    const override = await post(platform.origin, `${path}/generate`, {
      objective: "Check SAVE10",
      provider: "fixture",
    });
    expect(override.status).toBe(422);
    expect((await override.json()).error.code).toBe("validation_error");
  } finally {
    await platformToClose?.close();
    await rm(root, { recursive: true, force: true });
  }
});
async function get(origin: string, path: string) {
  const response = await fetch(origin + path, {
    headers: fixtureHeaders(origin),
  });
  expect(response.status).toBe(200);
  return response.json();
}

test("production browser routes persist observed fail/pass and serve registered PNGs", async ({}, testInfo) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "veriflow-platform-browser-"));
  let targetToClose: Awaited<ReturnType<typeof startBrowserTarget>> | undefined;
  let platformToClose: Awaited<ReturnType<typeof startPlatform>> | undefined;
  let restarted: Awaited<ReturnType<typeof startPlatform>> | undefined;
  try {
    const target = await startBrowserTarget();
    targetToClose = target;
    const platform = await startPlatform(root, "browser");
    platformToClose = platform;
    const { project } = await (
      await post(platform.origin, "/api/projects", {
        title: "Real browser integration fixture",
        url: `${target.origin}/demo`,
      })
    ).json();
    const { project: other } = await (
      await post(platform.origin, "/api/projects", {
        title: "Separate project",
        url: `${target.origin}/demo`,
      })
    ).json();
    const projectPath = `/api/projects/${project.id}`;
    const runs: string[] = [];
    for (const [index, bug] of [true, false].entries()) {
      const saved = await post(platform.origin, `${projectPath}/workflows`, {
        workflow: {
          ...demoWorkflow,
          steps: [
            {
              id: "open",
              code: "redirect",
              url: `${target.origin}/demo?bug=${Number(bug)}`,
              timeoutMs: 10_000,
            },
            ...demoWorkflow.steps
              .slice(1)
              .map((step) => ({ ...step, timeoutMs: 10_000 })),
          ],
        },
        expectedRevision: index || null,
      });
      expect(saved.status).toBe(201);
      const accepted = await post(platform.origin, `${projectPath}/runs`, {
        workflowId: demoWorkflow.id,
        revision: index + 1,
      });
      expect(accepted.status).toBe(202);
      const { run: queued } = await accepted.json();
      runs.push(queued.id);
      const runPath = `${projectPath}/runs/${queued.id}`;
      await expect
        .poll(async () => (await get(platform.origin, runPath)).run.lifecycle, {
          timeout: 45000,
        })
        .toBe("completed");
      const { run } = await get(platform.origin, runPath);
      expect(run.adapter).toBe("browser");
      expect(run.outcome).toBe(bug ? "failed" : "passed");
      expect(run.steps.at(-1)).toMatchObject({
        stepId: "total",
        status: bug ? "failed" : "passed",
        ...(bug ? { expected: "90000", actual: "100000" } : {}),
      });
      expect(run.evidence.capture).toBe("partial");
      expect(run.evidence.artifacts).toHaveLength(4);
      for (const artifact of run.evidence.artifacts) {
        expect(artifact.runId).toBe(run.id);
        const png = await fetch(
          `${platform.origin}${runPath}/evidence/${artifact.id}`,
          { headers: fixtureHeaders(platform.origin) },
        );
        expect(png.status).toBe(200);
        expect(png.headers.get("Content-Type")).toBe("image/png");
        const bytes = Buffer.from(await png.arrayBuffer());
        expect([...bytes.subarray(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        if (artifact.stepId === "total")
          await testInfo.attach(bug ? "observed-failure" : "observed-pass", {
            body: bytes,
            contentType: "image/png",
          });
        expect(
          (
            await fetch(
              `${platform.origin}/api/projects/${other.id}/runs/${run.id}/evidence/${artifact.id}`,
              { headers: fixtureHeaders(platform.origin) },
            )
          ).status,
        ).toBe(404);
      }
    }
    expect(runs[0]).not.toBe(runs[1]);
    await platform.close();
    restarted = await startPlatform(root, "browser");
    const { snapshot } = await get(
      restarted.origin,
      `${projectPath}/runs/${runs[0]}/report`,
    );
    expect(snapshot.workflow.revision).toBe(1);
    expect(snapshot.run.outcome).toBe("failed");
    expect(snapshot.run.evidence.artifacts[0].runId).toBe(runs[0]);
    // Exercise the built production renderer after a revision edit and restart.
    const pdf = await fetch(
      `${restarted.origin}${projectPath}/runs/${runs[0]}/report?format=pdf`,
      { headers: fixtureHeaders(restarted.origin) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Content-Disposition")).toBe(
      `attachment; filename="veriflow-${runs[0]}.pdf"`,
    );
    expect(pdf.headers.get("Cache-Control")).toBe("no-store");
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    expect(pdfBytes.subarray(0, 8).toString()).toMatch(/^%PDF-1\./);
    expect(pdfBytes.subarray(-20).toString()).toContain("%%EOF");
    const reportDirectory = join(root, "reports", runs[0]);
    const [reportFile] = await readdir(reportDirectory);
    expect(reportFile).toMatch(/\.pdf$/);
    expect(await readFile(join(reportDirectory, reportFile))).toEqual(pdfBytes);
    await testInfo.attach("pinned-failure-report", {
      body: pdfBytes,
      contentType: "application/pdf",
    });
    expect(
      (await get(restarted.origin, `${projectPath}/runs/${runs[0]}/report`))
        .snapshot,
    ).toEqual(snapshot);
  } finally {
    await restarted?.close();
    await platformToClose?.close();
    await targetToClose?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production fixture mode stays explicitly labeled with no fabricated evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-platform-fixture-"));
  let platformToClose: Awaited<ReturnType<typeof startPlatform>> | undefined;
  try {
    const platform = await startPlatform(root, "fake");
    platformToClose = platform;
    const { project } = await (
      await post(platform.origin, "/api/projects", {
        title: "Explicit fixture",
        url: "http://127.0.0.1:1111/demo",
      })
    ).json();
    const path = `/api/projects/${project.id}`;
    expect(
      (
        await post(platform.origin, `${path}/workflows`, {
          workflow: demoWorkflow,
          expectedRevision: null,
        })
      ).status,
    ).toBe(201);
    const { run: queued } = await (
      await post(platform.origin, `${path}/runs`, {
        workflowId: demoWorkflow.id,
        revision: 1,
      })
    ).json();
    const runPath = `${path}/runs/${queued.id}`;
    await expect
      .poll(async () => (await get(platform.origin, runPath)).run.lifecycle)
      .toBe("completed");
    const { run } = await get(platform.origin, runPath);
    expect(run.adapter).toBe("fake");
    expect(run.outcome).toBe("failed");
    expect(run.evidence.artifacts).toEqual([]);
  } finally {
    await platformToClose?.close();
    await rm(root, { recursive: true, force: true });
  }
});
