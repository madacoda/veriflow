import type { ReportRenderer, ReportSnapshot } from "@veriflow/core";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PageSizes, rgb, type PDFPage } from "pdf-lib";
import { notoSansRegular } from "./fonts/noto-sans.ts";

const colors = {
  ink: rgb(0.09, 0.16, 0.23),
  muted: rgb(0.34, 0.4, 0.46),
  accent: rgb(0.02, 0.37, 0.4),
  rule: rgb(0.82, 0.87, 0.88),
  failed: rgb(0.68, 0.15, 0.2),
};

/** Pure rendering: uses the saved snapshot and bundled font, without reading artifacts. */
export async function renderPdf(
  snapshot: ReportSnapshot,
): Promise<Awaited<ReturnType<ReportRenderer["render"]>>> {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.registerFontkit(fontkit);
  const font = await document.embedFont(
    Buffer.from(notoSansRegular, "base64"),
    { subset: true },
  );
  const supported = new Set(font.getCharacterSet());
  const unsupported = new Set<string>();
  const { project, workflow, run } = snapshot;
  document.setTitle(`${project.title} - Run report`);
  document.setAuthor("Veriflow");
  document.setCreator("Veriflow report renderer");
  document.setProducer("Veriflow");
  const createdAt = new Date(snapshot.createdAt);
  if (!Number.isNaN(createdAt.valueOf())) {
    document.setCreationDate(createdAt);
    document.setModificationDate(createdAt);
  }

  const [width, height] = PageSizes.A4;
  const margin = 46;
  const contentWidth = width - margin * 2;
  const bottom = 57;
  let page: PDFPage;
  let y = 0;

  function printable(value: string) {
    return Array.from(value.replace(/\r\n?/g, "\n").replaceAll("\t", "    "))
      .map((character) => {
        const code = character.codePointAt(0)!;
        if (character === "\n" || (code >= 32 && supported.has(code)))
          return character;
        const replacement = `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
        unsupported.add(replacement);
        return replacement;
      })
      .join("");
  }

  function lines(value: string, size: number, available: number) {
    const output: string[] = [];
    for (const paragraph of printable(value).split("\n")) {
      let line = "";
      for (const word of paragraph.match(/[^ ]+| +/g) ?? []) {
        const candidate = line + word;
        if (font.widthOfTextAtSize(candidate, size) <= available) {
          line = candidate;
          continue;
        }
        if (line && word.trim()) {
          output.push(line);
          line = "";
        }
        // IDs, URLs and unbroken observations must fit without clipping.
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > available) {
            output.push(line);
            line = "";
          }
          line += character;
        }
      }
      output.push(line);
    }
    return output;
  }

  function addPage() {
    page = document.addPage(PageSizes.A4);
    page.drawText("VERIFLOW", {
      x: margin,
      y: height - 36,
      size: 10,
      font,
      color: colors.accent,
    });
    page.drawText("RUN REPORT", {
      x: width - margin - font.widthOfTextAtSize("RUN REPORT", 8),
      y: height - 36,
      size: 8,
      font,
      color: colors.muted,
    });
    page.drawLine({
      start: { x: margin, y: height - 47 },
      end: { x: width - margin, y: height - 47 },
      color: colors.rule,
      thickness: 0.75,
    });
    y = height - 72;
  }

  function ensure(space: number) {
    if (y - space < bottom) addPage();
  }

  function paragraph(value: string, size = 10, color = colors.ink, inset = 0) {
    for (const line of lines(value, size, contentWidth - inset)) {
      ensure(size * 1.45);
      if (line)
        page.drawText(line, { x: margin + inset, y, size, font, color });
      y -= size * 1.45;
    }
  }

  function section(title: string) {
    // Keep the heading with the first detail block (which reserves 56 points).
    ensure(96);
    y -= 12;
    paragraph(title, 15, colors.accent);
    y -= 5;
  }

  function row(label: string, value: string | number | undefined) {
    if (value === undefined) return;
    const size = 9.5;
    const indent = 112;
    const wrapped = lines(String(value), size, contentWidth - indent);
    wrapped.forEach((line, index) => {
      ensure(14);
      if (index === 0)
        page.drawText(label, {
          x: margin,
          y,
          size,
          font,
          color: colors.muted,
        });
      if (line)
        page.drawText(line, {
          x: margin + indent,
          y,
          size,
          font,
          color: colors.ink,
        });
      y -= 14;
    });
    y -= 3;
  }

  function observedValue(value: string | undefined) {
    if (value === undefined) return undefined;
    // Make exact-assertion differences visible even in PDF readers that collapse
    // repeated spaces when copying text. JSON escaping also distinguishes empty
    // values, literal backslashes, tabs and newlines.
    return JSON.stringify(value)
      .replace(
        /[^\S ]/gu,
        (space) => `\\u${space.codePointAt(0)!.toString(16).padStart(4, "0")}`,
      )
      .replace(/ {2,}|(?<=^") | (?="$)/g, (spaces) =>
        "\\u0020".repeat(spaces.length),
      );
  }

  addPage();
  paragraph(project.title, 23);
  y -= 5;
  paragraph(
    `${run.outcome ? run.outcome.toUpperCase() : "NO OUTCOME"}  /  ${run.lifecycle.toUpperCase()}`,
    14,
    run.outcome === "failed" ? colors.failed : colors.accent,
  );
  y -= 8;
  if (run.adapter === "fake") {
    paragraph("FIXTURE RUN - simulated results, not browser verification.", 10);
    y -= 5;
  } else if (run.adapter === "unavailable") {
    paragraph(
      "Execution adapter unavailable. No browser verification is claimed.",
      10,
    );
    y -= 5;
  }
  paragraph(
    "This report preserves the saved run and its pinned workflow revision.",
    9,
    colors.muted,
  );

  section("Run overview");
  row("Project ID", project.id);
  row("Workflow", workflow.workflow.name);
  row("Workflow ID", workflow.workflow.id);
  row("Revision", workflow.revision);
  row("Run ID", run.id);
  row("Adapter", run.adapter);
  row("Lifecycle", run.lifecycle);
  row("Outcome", run.outcome ?? "Not determined");
  row("Created", run.createdAt);
  row("Started", run.startedAt ?? "Not recorded");
  row("Finished", run.finishedAt ?? "Not recorded");
  row("Snapshot", snapshot.createdAt);
  row(
    "Initial viewport",
    run.viewport
      ? `${run.viewport.width} x ${run.viewport.height}`
      : "1280 x 720 (default)",
  );
  row("Evidence capture", run.evidence.capture);
  if (run.error) {
    row("Run error", run.error.code);
    row("Error details", run.error.message);
  }

  section("Step results");
  const counts = ["passed", "failed", "blocked"].map(
    (status) =>
      `${run.steps.filter((step) => step.status === status).length} ${status}`,
  );
  paragraph(
    `${run.steps.length} observed steps: ${counts.join(" / ")}`,
    9,
    colors.muted,
  );
  if (
    run.steps.some(
      (step) => step.expected !== undefined || step.actual !== undefined,
    )
  )
    paragraph(
      "Values are quoted with escapes; repeated or edge spaces use \\u0020.",
      8,
      colors.muted,
    );
  y -= 8;
  if (!run.steps.length) paragraph("No step results were recorded.");
  run.steps.forEach((step, index) => {
    ensure(56);
    paragraph(
      `${index + 1}. ${step.stepId} / ${step.status.toUpperCase()}`,
      11,
      step.status === "failed" ? colors.failed : colors.ink,
    );
    row(
      "Action",
      workflow.workflow.steps.find((saved) => saved.id === step.stepId)?.code,
    );
    row("Failure kind", step.failureKind);
    row("Expected", observedValue(step.expected));
    row("Actual", observedValue(step.actual));
    row("Reason", "reason" in step ? step.reason : undefined);
    if (step.requirement) {
      row("Requirement ID", step.requirement.id);
      row("Requirement", step.requirement.text);
      row("Source", step.requirement.source);
    }
    row("Started", step.startedAt);
    row("Finished", step.finishedAt);
    const evidenceIds = run.evidence.artifacts
      .filter((artifact) => artifact.stepId === step.stepId)
      .map((artifact) => artifact.id);
    if (evidenceIds.length) row("Evidence IDs", evidenceIds.join(", "));
    y -= 9;
  });

  section("Findings");
  if (!snapshot.findings.length) paragraph("No findings were recorded.");
  for (const finding of snapshot.findings) {
    ensure(56);
    paragraph(`${finding.severity.toUpperCase()} / ${finding.category}`, 11);
    row("Finding ID", finding.id);
    row("Rule", finding.ruleId);
    row("Step", finding.stepId);
    row("Observation", finding.message);
    row("Evidence IDs", finding.evidenceIds.join(", ") || "None");
    y -= 9;
  }

  section("Evidence register");
  paragraph(
    "Registered references only. Open the run in Veriflow to view captured media.",
    9,
    colors.muted,
  );
  y -= 8;
  row("Capture status", run.evidence.capture);
  if (!run.evidence.artifacts.length)
    paragraph("No evidence artifacts were registered.");
  for (const artifact of run.evidence.artifacts) {
    ensure(56);
    row("Evidence ID", artifact.id);
    row("Step", artifact.stepId ?? "Run-level evidence");
    row("Type", `${artifact.kind} / ${artifact.mediaType}`);
    y -= 6;
  }
  for (const warning of run.evidence.warnings) row("Capture warning", warning);

  section("Run timeline");
  if (!run.events.length) paragraph("No events were recorded.");
  for (const event of [...run.events].sort((a, b) => a.sequence - b.sequence)) {
    ensure(42);
    paragraph(`${event.sequence}. ${event.type} / ${event.timestamp}`, 9);
    row("Step", event.step?.stepId);
    row("Message", event.message);
    y -= 3;
  }

  if (snapshot.aiSummary) {
    section("AI summary");
    paragraph(
      `Provider: ${snapshot.aiSummary.provider}. Interpretation only; observed outcomes above remain authoritative.`,
      9,
      colors.muted,
    );
    y -= 8;
    paragraph(snapshot.aiSummary.text);
  }
  if (unsupported.size) {
    section("Text rendering note");
    paragraph(
      "Characters outside the embedded font are shown as [U+XXXX] Unicode code points so their identity is preserved.",
      9,
      colors.muted,
    );
  }

  const pages = document.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({
      start: { x: margin, y: 43 },
      end: { x: width - margin, y: 43 },
      color: colors.rule,
      thickness: 0.75,
    });
    sheet.drawText("Veriflow / saved run report", {
      x: margin,
      y: 28,
      size: 8,
      font,
      color: colors.muted,
    });
    const counter = `Page ${index + 1} of ${pages.length}`;
    sheet.drawText(counter, {
      x: width - margin - font.widthOfTextAtSize(counter, 8),
      y: 28,
      size: 8,
      font,
      color: colors.muted,
    });
  });
  return {
    bytes: await document.save(),
    mediaType: "application/pdf",
    filename: `veriflow-${run.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
  };
}
