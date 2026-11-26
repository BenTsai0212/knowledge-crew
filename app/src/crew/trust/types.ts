// 信任規則用的型別（#19）。欄位名稱與 #15 計畫第 1 節的資料表一致（snake_case 改成 camelCase）。
// 規則只回傳資料與代碼，介面文字由畫面依 client/i18n/crew/ 決定。

/** 驗收結果：`crew.reviews.verdict`。 */
export type Verdict = "accepted" | "returned";

/** 退回原因三選一：`crew.reviews.reason`，只在 `returned` 時有值。 */
export type ReturnReason = "wrong" | "different_approach" | "process";

/** 一次驗收（`crew.reviews` 的一列）。`decidedAt` 是 ISO 8601 時間。 */
export type Review =
  | { id: string; verdict: "accepted"; reason: null; decidedAt: string }
  | { id: string; verdict: "returned"; reason: ReturnReason; decidedAt: string };

/** 事後更正（`crew.review_corrections` 的一列，crew ADR 0008）：在 `correctedAt` 算一次 `wrong`；原本那次驗收仍是通過。 */
export interface Correction {
  id: string;
  /** 被更正的那次驗收（一定是通過） */
  reviewId: string;
  correctedAt: string;
  /** 這個錯沒有被標成重點 */
  notInPoints: boolean;
}

/** 人對「看重點」的決定：`crew.level_decisions.decision`。 */
export type LevelDecisionKind = "relax" | "revoke";

/** 看重點的同意（`relax`）或收回（`revoke`）（`crew.level_decisions` 的一列）。 */
export interface LevelDecision {
  decision: LevelDecisionKind;
  decidedAt: string;
}

/** 驗收的層級：逐項看或看重點。 */
export type ReviewLevel = "item" | "light";

/** 信任頁的圓點：通過、做錯了、其他退回（不影響信任）。 */
export type Dot = "ok" | "wrong" | "neutral";

/** 建議與規則的參數（示範值見 demo-params.ts）。 */
export interface TrustParams {
  /** 信任頁顯示的圓點數 */
  dots: number;
  /** 建議改看重點時，最近幾次都不能有 `wrong` */
  window: number;
  /** 建議改看重點時，至少要有幾次驗收 */
  min: number;
}

/** 建議改看重點：只是資料，不改變層級；要人同意後寫入 `relax` 才生效。 */
export interface RelaxSuggestion {
  /** 依據的那幾次驗收（依時間排序） */
  basis: Review[];
}

/** 因做錯了改回逐項看的事件：在 `light` 期間發生 `wrong` 的那一次。 */
export interface AutoReset {
  review: Review;
  at: string;
}

/** 自動檢查的狀態：`crew.work_checks.status`。 */
export type CheckStatus = "pass" | "fail" | "pending";

/** 自動檢查（開發流程中＝CI）。 */
export interface WorkCheck {
  name: string;
  status: CheckStatus;
}

/** 變更清單的一項（`crew.work_changes`）。 */
export interface WorkChange {
  path: string;
  summary: string;
}

/** 驗收面板的輸入：一份工作（＝PR）。 */
export interface WorkForReview {
  /** 員工標出的「要看的重點」 */
  points: string[];
  checks: WorkCheck[];
  changes: WorkChange[];
  /** 全文（PR 本文） */
  body: string;
}

/** 變更清單的呈現：逐項列出，或收成一筆摘要（件數）。 */
export type ChangesView = { mode: "items"; items: WorkChange[] } | { mode: "summary"; count: number };

/** 驗收面板要顯示的內容，依顯示順序：重點與自動檢查在最上面，接著是變更清單，全文預設收起。 */
export interface ReviewFocus {
  /** 員工的層級（不因重點為空而改變） */
  level: ReviewLevel;
  points: string[];
  /** 為 true 時畫面顯示「員工沒有標出要看的重點」 */
  noPoints: boolean;
  checks: WorkCheck[];
  changes: ChangesView;
  body: { text: string; collapsed: true };
}
