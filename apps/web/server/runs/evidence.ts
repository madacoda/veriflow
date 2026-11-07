import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { entityIdSchema, type Evidence } from "@veriflow/core";

const media = {
  screenshot: "image/png",
  video: "video/webm",
  trace: "application/zip",
};
/** Resolve only registered artifacts. Symlinks and paths cannot escape the persistent root. */
export async function evidencePath(
  root: string,
  artifact: Evidence,
): Promise<string> {
  entityIdSchema.parse(artifact.id);
  entityIdSchema.parse(artifact.runId);
  if (
    !["screenshot", "video", "trace"].includes(artifact.kind) ||
    artifact.mediaType !== media[artifact.kind] ||
    !artifact.artifactPath.startsWith(`runs/${artifact.runId}/`) ||
    /[\\\0]/.test(artifact.artifactPath) ||
    artifact.artifactPath
      .split("/")
      .some((part) => ["", ".", ".."].includes(part))
  )
    throw new Error("Invalid artifact metadata");
  const base = await realpath(root);
  const filename = await realpath(resolve(base, artifact.artifactPath));
  if (
    !filename.startsWith(`${base}${sep}`) ||
    filename !== resolve(base, artifact.artifactPath) ||
    !(await stat(filename)).isFile()
  )
    throw new Error("Invalid artifact location");
  return filename;
}
export async function validateEvidence(
  root: string,
  runId: string,
  stepIds: ReadonlySet<string>,
  artifacts: readonly Evidence[],
) {
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (
      artifact.runId !== runId ||
      (artifact.stepId && !stepIds.has(artifact.stepId)) ||
      ids.has(artifact.id)
    )
      throw new Error("Artifact ownership mismatch");
    await evidencePath(root, artifact);
    ids.add(artifact.id);
  }
}
