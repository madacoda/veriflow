import { platformRoute } from "../../../../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The static action must preserve reads of the previously valid ID "generate".
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return platformRoute((http) =>
    http.workflowGET(request, projectId, "generate"),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return platformRoute((http) => http.generatePOST(request, projectId));
}
