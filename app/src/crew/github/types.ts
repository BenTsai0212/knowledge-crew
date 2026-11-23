// GitHub REST API 回應的形狀（只列 crew 用到的欄位；#108 的 D1：公開 repo 不連線，以假的回應測試）。
// 欄位名稱照 GitHub 的寫法（snake_case），讀回的 JSON 可以原樣傳入。

export interface GhLabel {
  name: string;
}

export interface GhUser {
  login: string;
}

/** `OWNER`、`MEMBER`、`COLLABORATOR` 是可信身分（agent-workflow.md 第 0 步） */
export type GhAuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "MANNEQUIN"
  | "NONE";

/** `GET /repos/{owner}/{repo}/issues/{n}` */
export interface GhIssue {
  number: number;
  state: "open" | "closed";
  state_reason: "completed" | "not_planned" | "reopened" | null;
  labels: GhLabel[];
  created_at: string;
  closed_at: string | null;
}

/** `GET /repos/{owner}/{repo}/issues/{n}/timeline` 的一筆（PR 也用同一個路徑）；只用 labeled、unlabeled、closed、reopened */
export interface GhTimelineEvent {
  id?: number;
  event: string;
  created_at: string;
  label?: GhLabel;
  state_reason?: "completed" | "not_planned" | "reopened" | null;
}

/** `GET /repos/{owner}/{repo}/issues/{n}/comments` 的一筆 */
export interface GhComment {
  id: number;
  body: string;
  created_at: string;
  user: GhUser;
  author_association: GhAuthorAssociation;
}

/** `GET /repos/{owner}/{repo}/pulls` 的一筆 */
export interface GhPull {
  number: number;
  state: "open" | "closed";
  body: string | null;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  labels: GhLabel[];
  head: { sha: string };
}

/** `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` 的 `check_runs[]` 的一筆 */
export interface GhCheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "stale"
    | null;
}
