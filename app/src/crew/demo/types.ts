// crew demo 的虛構資料 client/crew/demo.json 的結構（#29 計畫第 2 節）。
// 資料表的文字欄位是單一語言，這裡的雙語文字由 seed 寫入預設語言、畫面以 texts.ts 換成目前語言（#29 的 `## 決定` 1）。
import type { Id, LocalizedText } from "../../client/types";
import type { SourceKind } from "../db/store";
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

/** 驗收：`returned` 一定有原因，`accepted` 沒有。`id` 寫在檔案裡，供 levelDecisions.basisReview 參照。 */
export type DemoReview = { id: Id; decidedBy: Id; decidedAt: string; note?: string } & (
  | { verdict: "accepted"; reason?: undefined }
  | { verdict: "returned"; reason: ReturnReason }
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
  sources: DemoSource[];
  employees: DemoEmployee[];
  workTypes: Id[];
  assignments: DemoAssignment[];
  levelDecisions: DemoLevelDecision[];
  simulations: DemoSimulation[];
}

/** 工作的 id 由 seed 產生：`<交辦 id>-w<round>`。 */
export const demoWorkId = (assignmentId: Id, round: number): Id => `${assignmentId}-w${round}`;
