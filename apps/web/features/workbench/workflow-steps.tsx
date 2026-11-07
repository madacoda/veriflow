"use client";

import type { Target, WorkflowStep } from "@veriflow/core";
import { Input } from "../ui/primitives";
import styles from "./workbench.module.css";

const actions: Record<WorkflowStep["code"], string> = {
  redirect: "Open a page",
  fill: "Enter text",
  click: "Click an element",
  check: "Select a checkbox",
  uncheck: "Clear a checkbox",
  assert: "Check an element",
  viewport: "Resize the browser",
  assertLayout: "Check the page layout",
  accessibility: "Check accessibility",
  assertHttp: "Check an HTTP response",
  fillSecret: "Enter a saved secret",
  assertRequirement: "Check a requirement",
};
const targetName = (target: Target) =>
  target.by === "label" ? target.value : target.value.replace(/[-_]+/g, " ");

export function describeStep(step: WorkflowStep): string {
  switch (step.code) {
    case "redirect":
      return `Open ${step.url}`;
    case "fill":
      return `Enter “${step.value}” in ${targetName(step.target)}`;
    case "fillSecret":
      return `Fill ${targetName(step.target)} with saved secret ${step.secret}`;
    case "click":
      return `Click ${targetName(step.target)}`;
    case "check":
      return `Select ${targetName(step.target)}`;
    case "uncheck":
      return `Clear ${targetName(step.target)}`;
    case "assert":
    case "assertRequirement": {
      const check =
        step.expectation.kind === "text"
          ? `Check ${targetName(step.target)} reads “${step.expectation.value}”`
          : `Check ${targetName(step.target)} is ${step.expectation.value ? "" : "not "}${step.expectation.kind === "visible" ? "visible" : "selected"}`;
      return step.code === "assertRequirement"
        ? `${step.requirementId}: ${step.requirement}. ${check}`
        : check;
    }
    case "viewport":
      return `Set the browser to ${step.width} × ${step.height} pixels`;
    case "assertLayout":
      return step.target
        ? `Check ${targetName(step.target)} fits inside the screen`
        : "Check the page fits the screen without horizontal scrolling";
    case "accessibility":
      return `Check accessibility against ${step.tags.map((tag) => tag.toUpperCase()).join(", ")}`;
    case "assertHttp":
      return `Check ${step.url} returns HTTP ${step.statuses.join(" or ")}`;
  }
}

function newStep(
  code: WorkflowStep["code"],
  id: string,
  timeoutMs = 30000,
): WorkflowStep {
  const common = { id, timeoutMs };
  const target = { by: "label" as const, value: "Element label" };
  switch (code) {
    case "redirect":
      return { ...common, code, url: "https://example.com" };
    case "assertHttp":
      return { ...common, code, url: "https://example.com", statuses: [200] };
    case "fill":
      return { ...common, code, target, value: "" };
    case "fillSecret":
      return { ...common, code, target, secret: "SAVED_SECRET" };
    case "check":
    case "uncheck":
    case "click":
      return { ...common, code, target };
    case "assert":
      return {
        ...common,
        code,
        target,
        expectation: { kind: "text", value: "" },
      };
    case "assertRequirement":
      return {
        ...common,
        code,
        target,
        requirementId: "REQ-001",
        requirement: "Describe the requirement",
        expectation: { kind: "text", value: "" },
      };
    case "viewport":
      return { ...common, code, width: 1280, height: 720 };
    case "assertLayout":
      return { ...common, code };
    case "accessibility":
      return {
        ...common,
        code,
        tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      };
  }
}

function StepFields({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
}) {
  const text = (
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
    <label className={styles.field}>
      {label}
      <Input
        value={value}
        onChange={(event) => change(event.currentTarget.value)}
      />
    </label>
  );
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (value: number) => void,
  ) => (
    <label className={styles.field}>
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => change(event.currentTarget.valueAsNumber)}
      />
    </label>
  );
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        Action
        <select
          value={step.code}
          onChange={(event) =>
            onChange(
              newStep(
                event.currentTarget.value as WorkflowStep["code"],
                step.id,
                step.timeoutMs,
              ),
            )
          }
        >
          {Object.entries(actions).map(([code, label]) => (
            <option value={code} key={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {"url" in step &&
        text("Page URL", step.url, (url) => onChange({ ...step, url }))}
      {"target" in step && step.target && (
        <div className={styles.fields}>
          <label className={styles.field}>
            Find element by
            <select
              value={step.target.by}
              onChange={(event) =>
                onChange({
                  ...step,
                  target: {
                    by: event.currentTarget.value as Target["by"],
                    value: step.target!.value,
                  },
                })
              }
            >
              <option value="label">Visible label</option>
              <option value="testId">Test ID</option>
            </select>
          </label>
          {text("Element", step.target.value, (value) =>
            onChange({ ...step, target: { ...step.target!, value } }),
          )}
        </div>
      )}
      {step.code === "fill" &&
        text("Text to enter", step.value, (value) =>
          onChange({ ...step, value }),
        )}
      {step.code === "fillSecret" && (
        <>
          {text("Saved secret reference", step.secret, (secret) =>
            onChange({ ...step, secret }),
          )}
          <p>
            Use the name of a server-configured secret. Do not enter a password
            here.
          </p>
        </>
      )}
      {"expectation" in step && (
        <>
          <label className={styles.field}>
            Check that
            <select
              value={step.expectation.kind}
              onChange={(event) =>
                onChange({
                  ...step,
                  expectation:
                    event.currentTarget.value === "text"
                      ? { kind: "text", value: "" }
                      : {
                          kind: event.currentTarget.value as
                            "visible" | "checked",
                          value: true,
                        },
                })
              }
            >
              <option value="text">Text matches</option>
              <option value="visible">Element is visible</option>
              <option value="checked">Checkbox is selected</option>
            </select>
          </label>
          {step.expectation.kind === "text" ? (
            text("Expected text", step.expectation.value, (value) =>
              onChange({ ...step, expectation: { kind: "text", value } }),
            )
          ) : (
            <label className={styles.field}>
              Expected state
              <select
                value={String(step.expectation.value)}
                onChange={(event) =>
                  onChange({
                    ...step,
                    expectation: {
                      kind: step.expectation.kind as "visible" | "checked",
                      value: event.currentTarget.value === "true",
                    },
                  })
                }
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          )}
        </>
      )}
      {step.code === "viewport" && (
        <div className={styles.fields}>
          {number("Width in pixels", step.width, 320, 3840, (width) =>
            onChange({ ...step, width }),
          )}
          {number("Height in pixels", step.height, 320, 2160, (height) =>
            onChange({ ...step, height }),
          )}
        </div>
      )}
      {step.code === "assertLayout" && (
        <label className={styles.field}>
          Layout scope
          <select
            value={step.target ? "element" : "page"}
            onChange={(event) => {
              const { target: _target, ...rest } = step;
              onChange(
                event.currentTarget.value === "page"
                  ? rest
                  : {
                      ...rest,
                      target: { by: "label", value: "Element label" },
                    },
              );
            }}
          >
            <option value="page">Whole page</option>
            <option value="element">One element</option>
          </select>
        </label>
      )}
      {step.code === "assertHttp" && (
        <fieldset className={styles.form}>
          <legend>Accepted HTTP status codes</legend>
          {step.statuses.map((status, index) => (
            <div className={styles.actions} key={index}>
              {number(`Status ${index + 1}`, status, 100, 599, (value) =>
                onChange({
                  ...step,
                  statuses: step.statuses.map((current, i) =>
                    i === index ? value : current,
                  ),
                }),
              )}
              <button
                type="button"
                disabled={step.statuses.length === 1}
                onClick={() =>
                  onChange({
                    ...step,
                    statuses: step.statuses.filter((_, i) => i !== index),
                  })
                }
              >
                Remove status {index + 1}
              </button>
            </div>
          ))}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={step.statuses.length >= 20}
              onClick={() =>
                onChange({ ...step, statuses: [...step.statuses, 200] })
              }
            >
              Add status
            </button>
          </div>
        </fieldset>
      )}
      {step.code === "accessibility" && (
        <fieldset className={styles.sources}>
          <legend>Accessibility standards</legend>
          {(
            ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const
          ).map((tag) => (
            <label className={styles.row} key={tag}>
              <input
                type="checkbox"
                checked={step.tags.includes(tag)}
                onChange={(event) =>
                  onChange({
                    ...step,
                    tags: event.currentTarget.checked
                      ? [...step.tags, tag]
                      : step.tags.filter((current) => current !== tag),
                  })
                }
              />
              {tag.toUpperCase()}
            </label>
          ))}
        </fieldset>
      )}
      {step.code === "assertRequirement" && (
        <>
          {text("Requirement ID", step.requirementId, (requirementId) =>
            onChange({ ...step, requirementId }),
          )}
          {text("Requirement", step.requirement, (requirement) =>
            onChange({ ...step, requirement }),
          )}
          {text("Requirement source", step.source ?? "", (source) =>
            onChange({ ...step, source: source || undefined }),
          )}
        </>
      )}
      {number(
        "Time limit in milliseconds",
        step.timeoutMs,
        1,
        120000,
        (timeoutMs) => onChange({ ...step, timeoutMs }),
      )}
    </div>
  );
}

export function WorkflowSteps({
  steps,
  onChange,
}: {
  steps: readonly WorkflowStep[];
  onChange?: (steps: WorkflowStep[]) => void;
}) {
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange?.(next);
  };
  return (
    <div className={styles.form}>
      <ol className={styles.workflowSteps} aria-label="Workflow steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <p>{describeStep(step)}</p>
            </div>
            {onChange && (
              <details className={styles.stepEdit}>
                <summary>Edit step {index + 1}</summary>
                <StepFields
                  step={step}
                  onChange={(updated) =>
                    onChange(
                      steps.map((current, i) =>
                        i === index ? updated : current,
                      ),
                    )
                  }
                />
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    disabled={steps.length === 1}
                    onClick={() =>
                      onChange(steps.filter((_, i) => i !== index))
                    }
                  >
                    Remove step
                  </button>
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
      {onChange && (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={steps.length >= 1000}
            onClick={() =>
              onChange([
                ...steps,
                newStep("click", `step-${crypto.randomUUID()}`),
              ])
            }
          >
            Add step
          </button>
        </div>
      )}
    </div>
  );
}
