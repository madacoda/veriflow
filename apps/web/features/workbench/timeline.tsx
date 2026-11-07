"use client";

import type { RunRecord } from "@veriflow/core";
import { useState } from "react";
import { Card, CardContent, CardHeader } from "../ui/primitives";
import { api } from "./api";
import { runFixtures } from "./fixtures";
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

export function RunTimeline({
  run,
  fixture = false,
}: {
  run: RunRecord;
  fixture?: boolean;
}) {
  const showLinks = !fixture && run.adapter === "browser";
  const events = [...run.events].sort(
    (left, right) => left.sequence - right.sequence,
  );

  return (
    <div className={styles.result}>
      <div className={styles.observation} role="status">
        <p className={styles.runState}>
          <span className={styles.badge} data-state={run.lifecycle}>
            {run.lifecycle}
          </span>
          {run.lifecycle === "completed" && run.outcome && (
            <span className={styles.badge} data-state={run.outcome}>
              {run.outcome}
            </span>
          )}
          {fixture
            ? "Fixture preview"
            : run.adapter === "fake"
              ? "Fake adapter run"
              : "Browser run"}
        </p>
        <p>
          Revision {run.revision} · {run.id}
        </p>
        {isActive(run) && run.cancelRequestedAt && (
          <p>Waiting for cancellation cleanup.</p>
        )}
        {run.error && <p>{run.error.message}</p>}
      </div>

      <h3>Timeline</h3>
      <ol className={styles.timeline}>
        {events.map((event) => (
          <li key={event.sequence}>
            <span>
              {event.sequence}. {eventLabels[event.type]}
              {event.step && ` · ${event.step.stepId}`}
            </span>
            <time dateTime={event.timestamp}>{event.timestamp}</time>
          </li>
        ))}
      </ol>

      {run.steps.length > 0 && (
        <>
          <h3>Step results</h3>
          <ol className={styles.stepResults}>
            {run.steps.map((step) => (
              <li key={step.stepId}>
                <div className={styles.row}>
                  <strong>{step.stepId}</strong>
                  <span
                    className={styles.badge}
                    data-state={
                      step.failureKind === "infrastructure"
                        ? "error"
                        : step.status
                    }
                  >
                    {step.failureKind === "infrastructure"
                      ? "execution error"
                      : step.status}
                  </span>
                </div>
                {"reason" in step && <p>{step.reason}</p>}
                {(step.expected !== undefined || step.actual !== undefined) && (
                  <dl className={styles.values}>
                    <dt>Expected</dt>
                    <dd>
                      {step.expected === undefined
                        ? "Unavailable"
                        : JSON.stringify(step.expected)}
                    </dd>
                    <dt>Actual</dt>
                    <dd>
                      {step.actual === undefined
                        ? "Unavailable"
                        : JSON.stringify(step.actual)}
                    </dd>
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      <h3>Evidence</h3>
      <p>
        Capture {run.evidence.capture}
        {fixture && " (fixture metadata)"}
      </p>
      {run.evidence.warnings.length > 0 && (
        <ul className={styles.compactList}>
          {run.evidence.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      {run.evidence.artifacts.length > 0 && (
        <ul className={styles.compactList}>
          {run.evidence.artifacts.map((artifact) => (
            <li key={artifact.id}>
              {showLinks ? (
                <a
                  href={api.evidence(run.projectId, run.id, artifact.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {artifact.kind}
                  {artifact.stepId ? ` for ${artifact.stepId}` : ""}
                </a>
              ) : (
                <span>
                  Sample {artifact.kind} reference
                  {artifact.stepId ? ` for ${artifact.stepId}` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
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
            <select
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
            </select>
          </label>
          <RunTimeline run={runFixtures[selection]} fixture />
        </CardContent>
      </Card>
    </section>
  );
}
