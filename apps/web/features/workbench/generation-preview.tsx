"use client";

import {
  CONTRACT_VERSION,
  generationRequestSchema,
  type AttachmentMetadata,
  type WorkflowDraft,
} from "@veriflow/core";
import { demoTemplate } from "@veriflow/core/fixtures";
import { type FormEvent, useState } from "react";
import { extractionLabels } from "./attachments";
import { createCouponFixtureWorkflow } from "./coupon-fixture";
import styles from "./workbench.module.css";

export function GenerationPreview({
  projectUrl,
  attachments,
  hasDraft,
  pending,
  onOpen,
}: {
  projectUrl: string;
  attachments: readonly AttachmentMetadata[];
  hasDraft: boolean;
  pending: boolean;
  onOpen: (draft: WorkflowDraft) => void;
}) {
  const [preview, setPreview] = useState<{
    draft: WorkflowDraft;
    objective: string;
    sources: AttachmentMetadata[];
  } | null>(null);
  const [error, setError] = useState("");

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request = generationRequestSchema.safeParse({
      objective: form.get("objective"),
      templateIds: form.getAll("template"),
      attachmentIds: form.getAll("attachment"),
    });
    if (!request.success) {
      setError(request.error.issues.map((issue) => issue.message).join(". "));
      return;
    }

    const sources = attachments.filter((item) =>
      request.data.attachmentIds.includes(item.id),
    );
    setError("");
    setPreview({
      objective: request.data.objective,
      sources,
      draft: {
        contractVersion: CONTRACT_VERSION,
        provider: "fixture",
        workflow: createCouponFixtureWorkflow(projectUrl),
        sourceAttachmentIds: sources.map((item) => item.id),
        warnings: [
          "This fixture uses seeded workflow steps and attachment metadata.",
        ],
      },
    });
  }

  return (
    <details className={styles.generation}>
      <summary>Preview draft generation</summary>
      <section
        className={styles.form}
        aria-labelledby="generation-preview-heading"
      >
        <h3 id="generation-preview-heading">Generation fixture</h3>
        <p>
          Choose inputs and review a sample draft before opening it in the
          editor.
        </p>
        <form className={styles.form} onSubmit={prepare}>
          <label className={styles.field}>
            Objective
            <textarea name="objective" rows={3} required maxLength={10000} />
          </label>
          <label className={styles.field}>
            Template
            <select name="template" required defaultValue="">
              <option value="">Choose a template</option>
              <option value={demoTemplate.id}>
                {demoTemplate.title} · v{demoTemplate.version}
              </option>
            </select>
          </label>
          <fieldset className={styles.sources}>
            <legend>Source attachments</legend>
            {attachments.length === 0 ? (
              <p>Upload attachments to include source references.</p>
            ) : (
              attachments.map((item) => (
                <label className={styles.row} key={item.id}>
                  <input type="checkbox" name="attachment" value={item.id} />
                  {item.filename} · {extractionLabels[item.extraction.status]}
                </label>
              ))
            )}
          </fieldset>
          <div className={styles.actions}>
            <button type="submit">Prepare fixture draft</button>
          </div>
        </form>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {preview && (
          <div className={`${styles.form} ${styles.observation}`}>
            <h3>{preview.draft.workflow.name}</h3>
            <p>
              Provider: {preview.draft.provider} · {demoTemplate.title}
            </p>
            <p>{preview.objective}</p>
            <p>Source references</p>
            {preview.sources.length === 0 ? (
              <p>No attachment references selected.</p>
            ) : (
              <ul className={styles.compactList}>
                {preview.sources.map((item) => (
                  <li key={item.id}>
                    {item.filename} · {extractionLabels[item.extraction.status]}
                  </li>
                ))}
              </ul>
            )}
            <ul className={styles.compactList} aria-label="Draft warnings">
              {preview.draft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <details>
              <summary>Review workflow steps</summary>
              <pre className={styles.code}>
                {JSON.stringify(preview.draft.workflow.steps, null, 2)}
              </pre>
            </details>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onOpen(preview.draft)}
              >
                {hasDraft
                  ? "Replace editor with fixture draft"
                  : "Open fixture draft in editor"}
              </button>
            </div>
          </div>
        )}
      </section>
    </details>
  );
}
