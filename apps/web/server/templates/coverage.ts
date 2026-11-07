import { z } from "zod";
import {
  workflowSchema,
  stepSchema,
  targetSchema,
  expectationSchema,
  httpUrlSchema,
  viewportSchema,
  type TemplateDefinition,
} from "@veriflow/core";

type Step = z.input<typeof stepSchema>;
const target = (value: string) => ({ by: "testId" as const, value });
const navigation = (url: string): Step => ({
  id: "open",
  code: "redirect",
  url,
});
const assertion = (id: string, value: string, text: string): Step => ({
  id,
  code: "assert",
  target: target(value),
  expectation: { kind: "text", value: text },
});
const url = httpUrlSchema;
function entry<T extends z.ZodType>(
  id: string,
  title: string,
  category: TemplateDefinition["category"],
  schema: T,
  defaults: object,
  build: (p: z.output<T>) => Step[],
  capabilities: TemplateDefinition["requiredCapabilities"],
) {
  return {
    definition: {
      id,
      title,
      category,
      version: "1.1.0",
      prerequisites: [
        "Target permits browser testing and exposes the configured exact labels or test IDs.",
        ...(id.includes("auth")
          ? [
              "Configure VERIFLOW_SECRET_USERNAME and VERIFLOW_SECRET_PASSWORD on the server.",
            ]
          : []),
      ],
      parameterSchema: z.toJSONSchema(schema),
      requiredCapabilities: capabilities,
    } satisfies TemplateDefinition,
    defaults,
    build: (input: unknown) => build(schema.parse(input)),
  };
}
const basic = z.strictObject({ url });
const auth = z.strictObject({
  url,
  username: targetSchema,
  password: targetSchema,
  submit: targetSchema,
  result: targetSchema,
  expected: z.string().min(1),
  usernameSecret: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  passwordSecret: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
});
const authDefaults = {
  username: target("username"),
  password: target("password"),
  submit: target("login"),
  result: target("auth-status"),
  expected: "Signed in",
  usernameSecret: "USERNAME",
  passwordSecret: "PASSWORD",
};
export const coverageTemplates = [
  entry(
    "functional-form",
    "Functional · form and navigation",
    "functional",
    z.strictObject({
      url,
      field: targetSchema,
      value: z.string(),
      submit: targetSchema,
      result: targetSchema,
      expected: z.string(),
    }),
    {
      field: target("coupon-input"),
      value: "SAVE10",
      submit: target("apply-coupon"),
      result: target("order-total"),
      expected: "90000",
    },
    (p) => [
      navigation(p.url),
      { id: "fill", code: "fill", target: p.field, value: p.value },
      { id: "submit", code: "click", target: p.submit },
      {
        id: "result",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.expected },
      },
    ],
    ["navigate", "fill", "click", "assert", "screenshot"],
  ),
  entry(
    "functional-auth",
    "Functional · sign in",
    "functional",
    auth,
    authDefaults,
    (p) => [
      navigation(p.url),
      {
        id: "username",
        code: "fillSecret",
        target: p.username,
        secret: p.usernameSecret,
      },
      {
        id: "password",
        code: "fillSecret",
        target: p.password,
        secret: p.passwordSecret,
      },
      { id: "login", code: "click", target: p.submit },
      {
        id: "signed-in",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.expected },
      },
    ],
    ["navigate", "fill", "click", "assert"],
  ),
  entry(
    "functional-crud",
    "Functional · create, read, update, delete",
    "functional",
    z.strictObject({
      url,
      field: targetSchema,
      create: targetSchema,
      update: targetSchema,
      remove: targetSchema,
      result: targetSchema,
      initial: z.string().min(1),
      updated: z.string().min(1),
      deleted: z.string(),
    }),
    {
      field: target("record-name"),
      create: target("create-record"),
      update: target("update-record"),
      remove: target("delete-record"),
      result: target("record"),
      initial: "First record",
      updated: "Updated record",
      deleted: "No records",
    },
    (p) => [
      navigation(p.url),
      { id: "name", code: "fill", target: p.field, value: p.initial },
      { id: "create", code: "click", target: p.create },
      {
        id: "read",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.initial },
      },
      { id: "edit", code: "fill", target: p.field, value: p.updated },
      { id: "update", code: "click", target: p.update },
      {
        id: "updated",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.updated },
      },
      { id: "delete", code: "click", target: p.remove },
      {
        id: "deleted",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.deleted },
      },
    ],
    ["navigate", "fill", "click", "assert", "screenshot"],
  ),
  entry(
    "responsive-viewports",
    "Responsive · desktop, tablet, mobile",
    "responsive",
    z.strictObject({
      url,
      target: targetSchema.optional(),
      viewports: z.array(viewportSchema).min(1).max(10),
    }),
    {
      viewports: [
        { width: 1440, height: 900 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ],
    },
    (p) => [
      navigation(p.url),
      ...p.viewports.flatMap((size, i): Step[] => [
        { id: `viewport-${i}`, code: "viewport", ...size },
        { id: `layout-${i}`, code: "assertLayout", target: p.target },
      ]),
    ],
    ["navigate", "viewport", "assert", "screenshot"],
  ),
  entry(
    "security-access",
    "Security · authentication and authorization",
    "security",
    z.strictObject({
      checks: z
        .array(
          z.strictObject({
            url,
            statuses: z
              .array(z.number().int().min(100).max(599))
              .min(1)
              .max(20),
          }),
        )
        .min(1)
        .max(20),
    }),
    { checks: [{ url: "", statuses: [401, 403] }] },
    (p) =>
      p.checks.map((check, i) => ({
        id: `access-${i}`,
        code: "assertHttp",
        ...check,
      })),
    ["navigate", "security", "screenshot"],
  ),
  entry(
    "security-input",
    "Security · rejected input",
    "security",
    z.strictObject({
      url,
      field: targetSchema,
      invalidValue: z.string(),
      submit: targetSchema,
      result: targetSchema,
      expectedError: z.string().min(1),
    }),
    {
      field: target("coupon-input"),
      invalidValue: "INVALID",
      submit: target("apply-coupon"),
      result: target("validation-error"),
      expectedError: "Enter SAVE10 to apply the demo discount.",
    },
    (p) => [
      navigation(p.url),
      {
        id: "invalid-input",
        code: "fill",
        target: p.field,
        value: p.invalidValue,
      },
      { id: "submit", code: "click", target: p.submit },
      {
        id: "rejected",
        code: "assert",
        target: p.result,
        expectation: { kind: "text", value: p.expectedError },
      },
    ],
    ["navigate", "fill", "click", "assert", "security"],
  ),
  entry(
    "compliance-checklist",
    "Compliance · supplied requirements",
    "compliance",
    z.strictObject({
      url,
      requirements: z
        .array(
          z.strictObject({
            requirementId: z.string().trim().min(1).max(128),
            requirement: z.string().trim().min(1).max(2000),
            source: z.string().trim().min(1).max(256).optional(),
            target: targetSchema,
            expectation: expectationSchema,
          }),
        )
        .min(1)
        .max(100),
    }),
    {
      requirements: [
        {
          requirementId: "REQ-001",
          requirement: "The initial order total is 100000",
          source: "Supplied checkout requirements",
          target: target("order-total"),
          expectation: { kind: "text", value: "100000" },
        },
      ],
    },
    (p) => [
      navigation(p.url),
      ...p.requirements.map((r, i): Step => ({
        id: `requirement-${i}`,
        code: "assertRequirement",
        ...r,
      })),
    ],
    ["navigate", "assert", "screenshot"],
  ),
  entry(
    "accessibility-wcag",
    "Accessibility · automated WCAG checks",
    "accessibility",
    basic,
    {},
    (p) => [navigation(p.url), { id: "wcag", code: "accessibility" }],
    ["navigate", "accessibility", "screenshot"],
  ),
  entry(
    "regression-replay",
    "Regression · replay reviewed steps",
    "regression",
    z.strictObject({ workflow: workflowSchema }),
    {
      workflow: {
        schemaVersion: "1",
        id: "baseline",
        name: "Reviewed baseline",
        steps: [
          navigation("http://localhost:3000/demo"),
          assertion("total", "order-total", "100000"),
        ],
      },
    },
    (p) => p.workflow.steps,
    ["navigate", "assert"],
  ),
];
export function templateOptions(projectUrl: string) {
  return coverageTemplates.map((t) => ({
    ...t.definition,
    defaults:
      t.definition.id === "security-access"
        ? { checks: [{ url: projectUrl, statuses: [401, 403] }] }
        : t.definition.id === "regression-replay"
          ? {
              workflow: {
                schemaVersion: "1",
                id: "baseline",
                name: "Reviewed baseline",
                steps: [
                  navigation(projectUrl),
                  assertion("total", "order-total", "100000"),
                ],
              },
            }
          : { url: projectUrl, ...t.defaults },
  }));
}
export function buildTemplate(
  id: string,
  parameters: unknown,
  workflowId: string,
) {
  const template = coverageTemplates.find((t) => t.definition.id === id);
  if (!template) throw new Error("Unknown template");
  return workflowSchema.parse({
    schemaVersion: "1",
    id: workflowId,
    name: template.definition.title,
    category: template.definition.category,
    steps: template.build(parameters),
  });
}
