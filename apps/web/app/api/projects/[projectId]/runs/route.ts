import { platformRoute } from "../../../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return platformRoute((http) => http.runsGET(projectId));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return platformRoute((http) => http.runsPOST(request, projectId));
}
