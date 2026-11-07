"use client";

import {
  workflowSchema,
  type ProjectRecord,
  type RunRecord,
  type Workflow,
  type WorkflowDraft,
  type WorkflowRevision,
} from "@veriflow/core";
import { demoProject, demoWorkflow } from "@veriflow/core/fixtures";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, Input } from "../ui/primitives";
import { api, RequestError } from "./api";
import { ProjectAttachments } from "./attachments";
import { FixturePreview, isActive, RunTimeline } from "./timeline";
import styles from "./workbench.module.css";

const couponDraft: WorkflowDraft = {
  contractVersion: "1",
  workflow: demoWorkflow,
  sourceAttachmentIds: [],
  warnings: [],
  provider: "fixture",
};

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function upsertRun(runs: RunRecord[], updated: RunRecord) {
  const current = runs.find((run) => run.id === updated.id);
  if (!current) return [updated, ...runs];
  if (current.events.length > updated.events.length) return runs;
  return runs.map((run) => (run.id === updated.id ? updated : run));
}

function WorkflowEditor({
  projectId,
  selected,
  onSaved,
}: {
  projectId: string;
  selected: { workflowId: string; revision: number } | null;
  onSaved: (workflow: WorkflowRevision) => void;
}) {
  const [draft, setDraft] = useState<{
    id: string;
    name: string;
    steps: string;
    base: number | null;
    source: string;
    category?: Workflow["category"];
  } | null>(null);
  const [templates, setTemplates] = useState<
    Awaited<ReturnType<typeof api.templates>>["templates"]
  >([]);
  const [templateId, setTemplateId] = useState("");
  const [parameters, setParameters] = useState("{}");
  useEffect(() => {
    const controller = new AbortController();
    api
      .templates(projectId, controller.signal)
      .then((response) => setTemplates(response.templates))
      .catch(() => {});
    return () => controller.abort();
  }, [projectId]);
  async function loadTemplate() {
    setPending(true);
    setError("");
    try {
      const response = await api.draftTemplate(
        projectId,
        templateId,
        JSON.parse(parameters),
      );
      openDraft(response.workflow, null, "Template draft");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<WorkflowRevision | null>(null);

  function openDraft(workflow: Workflow, base: number | null, source: string) {
    setDraft({
      id: workflow.id,
      name: workflow.name,
      steps: JSON.stringify(workflow.steps, null, 2),
      base,
      source,
      category: workflow.category,
    });
    setError("");
    setNotice("");
    setConflict(false);
    setLatest(null);
  }

  async function reviewSelected() {
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      const { workflow } = await api.workflow(
        projectId,
        selected.workflowId,
        selected.revision,
      );
      openDraft(workflow.workflow, workflow.revision, "Saved workflow");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || conflict) return;
    setError("");
    setNotice("");
    let steps: unknown;
    try {
      steps = JSON.parse(draft.steps);
    } catch {
      setError("Enter a valid JSON array of workflow steps.");
      return;
    }
    const parsed = workflowSchema.safeParse({
      schemaVersion: "1",
      id: draft.id,
      name: draft.name,
      category: draft.category,
      steps,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
          .join(". "),
      );
      return;
    }

    setPending(true);
    try {
      const { workflow } = await api.saveWorkflow(
        projectId,
        parsed.data,
        draft.base,
      );
      openDraft(workflow.workflow, workflow.revision, "Saved workflow");
      setNotice(`Saved revision ${workflow.revision}.`);
      onSaved(workflow);
    } catch (error) {
      if (error instanceof RequestError && error.code === "revision_conflict") {
        setConflict(true);
        setError(`${error.message}. Your edits are still here.`);
      } else {
        setError(message(error));
      }
    } finally {
      setPending(false);
    }
  }

  async function reviewLatest() {
    if (!draft) return;
    setPending(true);
    try {
      const { workflow } = await api.workflow(projectId, draft.id);
      setLatest(workflow);
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="editor-heading">
      <Card>
        <CardHeader>
          <h2 id="editor-heading">Workflow draft</h2>
          <p>Review the draft and save it explicitly before starting a run.</p>
        </CardHeader>
        <CardContent>
          <form className={styles.form} onSubmit={save}>
            <fieldset className={styles.form} disabled={pending}>
              <label className={styles.field}>
                Testing template
                <select
                  value={templateId}
                  onChange={(event) => {
                    const id = event.currentTarget.value;
                    setTemplateId(id);
                    setParameters(
                      JSON.stringify(
                        templates.find((t) => t.id === id)?.defaults ?? {},
                        null,
                        2,
                      ),
                    );
                  }}
                >
                  <option value="">Choose a testing category</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              {templateId && (
                <>
                  <p>
                    {templates
                      .find((t) => t.id === templateId)
                      ?.prerequisites.join(" ")}
                  </p>
                  <label className={styles.field}>
                    Template parameters (JSON)
                    <textarea
                      rows={8}
                      value={parameters}
                      onChange={(event) =>
                        setParameters(event.currentTarget.value)
                      }
                    />
                  </label>
                  <div className={styles.actions}>
                    <button type="button" onClick={loadTemplate}>
                      Create template draft
                    </button>
                  </div>
                </>
              )}

              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() =>
                    openDraft(couponDraft.workflow, null, "Coupon fixture")
                  }
                >
                  Load coupon fixture
                </button>
                {selected && (
                  <button type="button" onClick={reviewSelected}>
                    Review selected revision
                  </button>
                )}
              </div>
              {draft && (
                <>
                  <p>
                    {draft.source} ·{" "}
                    {draft.base === null
                      ? "Unsaved draft"
                      : `Based on revision ${draft.base}`}
                  </p>
                  <label className={styles.field}>
                    Workflow name
                    <Input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Workflow steps (JSON)
                    <textarea
                      rows={13}
                      spellCheck={false}
                      value={draft.steps}
                      onChange={(event) =>
                        setDraft({ ...draft, steps: event.currentTarget.value })
                      }
                    />
                  </label>
                  <div className={styles.actions}>
                    <button type="submit" disabled={conflict}>
                      Save workflow
                    </button>
                    {conflict && (
                      <button type="button" onClick={reviewLatest}>
                        Review latest saved version
                      </button>
                    )}
                  </div>
                  {latest && (
                    <div className={styles.observation}>
                      <p>
                        Latest saved revision {latest.revision} ·{" "}
                        {latest.workflow.name}
                      </p>
                      <details>
                        <summary>Compare saved steps</summary>
                        <pre className={styles.code}>
                          {JSON.stringify(latest.workflow.steps, null, 2)}
                        </pre>
                      </details>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ ...draft, base: latest.revision });
                            setConflict(false);
                            setLatest(null);
                            setError("");
                            setNotice(
                              `Using revision ${latest.revision} as the save base. Review your edits before saving.`,
                            );
                          }}
                        >
                          Use latest as save base
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </fieldset>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function ProjectWorkbench({ project }: { project: ProjectRecord }) {
  const [workflows, setWorkflows] = useState<WorkflowRevision[]>([]);
  const [selection, setSelection] = useState({ id: "", revision: "" });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [viewport, setViewport] = useState("default");
  const viewportPresets: Record<string, { width: number; height: number }> = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  };

  const selectedWorkflow = workflows.find(
    (item) => item.workflow.id === selection.id,
  );
  const revision = Number(selection.revision);
  const selected =
    selectedWorkflow &&
    Number.isSafeInteger(revision) &&
    revision >= 1 &&
    revision <= selectedWorkflow.revision
      ? { workflowId: selectedWorkflow.workflow.id, revision }
      : null;
  const run = runs.find((item) => item.id === runId);
  const polling = run !== undefined && isActive(run);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.workflows(project.id, controller.signal),
      api.runs(project.id, controller.signal),
    ])
      .then(([workflowsResponse, runsResponse]) => {
        if (controller.signal.aborted) return;
        setWorkflows((current) => {
          const latest = new Map(
            current.map((item) => [item.workflow.id, item]),
          );
          for (const workflow of workflowsResponse.workflows) {
            if (
              (latest.get(workflow.workflow.id)?.revision ?? 0) <
              workflow.revision
            ) {
              latest.set(workflow.workflow.id, workflow);
            }
          }
          return [...latest.values()];
        });
        setRuns((current) => runsResponse.runs.reduce(upsertRun, current));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project.id, loadVersion]);

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { run } = await api.run(project.id, runId, controller.signal);
        if (controller.signal.aborted) return;
        setRuns((runs) => upsertRun(runs, run));
        setPollError("");
        if (!isActive(run)) return;
      } catch (error) {
        if (controller.signal.aborted) return;
        setPollError(`Could not refresh run status. ${message(error)}`);
      }
      timeout = setTimeout(poll, 750);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [polling, project.id, runId]);

  function recordSave(workflow: WorkflowRevision) {
    setWorkflows((current) => [
      workflow,
      ...current.filter((item) => item.workflow.id !== workflow.workflow.id),
    ]);
    setSelection({
      id: workflow.workflow.id,
      revision: String(workflow.revision),
    });
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      const { run } = await api.startRun(
        project.id,
        selected.workflowId,
        selected.revision,
        viewportPresets[viewport],
      );
      setRuns((current) => upsertRun(current, run));
      setRunId(run.id);
      setPollError("");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  async function rerun() {
    if (!run) return;
    setPending(true);
    setError("");
    try {
      const response = await api.startRun(
        project.id,
        run.workflowId,
        run.revision,
        run.viewport,
      );
      setRuns((current) => upsertRun(current, response.run));
      setRunId(response.run.id);
      setPollError("");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (!run) return;
    setPending(true);
    setError("");
    try {
      const { run: updated } = await api.cancel(project.id, run.id);
      setRuns((current) => upsertRun(current, updated));
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <WorkflowEditor
        projectId={project.id}
        selected={selected}
        onSaved={recordSave}
      />
      <section aria-labelledby="runs-heading">
        <Card>
          <CardHeader>
            <h2 id="runs-heading">Saved revisions and runs</h2>
            <p>
              Choose a saved revision. Draft edits take effect after saving.
            </p>
          </CardHeader>
          <CardContent>
            <form className={styles.form} onSubmit={start}>
              <fieldset className={styles.form} disabled={pending || loading}>
                <label className={styles.field}>
                  Run viewport
                  <select
                    value={viewport}
                    onChange={(event) => setViewport(event.currentTarget.value)}
                  >
                    <option value="default">Default (1280 × 720)</option>
                    <option value="desktop">Desktop (1440 × 900)</option>
                    <option value="tablet">Tablet (768 × 1024)</option>
                    <option value="mobile">Mobile (390 × 844)</option>
                  </select>
                </label>
                <div className={styles.fields}>
                  <label className={styles.field}>
                    Saved workflow
                    <select
                      value={selection.id}
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        const workflow = workflows.find(
                          (item) => item.workflow.id === id,
                        );
                        setSelection({
                          id,
                          revision: workflow ? String(workflow.revision) : "",
                        });
                      }}
                    >
                      <option value="">Choose a workflow</option>
                      {workflows.map((item) => (
                        <option key={item.workflow.id} value={item.workflow.id}>
                          {item.workflow.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Revision to run
                    <Input
                      type="number"
                      min={1}
                      max={selectedWorkflow?.revision}
                      value={selection.revision}
                      disabled={!selectedWorkflow}
                      onChange={(event) =>
                        setSelection({
                          ...selection,
                          revision: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className={styles.actions}>
                  <button type="submit" disabled={!selected}>
                    Start run
                  </button>
                  {run && !isActive(run) && (
                    <button type="button" onClick={rerun}>
                      Rerun revision {run.revision}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setError("");
                      setLoadVersion((current) => current + 1);
                    }}
                  >
                    Refresh saved revisions and runs
                  </button>
                </div>
                <label className={styles.field}>
                  Run history
                  <select
                    value={runId}
                    onChange={(event) => {
                      setRunId(event.currentTarget.value);
                      setPollError("");
                    }}
                  >
                    <option value="">Choose a run</option>
                    {runs.map((item) => (
                      <option key={item.id} value={item.id}>
                        Revision {item.revision} ·{" "}
                        {item.outcome ?? item.lifecycle} · {item.adapter} ·{" "}
                        {item.id}
                      </option>
                    ))}
                  </select>
                </label>
                {run && isActive(run) && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      onClick={cancel}
                      disabled={!!run.cancelRequestedAt}
                    >
                      Cancel run
                    </button>
                  </div>
                )}
              </fieldset>
            </form>
            {loading && <p role="status">Loading saved revisions and runs.</p>}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {pollError && (
              <p className={styles.error} role="alert">
                {pollError}
              </p>
            )}
            {run && <RunTimeline run={run} />}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

export function Workbench() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState(demoProject.url);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const project = projects.find((item) => item.id === projectId);

  useEffect(() => {
    const controller = new AbortController();
    api
      .projects(controller.signal)
      .then(({ projects }) => {
        if (!controller.signal.aborted) setProjects(projects);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadVersion]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const { project } = await api.createProject(title, url);
      setProjects((current) => [project, ...current]);
      setProjectId(project.id);
      setTitle("");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.surface}>
      <header className={styles.banner}>
        <div className={styles.bannerContent}>
          <div>
            <h1>Veriflow</h1>
            <p>
              Review a workflow, run a saved revision, and inspect the evidence.
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/demo?bug=1" className={styles.demoLink}>
              Open known-fail target
            </Link>
            <Link href="/demo?bug=0" className={styles.demoLink}>
              Open known-pass target
            </Link>
          </div>
        </div>
      </header>
      <div className={styles.workbench}>
        <section
          className={styles.fullWidth}
          aria-labelledby="projects-heading"
        >
          <Card>
            <CardHeader>
              <h2 id="projects-heading">Projects</h2>
            </CardHeader>
            <CardContent>
              <form className={styles.form} onSubmit={createProject}>
                <fieldset className={styles.form} disabled={pending || loading}>
                  <div className={styles.fields}>
                    <label className={styles.field}>
                      Project name
                      <Input
                        required
                        value={title}
                        onChange={(event) =>
                          setTitle(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Project target URL
                      <Input
                        type="url"
                        required
                        value={url}
                        onChange={(event) => setUrl(event.currentTarget.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      Selected project
                      <select
                        value={projectId}
                        onChange={(event) =>
                          setProjectId(event.currentTarget.value)
                        }
                      >
                        <option value="">Choose a project</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button type="submit">Create project</button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoading(true);
                        setError("");
                        setLoadVersion((current) => current + 1);
                      }}
                    >
                      Refresh projects
                    </button>
                  </div>
                </fieldset>
              </form>
              {loading && <p role="status">Loading projects.</p>}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
        {project && (
          <>
            <ProjectWorkbench key={project.id} project={project} />
            <ProjectAttachments
              key={`attachments-${project.id}`}
              projectId={project.id}
            />
          </>
        )}
        <FixturePreview />
      </div>
    </main>
  );
}
