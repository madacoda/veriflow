import { translateWorkflow, workflowSchema } from "@veriflow/core";
export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid workflow",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }
  return Response.json({ plan: translateWorkflow(parsed.data) });
}
