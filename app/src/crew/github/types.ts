// 平台與 GitHub 之間共用的型別（#108 第 1 階段的公開 repo 部分）。
// 轉換函式的輸入是 GitHub 回應的 JSON 形狀，內容由呼叫端提供（#108 的 `## 決定` 1）；這裡只放形狀，不呼叫 API，連線與權杖只在私人 repo。
// 狀態讀回、人工待辦的解析等其他 Issue 也在這裡加自己的型別；兩邊都新增時，後合併的一方更新到 main。

/** 要寫進 GitHub 的 Issue：標題、本文與建立時一起加上的標籤（不含派工標籤）。 */
export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/** 貼出前檢查的問題種類（畫面依種類從翻譯檔取訊息）。 */
export type PostFindingKind =
  /** 不是放行清單中的 email */
  | "email"
  /** /Users/<名稱>、/home/<名稱> */
  | "personalPath"
  /** 禁用名稱清單中的名稱 */
  | "deniedName"
  /** 呼叫的一方沒有傳入禁用名稱清單（或清單是空的）：一律拒絕 */
  | "deniedNamesMissing"
  /** 留言以 agent 視為人的決定或修正要求的控制標題開頭 */
  | "controlHeading";

/** 一個問題：只有位置與種類，不含命中的文字。 */
export interface PostFinding {
  /** 問題所在的欄位 */
  field: "title" | "body";
  /** 行號（從 1 起算）；與整份內容有關的問題（例如沒有清單）是 0 */
  line: number;
  kind: PostFindingKind;
}

export interface PostCheckResult {
  ok: boolean;
  findings: PostFinding[];
}

/**
 * PR 變更的一個檔案：GitHub REST API `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` 回應的一筆，
 * 只取轉換用得到的欄位。
 */
export interface GitHubPrFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions?: number;
  deletions?: number;
  /** `renamed` 時的原路徑 */
  previous_filename?: string;
}

// 以下是狀態讀回（#110）用的 GitHub REST API 回應形狀：只列用到的欄位，欄位名稱照 GitHub 的寫法（snake_case），讀回的 JSON 可以原樣傳入。

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
