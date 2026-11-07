import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
const target = z.discriminatedUnion("by", [
  z.strictObject({ by: z.literal("label"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("testId"), value: z.string().min(1) }),
]);
const common = {
  id: identifier,
  timeoutMs: z.number().int().min(1).max(120000).default(30000),
};

export const stepSchema = z.discriminatedUnion("code", [
  z.strictObject({
    ...common,
    code: z.literal("redirect"),
    url: z
      .url()
      .refine(
        (value) => ["https:", "http:"].includes(new URL(value).protocol),
        "Only HTTP(S) navigation is supported",
      ),
  }),
  z.strictObject({
    ...common,
    code: z.literal("fill"),
    target,
    value: z.string(),
  }),
  z.strictObject({ ...common, code: z.literal("check"), target }),
  z.strictObject({ ...common, code: z.literal("uncheck"), target }),
]);

export const workflowSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    id: identifier,
    name: z.string().trim().min(1).max(256),
    steps: z.array(stepSchema).min(1).max(1000),
  })
  .superRefine((workflow, context) => {
    const ids = new Set<string>();
    workflow.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "Step IDs must be unique within a workflow",
        });
      }
      ids.add(step.id);
    });
  });

export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type Target = z.infer<typeof target>;
