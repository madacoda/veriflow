import { platformRoute } from "../../../../../../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; runId: string; evidenceId: string }>;
  },
) {
  const { projectId, runId, evidenceId } = await params;
  return platformRoute((http) =>
    http.evidenceGET(projectId, runId, evidenceId),
  );
}
