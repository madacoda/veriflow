export type QaCategory =
  | "functionality"
  | "functional"
  | "responsive"
  | "security"
  | "compliance"
  | "accessibility"
  | "regression";
export interface Evidence {
  id: string;
  runId: string;
  stepId?: string;
  kind: "screenshot" | "video" | "trace";
  artifactPath: string;
  mediaType: string;
}
export interface Finding {
  id: string;
  category: QaCategory;
  ruleId: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  message: string;
  stepId?: string;
  evidenceIds: readonly string[];
}
export interface Evaluation {
  status: "passed" | "failed" | "blocked";
  findings: readonly Finding[];
  reason?: string;
}
