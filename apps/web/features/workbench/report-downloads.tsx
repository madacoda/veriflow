"use client";

import type { ReportFormat } from "@veriflow/core";
import { useEffect, useRef, useState } from "react";
import { api, RequestError } from "./api";
import styles from "./workbench.module.css";

const formats: ReportFormat[] = ["csv", "xlsx", "pdf"];

export function ReportDownloads({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [pending, setPending] = useState<ReportFormat | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function download(format: ReportFormat) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(format);
    setError("");
    setNotice("");
    const label = format.toUpperCase();
    try {
      const report = await api.downloadReport(
        projectId,
        runId,
        format,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(report);
      const link = document.createElement("a");
      link.href = url;
      link.download = `veriflow-${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(`${label} download started.`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(
        error instanceof RequestError && error.code === "adapter_unavailable"
          ? `${label} export is currently unavailable. ${error.message}`
          : error instanceof Error
            ? error.message
            : "Could not download the report.",
      );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  return (
    <section
      className={styles.reportDownloads}
      aria-labelledby="run-report-heading"
    >
      <h3 id="run-report-heading">Run report</h3>
      <p>Export this saved run&apos;s results and evidence references.</p>
      <div className={styles.actions}>
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            disabled={pending !== null}
            onClick={() => download(format)}
          >
            Download {format.toUpperCase()}
          </button>
        ))}
      </div>
      {(pending || notice) && (
        <p role="status">
          {pending ? `Preparing ${pending.toUpperCase()} report.` : notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
