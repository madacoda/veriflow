import { platformRoute } from "../../../../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; workflowId: string }> },
) {
  const { projectId, workflowId } = await params;
  return platformRoute((http) =>
    http.workflowGET(request, projectId, workflowId),
  );
}
