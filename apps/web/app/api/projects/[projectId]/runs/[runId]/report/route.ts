import { platformRoute } from "../../../../../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const { projectId, runId } = await params;
  return platformRoute((http) => http.reportGET(request, projectId, runId));
}
