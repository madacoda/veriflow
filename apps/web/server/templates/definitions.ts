import type { TemplateDefinition } from "@veriflow/core";

const emptyParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/** Definition metadata only. These do not introduce workflow steps or executor implementations. */
export const additionalDefinitions: readonly TemplateDefinition[] = [
  {
    id: "responsive-layout",
    version: "1.0.0",
    title: "Layout at specified viewport sizes",
    category: "responsive",
    prerequisites: [
      "An allowed target URL and exact test IDs for the important page content are supplied",
      "The viewport adapter can apply every requested width and height before checking layout",
      "Generation is unavailable until the shared workflow contract can represent viewport changes and layout checks",
    ],
    parameterSchema: {
      type: "object",
      properties: {
        viewports: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          uniqueItems: true,
          items: {
            type: "object",
            properties: {
              width: { type: "integer", minimum: 320, maximum: 3840 },
              height: { type: "integer", minimum: 320, maximum: 2160 },
            },
            required: ["width", "height"],
            additionalProperties: false,
          },
        },
        testIds: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
      required: ["viewports", "testIds"],
      additionalProperties: false,
    },
    requiredCapabilities: ["navigate", "viewport", "assert", "screenshot"],
  },
  {
    id: "security-passive-baseline",
    version: "1.0.0",
    title: "Specified passive security checks",
    category: "security",
    prerequisites: [
      "The project owner authorizes the configured target origins",
      "The security adapter can inspect the selected transport or response-header checks without attack payloads",
      "Generation is unavailable until the shared workflow contract represents the selected security checks",
      "Results cover only the selected checks and do not establish that the application is secure",
    ],
    parameterSchema: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "https",
              "content-security-policy",
              "x-content-type-options",
            ],
          },
        },
      },
      required: ["checks"],
      additionalProperties: false,
    },
    requiredCapabilities: ["navigate", "security"],
  },
  {
    id: "requirements-acceptance",
    version: "1.0.0",
    title: "Observable checks from supplied requirements",
    category: "compliance",
    prerequisites: [
      "At least one project-owned text attachment supplies the requirements through generation context",
      "Supplied requirements identify observable acceptance criteria and exact page targets",
      "A reviewer checks draft coverage against the supplied sources before saving",
      "This is supplied-requirement checking, not legal, regulatory or accessibility certification",
    ],
    // Sources already travel through generationRequest.attachmentIds, not invented template bindings.
    parameterSchema: emptyParameters,
    requiredCapabilities: [
      "navigate",
      "fill",
      "click",
      "setChecked",
      "assert",
      "screenshot",
    ],
  },
  {
    id: "accessibility-page-audit",
    version: "1.0.0",
    title: "Automated accessibility checks on a settled page",
    category: "accessibility",
    prerequisites: [
      "The allowed target page is loaded in the intended authenticated or public state",
      "An accessibility adapter such as axe can run the requested rule tags and return observed findings",
      "Generation is unavailable until the shared workflow contract represents accessibility audits",
      "Automated findings do not replace manual accessibility evaluation or establish certification",
    ],
    parameterSchema: {
      type: "object",
      properties: {
        ruleTags: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        },
      },
      required: ["ruleTags"],
      additionalProperties: false,
    },
    requiredCapabilities: ["navigate", "accessibility", "screenshot"],
  },
  {
    id: "regression-saved-revision",
    version: "1.0.0",
    title: "Rerun an exact reviewed workflow revision",
    category: "regression",
    prerequisites: [
      "An existing reviewed workflow and positive revision belong to the selected project",
      "The coordinator loads and pins that revision and checks the capabilities of its actual steps",
      "Every rerun creates a new run and new evidence references without changing the saved revision",
      "Draft generation is unavailable: generationRequest cannot carry or load the required saved revision; use the existing pinned-revision run path",
    ],
    parameterSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", minLength: 1, maxLength: 128 },
        revision: { type: "integer", minimum: 1 },
      },
      required: ["workflowId", "revision"],
      additionalProperties: false,
    },
    requiredCapabilities: [
      "navigate",
      "fill",
      "click",
      "setChecked",
      "assert",
      "screenshot",
    ],
  },
];
