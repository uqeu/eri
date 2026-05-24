// Wire-shape types mirroring the Rust `eri_review` crate's serde output. Keep
// these in sync with crates/eri_review/src/findings.rs and crates/eri_review/src/diff.rs.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "security"
  | "logic"
  | "performance"
  | "style"
  | "test"
  | "docs"
  | "other";

export interface ReviewFinding {
  severity: Severity;
  category: FindingCategory;
  file: string;
  line_range: [number, number];
  title: string;
  description: string;
  suggested_fix?: string;
  confidence: number;
}

export interface ReviewReport {
  findings: ReviewFinding[];
  total_files: number;
  elapsed_ms: number;
  model: string;
}

export type ReviewKind = "unstaged" | "staged" | "range";
export type Forge = "github" | "gitlab" | "forgejo";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function severityIcon(sev: Severity): string {
  switch (sev) {
    case "critical":
      return "$(error)";
    case "high":
      return "$(warning)";
    case "medium":
      return "$(issue-opened)";
    case "low":
      return "$(info)";
    case "info":
      return "$(comment)";
  }
}
