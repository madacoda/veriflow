import { platformRoute } from "../../../server/composition/platform.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return platformRoute((http) => http.templateCatalogGET());
}
