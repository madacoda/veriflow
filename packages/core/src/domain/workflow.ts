import { z } from "zod";
import { httpUrlSchema } from "./http-url.ts";

const identifier = z.string().trim().min(1).max(128);
export const targetSchema = z.discriminatedUnion("by", [
  z.strictObject({ by: z.literal("label"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("testId"), value: z.string().min(1) }),
]);
const common = {
  id: identifier,
  timeoutMs: z.number().int().min(1).max(120000).default(30000),
};

export const expectationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("visible"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("checked"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
]);
export const testingCategories = [
  "functional",
  "responsive",
  "security",
  "compliance",
  "accessibility",
  "regression",
] as const;
export const viewportSchema = z.strictObject({
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(320).max(2160),
});

export const stepSchema = z.discriminatedUnion("code", [
  z.strictObject({
    ...common,
    code: z.literal("redirect"),
    url: httpUrlSchema,
  }),
  z.strictObject({
    ...common,
    code: z.literal("fill"),
    target: targetSchema,
    value: z.string(),
  }),
  z.strictObject({ ...common, code: z.literal("check"), target: targetSchema }),
  z.strictObject({
    ...common,
    code: z.literal("uncheck"),
    target: targetSchema,
  }),
  z.strictObject({ ...common, code: z.literal("click"), target: targetSchema }),
  z.strictObject({
    ...common,
    code: z.literal("assert"),
    target: targetSchema,
    expectation: expectationSchema,
  }),
  z.strictObject({
    ...common,
    code: z.literal("viewport"),
    ...viewportSchema.shape,
  }),
  z.strictObject({
    ...common,
    code: z.literal("assertLayout"),
    target: targetSchema.optional(),
  }),
  z.strictObject({
    ...common,
    code: z.literal("accessibility"),
    tags: z
      .array(z.enum(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]))
      .min(1)
      .max(5)
      .default(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]),
  }),
  z.strictObject({
    ...common,
    code: z.literal("assertHttp"),
    url: httpUrlSchema,
    statuses: z.array(z.number().int().min(100).max(599)).min(1).max(20),
  }),
  z.strictObject({
    ...common,
    code: z.literal("fillSecret"),
    target: targetSchema,
    secret: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  }),
  z.strictObject({
    ...common,
    code: z.literal("assertRequirement"),
    requirementId: identifier,
    requirement: z.string().trim().min(1).max(2000),
    source: z.string().trim().min(1).max(256).optional(),
    target: targetSchema,
    expectation: expectationSchema,
  }),
]);

export const workflowSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    id: identifier,
    name: z.string().trim().min(1).max(256),
    category: z.enum(testingCategories).optional(),
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
export type Target = z.infer<typeof targetSchema>;
