import { readFile } from "node:fs/promises";
import {
  createProjectSchema,
  saveWorkflowSchema,
  startRunSchema,
  type ApiError,
} from "@veriflow/core";
import { PlatformError, PlatformStore } from "../projects/platform-store.ts";
import { RunCoordinator } from "../runs/coordinator.ts";
import { evidencePath } from "../runs/evidence.ts";

const JSON_LIMIT = 1024 * 1024;
class ValidationError extends PlatformError {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super("validation_error", 422, "Request validation failed");
  }
}
interface Schema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: readonly { path: readonly PropertyKey[]; message: string }[];
        };
      };
}
function validate<T>(schema: Schema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  return result.data;
}
async function json(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PlatformError("invalid_json", 400, "Invalid JSON");
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > JSON_LIMIT) {
        await reader.cancel();
        throw new PlatformError(
          "payload_too_large",
          413,
          "JSON body exceeds 1 MiB",
        );
      }
      parts.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("invalid_json", 400, "Invalid JSON");
  } finally {
    reader.releaseLock();
  }
}
export function errorResponse(error: unknown) {
  const known = error instanceof PlatformError;
  const body: ApiError = {
    error: {
      code: known ? error.code : "internal_error",
      message: known ? error.message : "The request could not be completed",
    },
  };
  if (error instanceof ValidationError) body.error.issues = error.issues;
  return Response.json(body, {
    status: known ? error.status : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
export class PlatformHttp {
  constructor(
    private readonly store: PlatformStore,
    private readonly coordinator: RunCoordinator,
  ) {}
  private async respond(action: () => Promise<unknown>, status = 200) {
    try {
      return Response.json(await action(), {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return errorResponse(error);
    }
  }
  projectsGET() {
    return this.respond(async () => ({
      projects: await this.store.listProjects(),
    }));
  }
  projectsPOST(request: Request) {
    return this.respond(
      async () => ({
        project: await this.store.createProject(
          validate(createProjectSchema, await json(request)),
        ),
      }),
      201,
    );
  }
  projectGET(projectId: string) {
    return this.respond(async () => ({
      project: await this.store.getProject(projectId),
    }));
  }
  workflowsGET(projectId: string) {
    return this.respond(async () => ({
      workflows: await this.store.listWorkflows(projectId),
    }));
  }
  workflowsPOST(request: Request, projectId: string) {
    return this.respond(
      async () => ({
        workflow: await this.store.saveWorkflow(
          projectId,
          validate(saveWorkflowSchema, await json(request)),
        ),
      }),
      201,
    );
  }
  workflowGET(request: Request, projectId: string, workflowId: string) {
    return this.respond(async () => {
      const query = new URL(request.url).searchParams.get("revision");
      if (
        query !== null &&
        (!/^[1-9]\d*$/.test(query) || !Number.isSafeInteger(Number(query)))
      )
        throw new ValidationError([
          { path: "revision", message: "Expected a positive integer revision" },
        ]);
      return {
        workflow: await this.store.getWorkflow(
          projectId,
          workflowId,
          query === null ? undefined : Number(query),
        ),
      };
    });
  }
  runsGET(projectId: string) {
    return this.respond(async () => ({
      runs: await this.store.listRuns(projectId),
    }));
  }
  runsPOST(request: Request, projectId: string) {
    return this.respond(
      async () => ({
        run: await this.coordinator.start(
          projectId,
          validate(startRunSchema, await json(request)),
        ),
      }),
      202,
    );
  }
  runGET(projectId: string, runId: string) {
    return this.respond(async () => ({
      run: await this.store.getRun(projectId, runId),
    }));
  }
  cancelPOST(projectId: string, runId: string) {
    return this.respond(async () => ({
      run: await this.coordinator.cancel(projectId, runId),
    }));
  }
  reportGET(request: Request, projectId: string, runId: string) {
    return this.respond(async () => {
      const snapshot = await this.store.report(projectId, runId);
      if (new URL(request.url).searchParams.has("format"))
        throw new PlatformError(
          "adapter_unavailable",
          503,
          "Report renderer is not configured",
        );
      return { snapshot };
    });
  }
  async evidenceGET(projectId: string, runId: string, evidenceId: string) {
    try {
      const run = await this.store.getRun(projectId, runId);
      const artifact = run.evidence.artifacts.find(
        (entry) => entry.id === evidenceId,
      );
      if (!artifact)
        throw new PlatformError("not_found", 404, "Evidence not found");
      const filename = await evidencePath(this.store.storageRoot, artifact);
      const bytes = await readFile(filename);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": artifact.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `inline; filename="${artifact.id}.${artifact.kind === "screenshot" ? "png" : artifact.kind === "video" ? "webm" : "zip"}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  }
}
