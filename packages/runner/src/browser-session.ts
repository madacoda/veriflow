import axe from "axe-core";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stepSchema } from "@veriflow/core";
import type {
  BrowserObservation,
  BrowserSession,
  Command,
  Evidence,
  SessionFactory,
  SessionOptions,
  StepResult,
  Target,
} from "@veriflow/core";
import {
  allowedOrigins,
  artifactLocation,
  BrowserPolicyError,
  permitsUrl,
} from "./browser-policy.ts";
import { readBrowserObservation } from "./browser-observation.ts";

export interface BrowserFactoryOptions {
  storageRoot: string;
  /** Browser launch seam for lifecycle tests or a caller-supplied Chromium build. */
  launchBrowser?: () => Promise<Browser>;
  resolveSecret?: (name: string) => string | undefined;
}

function validateCommand(command: Command): void {
  const { action, stepId, ...parameters } = command;
  switch (action) {
    case "navigate":
      stepSchema.parse({ ...parameters, id: stepId, code: "redirect" });
      break;
    case "viewport":
    case "assertLayout":
    case "accessibility":
    case "assertHttp":
    case "fillSecret":
    case "assertRequirement":
    case "fill":
    case "click":
    case "assert":
      stepSchema.parse({ ...parameters, id: stepId, code: action });
      break;
    case "setChecked": {
      if (typeof command.checked !== "boolean")
        throw new Error("Invalid checked state");
      const { checked, ...stepParameters } = parameters as Omit<
        Extract<Command, { action: "setChecked" }>,
        "action" | "stepId"
      >;
      stepSchema.parse({
        ...stepParameters,
        id: stepId,
        code: checked ? "check" : "uncheck",
      });
      break;
    }
    default:
      throw new Error("Unsupported browser command");
  }
}

export class PlaywrightSessionFactory implements SessionFactory {
  constructor(private readonly config: BrowserFactoryOptions) {}

  async open(
    options: SessionOptions,
    signal: AbortSignal,
  ): Promise<BrowserSession> {
    signal.throwIfAborted();
    const origins = allowedOrigins(options.allowedOrigins);
    const purpose = options.purpose ?? "run";
    if (
      !["run", "inspection"].includes(purpose) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.runId) ||
      (purpose === "inspection" && options.artifactDirectory !== undefined)
    )
      throw new BrowserPolicyError(
        "Invalid session purpose or artifact configuration",
      );
    const location =
      purpose === "inspection"
        ? undefined
        : await artifactLocation(this.config.storageRoot, options);
    if (
      options.viewport &&
      (!Number.isInteger(options.viewport.width) ||
        !Number.isInteger(options.viewport.height) ||
        options.viewport.width < 320 ||
        options.viewport.width > 3840 ||
        options.viewport.height < 320 ||
        options.viewport.height > 2160)
    ) {
      throw new BrowserPolicyError("Invalid viewport");
    }
    signal.throwIfAborted();
    const browser = await (this.config.launchBrowser?.() ??
      chromium.launch({ headless: true, timeout: 30000 }));
    let openingCleanup: Promise<void> | undefined;
    const closeOpeningBrowser = () => (openingCleanup ??= browser.close());
    const onOpeningAbort = () => {
      void closeOpeningBrowser().catch(() => {});
    };
    signal.addEventListener("abort", onOpeningAbort, { once: true });
    try {
      signal.throwIfAborted();
      const context = await browser.newContext({
        viewport: options.viewport ?? { width: 1280, height: 720 },
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      const page = await context.newPage();
      const session = new PlaywrightSession(
        browser,
        context,
        page,
        options.runId,
        location,
        origins,
        signal,
        this.config.resolveSecret,
        purpose,
      );
      await session.initialize();
      signal.throwIfAborted();
      return session;
    } catch (error) {
      await closeOpeningBrowser();
      throw error;
    } finally {
      signal.removeEventListener("abort", onOpeningAbort);
    }
  }
}

class PlaywrightSession implements BrowserSession {
  private readonly secrets = new Set<string>();
  private readonly artifacts: Evidence[] = [];
  private closePromise?: Promise<void>;
  private busy = false;
  private policyViolation = false;
  private policyReported = false;
  private captureFailed = false;
  private networkFailure?: Error;
  private navigationStatus?: number;
  private readonly onRunAbort = () => {
    void this.close().catch(() => {
      /* close() rethrows to the owner */
    });
  };

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly runId: string,
    private readonly location: { path: string; directory: string } | undefined,
    private readonly origins: ReadonlySet<string>,
    private readonly runSignal: AbortSignal,
    private readonly resolveSecret?: (name: string) => string | undefined,
    private readonly purpose: "run" | "inspection" = "run",
  ) {}

  async initialize() {
    // Chromium Fetch pauses each redirect hop before it reaches the network.
    // Playwright route.continue alone does not intercept redirected requests.
    const network = await this.context.newCDPSession(this.page);
    network.on("Fetch.requestPaused", (event) => {
      const permitted =
        permitsUrl(event.request.url, this.origins) &&
        (this.purpose === "run" ||
          ["GET", "HEAD", "OPTIONS"].includes(event.request.method));
      if (!permitted) this.policyViolation = true;
      const action = permitted
        ? network.send("Fetch.continueRequest", { requestId: event.requestId })
        : network.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
      void action.catch(() => {
        if (!this.closePromise) {
          this.networkFailure = new Error(
            "Browser network policy enforcement failed",
          );
          void this.close().catch(() => {});
        }
      });
    });
    await network.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    await this.context.route("**/*", async (route) => {
      try {
        let mainFrame = false;
        try {
          mainFrame = route.request().frame() === this.page.mainFrame();
        } catch {
          // Popup/worker navigation can arrive before a frame exists.
        }
        if (
          !permitsUrl(route.request().url(), this.origins) ||
          !mainFrame ||
          (this.purpose === "inspection" &&
            !["GET", "HEAD", "OPTIONS"].includes(route.request().method()))
        ) {
          this.policyViolation = true;
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      } catch {
        if (!this.closePromise) {
          this.networkFailure = new Error("Browser request routing failed");
          void this.close().catch(() => {});
        }
      }
    });
    await this.context.routeWebSocket("**/*", (socket) => {
      socket.close();
    });
    this.context.on("page", (popup) => {
      if (popup !== this.page) {
        this.policyViolation = true;
        void popup.close().catch(() => {});
      }
    });
    this.page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => {});
    });
    this.page.on("framenavigated", (frame) => {
      if (
        frame.url() !== "about:blank" &&
        !permitsUrl(frame.url(), this.origins)
      )
        this.policyViolation = true;
    });
    this.runSignal.addEventListener("abort", this.onRunAbort, { once: true });
    if (this.runSignal.aborted) {
      await this.close();
      this.runSignal.throwIfAborted();
    }
  }

  private target(target: Target): Locator {
    switch (target.by) {
      case "label":
        return this.page.getByLabel(target.value, { exact: true });
      case "testId":
        return this.page.getByTestId(target.value);
      case "role":
        return this.page.getByRole(target.role, {
          name: target.value,
          exact: true,
        });
      default:
        throw new BrowserPolicyError("Unsupported target kind");
    }
  }

  private async operation<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    this.runSignal.throwIfAborted();
    if (this.closePromise) throw new Error("Browser session is closed");
    if (this.busy)
      throw new Error("Concurrent session operations are not supported");
    this.busy = true;
    const onAbort = () => {
      void this.close().catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      const result = await work();
      signal.throwIfAborted();
      this.runSignal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.busy = false;
    }
  }

  async execute(command: Command, signal: AbortSignal): Promise<StepResult> {
    validateCommand(command);
    if (this.purpose === "inspection" && command.action !== "navigate")
      throw new BrowserPolicyError(
        "Inspection permits navigation and observation only",
      );
    if (
      !Number.isInteger(command.timeoutMs) ||
      command.timeoutMs < 1 ||
      command.timeoutMs > 120000
    )
      throw new Error("Invalid command timeout");
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(command.timeoutMs),
    ]);
    return this.operation(deadline, async () => {
      const startedAt = new Date().toISOString();
      // Reserve a quarter of the command budget for screenshot finalization.
      const workUntil = Date.now() + Math.floor(command.timeoutMs * 0.75);
      let result: StepResult;
      try {
        if (this.policyViolation)
          throw new BrowserPolicyError("Browser origin policy was violated");
        result = await this.perform(command, workUntil);
        if (this.networkFailure) throw this.networkFailure;
        if (this.policyViolation)
          throw new BrowserPolicyError("Browser origin policy was violated");
      } catch (error) {
        deadline.throwIfAborted();
        this.runSignal.throwIfAborted();
        if (this.networkFailure) throw this.networkFailure;
        if (error instanceof BrowserPolicyError || this.policyViolation) {
          result = {
            stepId: command.stepId,
            status: "blocked",
            failureKind: "prerequisite",
            reason: "Target is outside the allowed browser policy",
          };
        } else {
          throw new Error("Browser operation failed", { cause: error });
        }
      }
      await this.capture(command.stepId);
      if (result.findings)
        result = {
          ...result,
          findings: result.findings.map((finding) => ({
            ...finding,
            evidenceIds: this.artifacts
              .filter((a) => a.stepId === command.stepId)
              .map((a) => a.id),
          })),
        };
      if (this.networkFailure) throw this.networkFailure;
      if (this.policyViolation) {
        this.policyReported = true;
        result = {
          stepId: command.stepId,
          status: "blocked",
          failureKind: "prerequisite",
          reason: "Target is outside the allowed browser policy",
        };
      }
      const safe = {
        ...result,
        expected:
          result.expected === undefined
            ? undefined
            : this.redact(result.expected),
        actual:
          result.actual === undefined ? undefined : this.redact(result.actual),
      };
      return { ...safe, startedAt, finishedAt: new Date().toISOString() };
    });
  }

  private async perform(
    command: Command,
    workUntil: number,
  ): Promise<StepResult> {
    const remaining = () => Math.max(1, workUntil - Date.now());
    if (command.action === "viewport") {
      await this.page.setViewportSize({
        width: command.width,
        height: command.height,
      });
      return {
        stepId: command.stepId,
        status: "passed",
        actual: `${command.width}×${command.height}`,
      };
    }
    if (command.action === "assertHttp") {
      if (!permitsUrl(command.url, this.origins))
        throw new BrowserPolicyError("Navigation rejected");
      const response = await this.page.goto(command.url, {
        waitUntil: "domcontentloaded",
        timeout: remaining(),
      });
      this.navigationStatus = response?.status();
      if (!response)
        return {
          stepId: command.stepId,
          status: "blocked",
          failureKind: "prerequisite",
          reason: "No HTTP response was received",
        };
      return this.check(
        command.stepId,
        command.statuses.includes(response.status()),
        command.statuses.join(" or "),
        String(response.status()),
        "security",
        "http-access",
      );
    }
    if (command.action === "assertLayout") {
      await this.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const size = await this.page.evaluate(() => ({
        width: innerWidth,
        content: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0,
        ),
      }));
      let contained = true;
      if (command.target) {
        const locator = this.target(command.target);
        if ((await locator.count()) !== 1)
          return {
            stepId: command.stepId,
            status: "blocked",
            failureKind: "prerequisite",
            reason: "Layout target must match exactly one element",
          };
        const box = await locator.boundingBox();
        contained =
          !!box &&
          box.width > 0 &&
          box.height > 0 &&
          box.x >= -1 &&
          box.x + box.width <= size.width + 1 &&
          (await locator.isVisible());
      }
      return this.check(
        command.stepId,
        size.content <= size.width + 1 && contained,
        "No horizontal overflow; target visible within viewport width",
        `viewport=${size.width}; content=${size.content}; targetContained=${contained}`,
        "responsive",
        "viewport-layout",
      );
    }
    if (command.action === "accessibility") {
      await this.page.evaluate(axe.source);
      const result = await this.page.evaluate(async (tags) => {
        return (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "tag", values: tags },
        });
      }, command.tags);
      const findings = result.violations.map((rule) => ({
        id: randomUUID(),
        category: "accessibility" as const,
        ruleId: rule.id,
        severity:
          rule.impact === "critical"
            ? ("critical" as const)
            : rule.impact === "serious"
              ? ("high" as const)
              : ("medium" as const),
        message: `${rule.help} (${rule.nodes.length} affected elements)`,
        stepId: command.stepId,
        evidenceIds: [],
      }));
      const checked = this.check(
        command.stepId,
        findings.length === 0,
        "0 automated WCAG violations",
        `${findings.length} violations; ${result.incomplete.length} rules need manual review`,
        "accessibility",
        "axe",
      );
      if (!findings.length && result.incomplete.length)
        return {
          ...checked,
          status: "blocked",
          failureKind: "prerequisite",
          reason: "Axe reported incomplete checks requiring manual review",
          findings,
        };
      return { ...checked, findings };
    }
    if (command.action === "assertRequirement") {
      const result = await this.perform(
        {
          action: "assert",
          stepId: command.stepId,
          timeoutMs: command.timeoutMs,
          target: command.target,
          expectation: command.expectation,
        },
        workUntil,
      );
      return {
        ...result,
        requirement: {
          id: command.requirementId,
          text: command.requirement,
          source: command.source,
        },
        findings:
          result.status === "failed"
            ? [
                {
                  id: randomUUID(),
                  category: "compliance",
                  ruleId: command.requirementId,
                  severity: "medium",
                  message: command.requirement,
                  stepId: command.stepId,
                  evidenceIds: [],
                },
              ]
            : [],
      };
    }
    if (command.action === "fillSecret") {
      const value = this.resolveSecret?.(command.secret);
      if (!value)
        return {
          stepId: command.stepId,
          status: "blocked",
          failureKind: "prerequisite",
          reason: "Required server-side secret is not configured",
        };
      this.secrets.add(value);
      return this.perform(
        {
          action: "fill",
          stepId: command.stepId,
          timeoutMs: command.timeoutMs,
          target: command.target,
          value,
        },
        workUntil,
      );
    }
    if (command.action === "navigate") {
      if (!permitsUrl(command.url, this.origins))
        throw new BrowserPolicyError("Navigation rejected");
      const response = await this.page.goto(command.url, {
        waitUntil: "domcontentloaded",
        timeout: remaining(),
      });
      this.navigationStatus = response?.status();
      if (response && !response.ok())
        return {
          stepId: command.stepId,
          status: "blocked",
          failureKind: "prerequisite",
          reason: "Target returned an unsuccessful HTTP response",
          actual: String(response.status()),
        };
    } else {
      const locator = this.target(command.target);
      if (
        command.action === "assert" &&
        command.expectation.kind === "visible" &&
        command.expectation.value === false &&
        (await locator.count()) <= 1
      )
        return this.assert(command, locator, workUntil);
      // Presence is a prerequisite. Multiple exact matches must never select an arbitrary element.
      let count = 0;
      let readFailure: unknown;
      try {
        await expect
          .poll(
            async () => {
              try {
                count = await locator.count();
                return count;
              } catch (error) {
                readFailure = error;
                throw error;
              }
            },
            { timeout: remaining(), intervals: [25, 50, 100] },
          )
          .toBeGreaterThan(0);
      } catch {
        if (readFailure) throw readFailure;
      }
      if (
        count === 0 &&
        command.action === "assert" &&
        command.expectation.kind === "visible" &&
        command.expectation.value === false
      )
        return {
          stepId: command.stepId,
          status: "passed",
          expected: "false",
          actual: "false",
        };
      if (count !== 1)
        return {
          stepId: command.stepId,
          status: "blocked",
          failureKind: "prerequisite",
          reason:
            count === 0
              ? "Target was not found"
              : "Target matched multiple elements",
        };
      switch (command.action) {
        case "fill":
          await locator.fill(command.value, { timeout: remaining() });
          break;
        case "click":
          await locator.click({ timeout: remaining() });
          break;
        case "setChecked":
          await locator.setChecked(command.checked, {
            timeout: remaining(),
          });
          break;
        case "assert":
          return this.assert(command, locator, workUntil);
        default: {
          const unknown: never = command;
          throw new Error(`Unsupported action ${String(unknown)}`);
        }
      }
    }
    return { stepId: command.stepId, status: "passed" };
  }

  private async assert(
    command: Extract<Command, { action: "assert" }>,
    locator: Locator,
    workUntil: number,
  ): Promise<StepResult> {
    const expected = String(command.expectation.value);
    let actual = "";
    let readFailure: unknown;
    // Explicit observed values distinguish a failed condition from transport failures.
    const read = async () => {
      switch (command.expectation.kind) {
        case "visible":
          actual = String(await locator.isVisible());
          break;
        case "checked":
          actual = String(
            await locator.isChecked({
              timeout: Math.max(1, workUntil - Date.now()),
            }),
          );
          break;
        case "text":
          actual = await locator.innerText({
            timeout: Math.max(1, workUntil - Date.now()),
          });
          break;
      }
      return actual;
    };
    try {
      await expect
        .poll(
          async () => {
            try {
              return await read();
            } catch (error) {
              readFailure = error;
              throw error;
            }
          },
          {
            timeout: Math.max(1, workUntil - Date.now()),
            intervals: [25, 50, 100],
          },
        )
        .toBe(expected);
    } catch {
      if (readFailure) throw readFailure;
    }
    const passed = actual === expected;
    return passed
      ? {
          stepId: command.stepId,
          status: "passed",
          expected: expected.slice(0, 2000),
          actual: actual.slice(0, 2000),
        }
      : {
          stepId: command.stepId,
          status: "failed",
          failureKind: "assertion",
          reason: "Observed value did not match the expected value",
          expected: expected.slice(0, 2000),
          actual: actual.slice(0, 2000),
        };
  }

  private redact(text: string) {
    for (const secret of this.secrets)
      text = text.replaceAll(secret, "[REDACTED]");
    return text;
  }

  private check(
    stepId: string,
    passed: boolean,
    expected: string,
    actual: string,
    category: "responsive" | "security" | "accessibility",
    ruleId: string,
  ): StepResult {
    const base = { stepId, expected, actual };
    return passed
      ? { ...base, status: "passed" }
      : {
          ...base,
          status: "failed",
          failureKind: "assertion",
          reason: "Observed check did not meet the expected condition",
          findings: [
            {
              id: randomUUID(),
              category,
              ruleId,
              severity: "medium",
              message: expected,
              stepId,
              evidenceIds: [],
            },
          ],
        };
  }

  private async capture(stepId: string) {
    // Authenticated pages can echo secrets anywhere; omit media rather than leak them.
    if (this.secrets.size || !this.location) return;
    const id = randomUUID();
    try {
      const bytes = await this.page.screenshot({
        type: "png",
        timeout: 5000,
        mask: [this.page.locator('input[type="password"]')],
      });
      await writeFile(join(this.location.path, `${id}.png`), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      this.artifacts.push({
        id,
        runId: this.runId,
        stepId,
        kind: "screenshot",
        mediaType: "image/png",
        artifactPath: `${this.location.directory}/${id}.png`,
      });
    } catch (error) {
      this.captureFailed = true;
      throw new Error("Screenshot capture could not be finalized", {
        cause: error,
      });
    }
  }

  async observe(
    maxCharacters: number,
    signal: AbortSignal,
  ): Promise<BrowserObservation> {
    if (
      !Number.isInteger(maxCharacters) ||
      maxCharacters < 1 ||
      maxCharacters > 20000
    )
      throw new Error("Invalid observation limit");
    return this.operation(
      AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      async () => {
        if (this.networkFailure) throw this.networkFailure;
        if (this.policyViolation)
          throw new BrowserPolicyError(
            "Observation rejected by browser policy",
          );
        const observation = await readBrowserObservation(
          this.page,
          maxCharacters,
          this.origins,
          (target) => this.target(target),
        );
        if (this.networkFailure) throw this.networkFailure;
        if (this.policyViolation)
          throw new BrowserPolicyError(
            "Observation rejected by browser policy",
          );
        const url = new URL(this.page.url());
        url.search = "";
        url.hash = "";
        url.username = "";
        url.password = "";
        return {
          ...observation,
          navigationStatus: this.navigationStatus,
          title: this.redact(observation.title),
          text: this.redact(observation.text),
          links: observation.links?.map((link) => ({
            url: this.redact(link.url),
            label: this.redact(link.label),
          })),
          targets: observation.targets.filter(
            (target) =>
              ![...this.secrets].some((secret) =>
                target.value.includes(secret),
              ),
          ),
          url: this.redact(url.toString().slice(0, 2048)),
        };
      },
    );
  }

  async evidence(): Promise<readonly Evidence[]> {
    if (this.busy)
      throw new Error("Cannot finalize evidence during an operation");
    await this.close();
    if (this.networkFailure) throw this.networkFailure;
    if (this.policyViolation && !this.policyReported)
      throw new BrowserPolicyError(
        "Unreported browser policy violation during finalization",
      );
    if (this.captureFailed) throw new Error("Evidence capture is incomplete");
    return structuredClone(this.artifacts);
  }

  close(): Promise<void> {
    this.closePromise ??= this.release();
    return this.closePromise;
  }

  private async release() {
    this.runSignal.removeEventListener("abort", this.onRunAbort);
    try {
      await this.context.close();
    } finally {
      await this.browser.close();
    }
  }
}
