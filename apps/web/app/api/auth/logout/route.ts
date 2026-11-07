import { logout } from "../../../../server/auth/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return logout(request);
}
