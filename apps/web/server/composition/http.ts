import { randomUUID } from "node:crypto";
import { buildTemplate, templateOptions } from "../templates/coverage.ts";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  createProjectSchema,
  saveWorkflowSchema,
  startRunSchema,
  MAX_ATTACHMENT_BYTES,
  type ApiError,
  type ReportFormat,
} from "@veriflow/core";
import { PlatformError, PlatformStore } from "../projects/platform-store.ts";
import { RunCoordinator } from "../runs/coordinator.ts";
import { evidencePath } from "../runs/evidence.ts";
import { AttachmentStore } from "../attachments/store.ts";
import { ReportDownloads } from "../runs/report-downloads.ts";
import { readRequestBody } from "./request-body.ts";

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
  try {
    return JSON.parse(
      Buffer.from(await readRequestBody(request, JSON_LIMIT)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("invalid_json", 400, "Invalid JSON");
  }
}
function downloadResponse(file: {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
}) {
  const encoded = encodeURIComponent(file.filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const ascii = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mediaType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
    private readonly attachments = new AttachmentStore(store),
    private readonly reports = new ReportDownloads(store),
  ) {}
  private async respond(action: () => Promise<unknown>, status = 200) {
    try {
      const result = await action();
      if (result instanceof Response) return result;
      return Response.json(result, {
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
  templatesGET(projectId: string) {
    return this.respond(async () => ({
      templates: templateOptions((await this.store.getProject(projectId)).url),
    }));
  }
  templatesPOST(request: Request, projectId: string) {
    return this.respond(async () => {
      const project = await this.store.getProject(projectId);
      const body = validate(
        z.strictObject({
          templateId: z.string().min(1),
          parameters: z.unknown(),
        }),
        await json(request),
      );
      let workflow;
      try {
        workflow = buildTemplate(
          body.templateId,
          body.parameters,
          randomUUID(),
        );
      } catch {
        throw new PlatformError(
          "validation_error",
          422,
          "Template parameters are invalid. Use the template parameter schema.",
        );
      }
      for (const step of workflow.steps) {
        if (
          (step.code === "redirect" || step.code === "assertHttp") &&
          !project.allowedOrigins.includes(new URL(step.url).origin)
        )
          throw new PlatformError(
            "validation_error",
            422,
            "Template navigation must stay within the project origins",
          );
      }
      return { workflow };
    });
  }
  workflowsGET(projectId: string) {
    return this.respond(async () => ({
      workflows: await this.store.listWorkflows(projectId),
    }));
  }
  attachmentsGET(projectId: string) {
    return this.respond(async () => ({
      attachments: await this.store.listAttachments(projectId),
    }));
  }
  attachmentGET(projectId: string, attachmentId: string) {
    return this.respond(async () => ({
      attachment: await this.store.getAttachment(projectId, attachmentId),
    }));
  }
  attachmentContentGET(projectId: string, attachmentId: string) {
    return this.respond(async () => {
      const { metadata, bytes } = await this.attachments.read(
        projectId,
        attachmentId,
      );
      return downloadResponse({
        bytes,
        mediaType: metadata.mediaType,
        filename: metadata.filename,
      });
    });
  }
  attachmentsPOST(request: Request, projectId: string) {
    return this.respond(async () => {
      await this.store.getProject(projectId);
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^multipart\/form-data\s*;/i.test(contentType))
        throw new ValidationError([
          {
            path: "file",
            message: "Use multipart/form-data with one file field",
          },
        ]);
      const bytes = await readRequestBody(
        request,
        MAX_ATTACHMENT_BYTES + 64 * 1024,
      );
      let form: FormData;
      try {
        form = await new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: new Uint8Array(bytes),
        }).formData();
      } catch {
        throw new ValidationError([
          { path: "file", message: "Invalid multipart body" },
        ]);
      }
      const entries = [...form.entries()];
      const file = form.get("file");
      if (
        entries.length !== 1 ||
        entries[0][0] !== "file" ||
        !(file instanceof File)
      )
        throw new ValidationError([
          {
            path: "file",
            message: "Provide exactly one file field and no other fields",
          },
        ]);
      return {
        attachment: await this.attachments.upload(projectId, {
          filename: file.name,
          mediaType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }),
      };
    }, 201);
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
      const formats = new URL(request.url).searchParams.getAll("format");
      if (!formats.length)
        return { snapshot: await this.store.report(projectId, runId) };
      if (formats.length !== 1 || !["csv", "xlsx", "pdf"].includes(formats[0]))
        throw new ValidationError([
          { path: "format", message: "Expected csv, xlsx or pdf" },
        ]);
      return downloadResponse(
        await this.reports.download(
          projectId,
          runId,
          formats[0] as ReportFormat,
        ),
      );
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
