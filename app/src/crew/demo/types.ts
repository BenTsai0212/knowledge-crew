// crew demo 的虛構資料 client/crew/demo.json 的結構（#29 計畫第 2 節）。
// 資料表的文字欄位是單一語言，這裡的雙語文字由 seed 寫入預設語言、畫面以 texts.ts 換成目前語言（#29 的 `## 決定` 1）。
import type { Id, LocalizedText } from "../../client/types";
import type { CheckStatus, LevelDecisionKind, ReturnReason } from "../trust/types";

export interface DemoRepo {
  id: Id;
  /** 一律是 example-org/<名稱>（虛構） */
  fullName: string;
  /** access.json 的專案：誰看得到由專案決定 */
  project: Id;
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
  prNumber: number;
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
  repo: Id;
  issueNumber: number;
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
  repos: DemoRepo[];
  employees: DemoEmployee[];
  workTypes: Id[];
  assignments: DemoAssignment[];
  levelDecisions: DemoLevelDecision[];
  simulations: DemoSimulation[];
}

/** 工作的 id 由 seed 產生：`<交辦 id>-w<round>`。 */
export const demoWorkId = (assignmentId: Id, round: number): Id => `${assignmentId}-w${round}`;
