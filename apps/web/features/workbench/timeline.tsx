"use client";

import { NativeSelect } from "../ui/native-select";
import { Badge } from "../ui/badge";

import type { Evidence, RunRecord, Workflow } from "@veriflow/core";
import Image from "next/image";
import { useState } from "react";
import { Card, CardContent, CardHeader } from "../ui/primitives";
import { api } from "./api";
import { runFixtures } from "./fixtures";
import { describeStep } from "./workflow-steps";
import styles from "./workbench.module.css";

const eventLabels = {
  queued: "Run queued",
  started: "Execution started",
  step: "Step recorded",
  completed: "Run completed",
  cancellation_requested: "Cancellation requested",
  cancelled: "Run cancelled",
  error: "Execution error",
};

export function isActive(run: RunRecord) {
  return run.lifecycle === "queued" || run.lifecycle === "running";
}

function RunMedia({
  artifact,
  run,
  fixture,
}: {
  artifact: Evidence;
  run: RunRecord;
  fixture: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const label = `${artifact.kind}${artifact.stepId ? ` for ${artifact.stepId}` : " for this run"}`;
  if (fixture || run.adapter !== "browser")
    return (
      <p>
        Sample {artifact.kind} reference
        {artifact.stepId ? ` for ${artifact.stepId}` : ""}
      </p>
    );
  const href = api.evidence(run.projectId, run.id, artifact.id);
  if (artifact.kind !== "screenshot")
    return (
      <a href={href} target="_blank" rel="noreferrer">
        Open {label}
      </a>
    );
  return (
    <figure className={styles.runScreenshot}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${label}`}
      >
        {failed ? (
          <p>Screenshot could not load. Open it to retry.</p>
        ) : (
          <Image
            unoptimized
            src={href}
            alt={`Screenshot${artifact.stepId ? ` for ${artifact.stepId}` : " for this run"}`}
            width={run.viewport?.width ?? 1280}
            height={run.viewport?.height ?? 720}
            onError={() => setFailed(true)}
          />
        )}
        <figcaption>
          Open {label}
          <span aria-hidden="true"> ↗</span>
        </figcaption>
      </a>
    </figure>
  );
}

export function RunTimeline({
  run,
  fixture = false,
  workflow,
}: {
  run: RunRecord;
  fixture?: boolean;
  workflow?: Workflow;
}) {
  const events = [...run.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const rows = events.map((event) => ({
    key: `event-${event.sequence}`,
    event,
    step:
      event.type === "step"
        ? (run.steps.find((step) => step.stepId === event.step?.stepId) ??
          event.step)
        : undefined,
  }));
  // Older records and previews can have results without a corresponding step event.
  const missing = run.steps.filter(
    (step) => !rows.some((row) => row.step?.stepId === step.stepId),
  );
  const terminal = rows.findIndex((row) =>
    ["completed", "cancelled", "error"].includes(row.event.type),
  );
  const timeline = [
    ...rows.slice(0, terminal < 0 ? rows.length : terminal),
    ...missing.map((step) => ({
      key: `step-${step.stepId}`,
      event: undefined,
      step,
    })),
    ...rows.slice(terminal < 0 ? rows.length : terminal),
  ];
  const runMedia = run.evidence.artifacts.filter(
    (artifact) =>
      !artifact.stepId ||
      !run.steps.some((step) => step.stepId === artifact.stepId),
  );
  return (
    <div className={styles.result}>
      <div className={styles.observation} role="status">
        <p className={styles.runState}>
          <Badge
            variant="secondary"
            className={styles.badge}
            data-state={run.lifecycle}
          >
            {run.lifecycle}
          </Badge>
          {run.lifecycle === "completed" && run.outcome && (
            <Badge
              variant="secondary"
              className={styles.badge}
              data-state={run.outcome}
            >
              {run.outcome}
            </Badge>
          )}
          {fixture
            ? "Fixture preview"
            : run.adapter === "fake"
              ? "Fake adapter run"
              : "Browser run"}
        </p>
        <p>
          Revision {run.revision} ·{" "}
          {run.steps.filter((step) => step.status === "passed").length} steps
          passed
          {run.viewport && ` · ${run.viewport.width} × ${run.viewport.height}`}
        </p>
        <p className={styles.runIdentity}>{run.id}</p>
        {isActive(run) && run.cancelRequestedAt && (
          <p>Waiting for cancellation cleanup.</p>
        )}
        {run.error && <p>{run.error.message}</p>}
      </div>
      <ol className={styles.runTimeline} aria-label="Run timeline">
        {timeline.map(({ key, event, step }) => {
          const definition = workflow?.steps.find(
            (item) => item.id === step?.stepId,
          );
          const media = step
            ? run.evidence.artifacts.filter(
                (artifact) => artifact.stepId === step.stepId,
              )
            : [];
          const state = step
            ? step.failureKind === "infrastructure"
              ? "error"
              : step.status
            : event?.type;
          return (
            <li key={key} data-step-id={step?.stepId} data-state={state}>
              <span className={styles.timelineDot} aria-hidden="true" />
              <div className={styles.timelineEntry}>
                <div className={styles.row}>
                  {step ? (
                    <h3>
                      {definition ? describeStep(definition) : step.stepId}
                    </h3>
                  ) : (
                    <strong>
                      {event!.sequence}. {eventLabels[event!.type]}
                    </strong>
                  )}
                  {step && (
                    <Badge
                      variant="secondary"
                      className={styles.badge}
                      data-state={state}
                    >
                      {state === "error" ? "execution error" : state}
                    </Badge>
                  )}
                </div>
                {event && (
                  <time dateTime={event.timestamp}>
                    {new Date(event.timestamp).toISOString().slice(11, 19)} UTC
                  </time>
                )}
                {step && (
                  <>
                    {"reason" in step && <p>{step.reason}</p>}
                    {step.requirement && (
                      <p>
                        <strong>{step.requirement.id}</strong> ·{" "}
                        {step.requirement.text}
                        {step.requirement.source &&
                          ` · Source: ${step.requirement.source}`}
                      </p>
                    )}
                    {!!step.findings?.length && (
                      <ul>
                        {step.findings.map((finding) => (
                          <li key={finding.id}>
                            {finding.ruleId} · {finding.severity} ·{" "}
                            {finding.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {(step.expected !== undefined ||
                      step.actual !== undefined) && (
                      <dl className={styles.values}>
                        <dt>Expected</dt>
                        <dd>
                          {step.expected === undefined
                            ? "Unavailable"
                            : String(step.expected)}
                        </dd>
                        <dt>Actual</dt>
                        <dd>
                          {step.actual === undefined
                            ? "Unavailable"
                            : String(step.actual)}
                        </dd>
                      </dl>
                    )}
                    {media.map((artifact) => (
                      <RunMedia
                        key={artifact.id}
                        artifact={artifact}
                        run={run}
                        fixture={fixture}
                      />
                    ))}
                    {!media.length && !isActive(run) && (
                      <p className={styles.captureNote}>
                        No screenshot was captured for this step.
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {runMedia.map((artifact) => (
        <RunMedia
          key={artifact.id}
          artifact={artifact}
          run={run}
          fixture={fixture}
        />
      ))}
      <p className={styles.captureNote}>
        Capture {run.evidence.capture}
        {fixture && " (fixture metadata)"}
      </p>
      {!!run.evidence.warnings.length && (
        <ul className={styles.compactList}>
          {run.evidence.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      {!fixture && run.adapter === "browser" && !isActive(run) && (
        <p>
          <a
            href={`/api/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.id)}/report?format=csv`}
          >
            Download CSV report
          </a>
        </p>
      )}
    </div>
  );
}

export function FixturePreview() {
  const [selection, setSelection] =
    useState<keyof typeof runFixtures>("Failed");

  return (
    <section aria-labelledby="preview-heading">
      <Card>
        <CardHeader>
          <h2 id="preview-heading">Run previews</h2>
          <p>Explore labeled fixtures without creating a run.</p>
        </CardHeader>
        <CardContent>
          <label className={styles.field}>
            Fixture state
            <NativeSelect
              value={selection}
              onChange={(event) =>
                setSelection(
                  event.currentTarget.value as keyof typeof runFixtures,
                )
              }
            >
              {Object.keys(runFixtures).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </NativeSelect>
          </label>
          <RunTimeline run={runFixtures[selection]} fixture />
        </CardContent>
      </Card>
    </section>
  );
}
