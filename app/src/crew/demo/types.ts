// crew demo 的虛構資料 client/crew/demo.json 的結構（#29 計畫第 2 節）。
// 資料表的文字欄位是單一語言，這裡的雙語文字由 seed 寫入預設語言、畫面以 texts.ts 換成目前語言（#29 的 `## 決定` 1）。
import type { Id, LocalizedText } from "../../client/types";
import type { GuidelineResult, PointResult, Priority, SourceKind } from "../db/store";
import type { GuidelineDecisionKind, ProposerKind } from "../guidelines/status";
import type { CheckStatus, LevelDecisionKind, ReturnReason } from "../trust/types";

/** 工作來源（RFC 0001 的 2026-11-21 修訂）。 */
export interface DemoSource {
  id: Id;
  kind: SourceKind;
  /** 畫面顯示的名稱；repo 類一律是 example-org/<名稱>（虛構） */
  name: string;
  /** 依語言顯示的名稱（#60 的 `## 決定` 2）：資料庫只存 `name`，畫面以 demoText("sourceName") 換成目前語言；省略時顯示 `name` */
  label?: LocalizedText;
  /** access.json 的專案：誰看得到由專案決定 */
  project: Id;
  /** 知識庫類來源：驗收通過的知識庫條目回流成這個機密等級（access.json 的等級）的文件；省略時不回流（#92） */
  knowledgeVisibility?: Id;
  /** 確認的守則寫成這個機密等級（access.json 的等級）的知識庫文件；任何類型的來源都可以填，省略時不寫（#149） */
  guidelineVisibility?: Id;
}

export interface DemoEmployee {
  id: Id;
  displayName: string;
  roleNote: LocalizedText;
}

export interface DemoChange {
  path: string;
  summary: LocalizedText;
}

export interface DemoCheck {
  name: string;
  status: CheckStatus;
  checkedAt: string;
}

/**
 * 驗收時的逐條回饋（crew ADR 0008 第 12～13 點，#161）：重點是該次交件 `points` 的序號（從 1 開始），守則是該次交件 `guidelines`
 * 裡的 id；同一對象最多一筆。
 */
export interface DemoFeedback {
  points?: { ordinal: number; result: PointResult }[];
  guidelines?: { guideline: Id; result: GuidelineResult }[];
}

/** 事後更正（crew ADR 0008 第 1～6、15 點，#161）：只能在通過的驗收，時間不早於該次驗收。`note` 的畫面文字同 DemoReview。 */
export interface DemoCorrection {
  id: Id;
  correctedBy: Id;
  correctedAt: string;
  note?: LocalizedText;
  /** 這個錯沒有被標成重點 */
  notInPoints?: boolean;
}

/**
 * 驗收：`returned` 一定有原因，`accepted` 沒有。`id` 寫在檔案裡，供 levelDecisions.basisReview、guidelines.sourceReview 參照。
 * `note` 是退回的意見（#142）：資料庫只存預設語言，畫面以 demoText("reviewNote") 換成目前語言。
 * `notInPoints`（退回的「沒被標成重點」）只能在原因是 `wrong` 時為 true；`correction` 只能在通過（#161）。
 */
export type DemoReview = { id: Id; decidedBy: Id; decidedAt: string; note?: LocalizedText; feedback?: DemoFeedback } & (
  | { verdict: "accepted"; reason?: undefined; correction?: DemoCorrection }
  | { verdict: "returned"; reason: ReturnReason; notInPoints?: boolean }
);

export interface DemoWork {
  round: number;
  /** 外部編號：repo 類是 PR 編號（正整數的十進位文字，必填）；其他類型可以省略 */
  externalRef?: string;
  submittedAt: string;
  summary: LocalizedText;
  body: LocalizedText;
  points: LocalizedText[];
  changes: DemoChange[];
  checks: DemoCheck[];
  /** 只有最後一輪可以省略：省略時該交辦等待驗收 */
  review?: DemoReview;
  /** 這次交件依照的守則（員工自述，#142）：同一員工 × 工作類型、交件時生效的 guidelines[].id */
  guidelines?: Id[];
}

export interface DemoAssignment {
  id: Id;
  source: Id;
  /** 外部編號：repo 類是 Issue 編號（正整數的十進位文字，必填）；其他類型可以省略 */
  externalRef?: string;
  workType: Id;
  employee: Id;
  title: LocalizedText;
  assignedBy: Id;
  assignedAt: string;
  /** 到期日（YYYY-MM-DD，#133）；省略時沒有到期日。日期不必合理，只用來展示逾期與即將到期 */
  dueAt?: string;
  /** 省略時是 normal（#133） */
  priority?: Priority;
  works: DemoWork[];
}

export interface DemoLevelDecision {
  id: Id;
  employee: Id;
  workType: Id;
  decision: LevelDecisionKind;
  basisReview?: Id;
  decidedBy: Id;
  decidedAt: string;
}

/** 人對守則的決定（#142）；`revisedText` 只能出現在確認。決定的 id 由 seed 產生：`<守則 id>-d<序號>`。 */
export interface DemoGuidelineDecision {
  decision: GuidelineDecisionKind;
  decidedBy: Id;
  decidedAt: string;
  revisedText?: LocalizedText;
}

/**
 * 守則（crew ADR 0007、#142）：來源一定是同一員工 × 工作類型的一次退回。
 * 人提的守則：提出者是來源退回的驗收者，提出時間與文字等於那次退回，第一筆決定是同時間的確認。
 */
export interface DemoGuideline {
  id: Id;
  employee: Id;
  workType: Id;
  sourceReview: Id;
  proposer: ProposerKind;
  proposedAt: string;
  text: LocalizedText;
  /** 依時間順序 */
  decisions: DemoGuidelineDecision[];
}

/** 「模擬交件」的預先回覆：檢查沒有時間，依檔案順序寫入。 */
export interface DemoReply {
  summary: LocalizedText;
  body: LocalizedText;
  points: LocalizedText[];
  changes: DemoChange[];
  checks: { name: string; status: CheckStatus }[];
}

export interface DemoSimulation {
  employee: Id;
  workType: Id;
  replies: DemoReply[];
}

export interface DemoFile {
  /** demo 的「今天」（YYYY-MM-DD，#133）：到期狀態以這一天計算，不隨真實日期改變；省略時用目前的日期 */
  today?: string;
  sources: DemoSource[];
  employees: DemoEmployee[];
  workTypes: Id[];
  assignments: DemoAssignment[];
  levelDecisions: DemoLevelDecision[];
  /** 依提出時間順序（#142） */
  guidelines: DemoGuideline[];
  simulations: DemoSimulation[];
}

/** 工作的 id 由 seed 產生：`<交辦 id>-w<round>`。 */
export const demoWorkId = (assignmentId: Id, round: number): Id => `${assignmentId}-w${round}`;

/** 守則的決定的 id 由 seed 產生：`<守則 id>-d<序號>`（序號從 1 開始）。 */
export const demoGuidelineDecisionId = (guidelineId: Id, ordinal: number): Id => `${guidelineId}-d${ordinal}`;
