import { platformRoute } from "../../../../../../../server/composition/platform.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; attachmentId: string }> },
) {
  const { projectId, attachmentId } = await params;
  return platformRoute((http) =>
    http.attachmentContentGET(projectId, attachmentId),
  );
}
