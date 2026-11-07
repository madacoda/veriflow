"use client";

import {
  generationRequestSchema,
  type AttachmentMetadata,
  type TemplateDefinition,
  type WorkflowDraft,
} from "@veriflow/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, RequestError } from "./api";
import { extractionLabels } from "./attachments";
import styles from "./workbench.module.css";
import { WorkflowSteps } from "./workflow-steps";

type Preview = {
  draft: WorkflowDraft;
  objective: string;
  template?: TemplateDefinition;
  sources: readonly { id: string; label: string }[];
};

export function GenerationPreview({
  projectId,
  attachments,
  hasDraft,
  pending,
  onOpen,
}: {
  projectId: string;
  attachments: readonly AttachmentMetadata[];
  hasDraft: boolean;
  pending: boolean;
  onOpen: (draft: WorkflowDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<{
    templates: TemplateDefinition[];
    error?: string;
  } | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef<AbortController | null>(null);
  const templates = catalog?.templates ?? [];

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api
      .generationTemplates(controller.signal)
      .then((templates) => {
        if (!controller.signal.aborted) setCatalog({ templates });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const detail = error instanceof Error ? error.message : "";
          setCatalog({
            templates: [],
            error: `Could not load templates. ${detail}`.trim(),
          });
        }
      });
    return () => controller.abort();
  }, [open, catalogAttempt]);

  useEffect(() => () => generation.current?.abort(), []);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generation.current || !catalog || catalog.error) return;
    const form = new FormData(event.currentTarget);
    const request = generationRequestSchema.safeParse({
      objective: form.get("objective"),
      templateIds: form.getAll("template").filter(Boolean),
      attachmentIds: form.getAll("attachment"),
    });
    if (!request.success) {
      setError(request.error.issues.map((issue) => issue.message).join(". "));
      return;
    }

    const template = templates.find((item) =>
      request.data.templateIds.includes(item.id),
    );
    const controller = new AbortController();
    setError("");
    generation.current = controller;
    setGenerating(true);
    try {
      const draft = await api.generateDraft(
        projectId,
        request.data,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPreview({
        draft,
        objective: request.data.objective,
        template,
        sources: draft.sourceAttachmentIds.map((id) => {
          const attachment = attachments.find((item) => item.id === id);
          return {
            id,
            label: attachment
              ? `${attachment.filename} · ${extractionLabels[attachment.extraction.status]}`
              : id,
          };
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof RequestError &&
        error.code === "adapter_unavailable"
      ) {
        setError(`Generation is currently unavailable. ${error.message}`);
      } else {
        setError(
          error instanceof Error
            ? error.message
            : "Could not generate a workflow draft.",
        );
      }
    } finally {
      generation.current = null;
      if (!controller.signal.aborted) setGenerating(false);
    }
  }

  const draftLabel =
    preview?.draft.provider === "fixture" ? "fixture draft" : "generated draft";

  return (
    <details
      className={styles.generation}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Preview draft generation</summary>
      <section
        className={styles.form}
        aria-labelledby="generation-preview-heading"
      >
        <h3 id="generation-preview-heading">Workflow generation</h3>
        <p>Generate a draft from the project objective and selected sources.</p>
        {!catalog && <p role="status">Loading templates.</p>}
        {catalog?.error && (
          <div className={styles.actions}>
            <p className={styles.error} role="alert">
              {catalog.error}
            </p>
            <button
              type="button"
              onClick={() => {
                setCatalog(null);
                setCatalogAttempt((attempt) => attempt + 1);
              }}
            >
              Retry templates
            </button>
          </div>
        )}
        <form className={styles.form} onSubmit={prepare}>
          <fieldset className={styles.form} disabled={generating}>
            <label className={styles.field}>
              Objective
              <textarea name="objective" rows={3} required maxLength={10000} />
            </label>
            <label className={styles.field}>
              Template
              <select name="template" defaultValue="">
                <option value="">No template</option>
                {templates.map((template) => (
                  <option
                    key={`${template.id}@${template.version}`}
                    value={template.id}
                  >
                    {template.title} · v{template.version}
                  </option>
                ))}
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
              <button type="submit" disabled={!catalog || !!catalog.error}>
                Generate draft
              </button>
            </div>
          </fieldset>
        </form>
        {generating && <p role="status">Generating workflow draft.</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {preview && (
          <div className={`${styles.form} ${styles.observation}`}>
            <h3>{preview.draft.workflow.name}</h3>
            <p>
              Provider: {preview.draft.provider}
              {preview.template &&
                ` · ${preview.template.title} · v${preview.template.version}`}
            </p>
            <p>{preview.objective}</p>
            <p>Source references</p>
            {preview.sources.length === 0 ? (
              <p>No attachment references returned.</p>
            ) : (
              <ul className={styles.compactList}>
                {preview.sources.map((source) => (
                  <li key={source.id}>{source.label}</li>
                ))}
              </ul>
            )}
            {preview.draft.warnings.length > 0 && (
              <ul className={styles.compactList} aria-label="Draft warnings">
                {preview.draft.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
            <details>
              <summary>Review workflow steps</summary>
              <WorkflowSteps steps={preview.draft.workflow.steps} />
            </details>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={pending || generating}
                onClick={() => onOpen(preview.draft)}
              >
                {hasDraft
                  ? `Replace editor with ${draftLabel}`
                  : `Open ${draftLabel} in editor`}
              </button>
            </div>
          </div>
        )}
      </section>
    </details>
  );
}
