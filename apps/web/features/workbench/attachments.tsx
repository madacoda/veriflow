"use client";

import { Button } from "../ui/button";

import {
  attachmentMediaTypes,
  MAX_ATTACHMENT_BYTES,
  textContextMediaTypes,
  type AttachmentMetadata,
} from "@veriflow/core";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Card, CardContent, CardHeader, Input } from "../ui/primitives";
import { api } from "./api";
import styles from "./workbench.module.css";

const mediaByExtension: Record<string, AttachmentMetadata["mediaType"]> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
const filePickerTypes = Object.keys(mediaByExtension)
  .map((extension) => `.${extension}`)
  .join(",");

function uploadFile(file: File) {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase() ?? "";
  const useExtension =
    !file.type ||
    file.type === "application/octet-stream" ||
    (extension === "csv" && file.type === "application/vnd.ms-excel");
  const mediaType =
    useExtension && Object.hasOwn(mediaByExtension, extension)
      ? mediaByExtension[extension]
      : file.type;

  if (file.size === 0) throw new Error("Choose a nonempty file.");
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error("Attachments must be at most 10 MiB.");
  if (!attachmentMediaTypes.some((type) => type === mediaType)) {
    throw new Error(
      "Attachment format is not supported. Choose TXT, MD, CSV, JSON, PDF, DOCX, PNG, or JPEG.",
    );
  }
  return mediaType === file.type
    ? file
    : new File([file], file.name, { type: mediaType });
}

export const extractionLabels = {
  pending: "Extraction pending",
  ready: "Extraction ready",
  failed: "Extraction failed",
};

export function canReadForGeneration(attachment: AttachmentMetadata) {
  return (
    attachment.extraction.status !== "failed" &&
    textContextMediaTypes.some((type) => type === attachment.mediaType)
  );
}

export function generationSourceHelp(attachment: AttachmentMetadata) {
  if (!textContextMediaTypes.some((type) => type === attachment.mediaType))
    return "Stored for reference only. AI cannot read this format yet; provide TXT, MD, CSV, or JSON text instead.";
  if (attachment.extraction.status === "failed")
    return "This source could not be read. Correct it and upload it again before generation.";
  return "Text is read when selected for generation, up to 100,000 characters. Uploading alone does not include it in a draft.";
}

export function ProjectAttachments({
  projectId,
  attachments,
  setAttachments,
}: {
  projectId: string;
  attachments: readonly AttachmentMetadata[];
  setAttachments: Dispatch<SetStateAction<AttachmentMetadata[]>>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const upload = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .attachments(projectId, controller.signal)
      .then(({ attachments }) => {
        if (!controller.signal.aborted) setAttachments(attachments);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load attachments.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refresh, setAttachments]);

  useEffect(() => () => upload.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || upload.current || loading) return;

    const form = event.currentTarget;
    const controller = new AbortController();
    upload.current = controller;
    setError("");
    setNotice("");
    setUploading(true);
    try {
      const { attachment } = await api.uploadAttachment(
        projectId,
        uploadFile(file),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAttachments((current) => [attachment, ...current]);
      setNotice(`${attachment.filename} uploaded.`);
      setFile(null);
      form.reset();
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Could not upload attachment.",
        );
    } finally {
      upload.current = null;
      if (!controller.signal.aborted) setUploading(false);
    }
  }

  return (
    <section aria-labelledby="attachments-heading">
      <Card>
        <CardHeader>
          <h2 id="attachments-heading">Project attachments</h2>
          <p>
            Add requirements documents or screenshots to the selected project.
          </p>
        </CardHeader>
        <CardContent>
          <div className={styles.form}>
            <form className={styles.form} onSubmit={submit}>
              <fieldset className={styles.form} disabled={loading || uploading}>
                <label className={styles.field}>
                  Attachment file
                  <Input
                    type="file"
                    accept={filePickerTypes}
                    aria-describedby="attachment-formats"
                    onChange={(event) => {
                      setFile(event.currentTarget.files?.[0] ?? null);
                      setError("");
                      setNotice("");
                    }}
                  />
                </label>
                <p id="attachment-formats">
                  TXT, MD, CSV, JSON, PDF, DOCX, PNG, or JPEG. Up to 10 MiB per
                  file. AI generation currently reads TXT, MD, CSV, and JSON
                  only. PDF, DOCX, and screenshots are stored for reference.
                </p>
                <div className={styles.actions}>
                  <Button type="submit" disabled={!file}>
                    Upload attachment
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setError("");
                      setNotice("");
                      setRefresh((current) => current + 1);
                    }}
                  >
                    Refresh attachments
                  </Button>
                </div>
              </fieldset>
            </form>
            {(loading || uploading || notice) && (
              <p role="status">
                {loading
                  ? "Loading attachments."
                  : uploading
                    ? "Uploading attachment."
                    : notice}
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!loading && !error && attachments.length === 0 && (
              <p>No attachments yet.</p>
            )}
            {attachments.length > 0 && (
              <ul className={styles.compactList}>
                {attachments.map((attachment) => (
                  <li key={attachment.id} className={styles.attachment}>
                    <strong>{attachment.filename}</strong>
                    <p>
                      {attachment.sizeBytes.toLocaleString("en")} bytes ·{" "}
                      {extractionLabels[attachment.extraction.status]}
                    </p>
                    <p>{generationSourceHelp(attachment)}</p>
                    {attachment.extraction.status === "failed" && (
                      <p>{attachment.extraction.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
