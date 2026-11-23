// 交辦 → GitHub Issue 的轉換（#111；#108 `## 計畫` 第 4 點的對照表）。純函式：不讀檔、不讀環境變數、不連線。
// - 本文沿用 .github/ISSUE_TEMPLATE/feature.md 的標題（從範本讀取，不在程式中重寫一份）。
// - 驗收條件是未勾選的核取方塊；末行是平台的交辦編號、員工與交辦人，讀回時以 assignmentIdOf() 對到平台的交辦。
// - 工作類型 → `type:*` 標籤、標題前綴、「先提計畫」的預設與是否高風險，放在呼叫的一方傳入的設定（IssueConfig）。
// - 輸出的標籤不含 `agent:ready`：派工標籤由 dispatchSteps() 描述的最後一次、單獨的寫入加上。
import featureTemplate from "../../../../.github/ISSUE_TEMPLATE/feature.md?raw";
import type { IssueDraft } from "./types";

/** 派工標籤：只能在建立 Issue、讀回比對之後單獨加上（github-writes.md「派工時單獨加 agent:ready」）。 */
export const DISPATCH_LABEL = "agent:ready";
export const PLAN_FIRST_LABEL = "plan-first";
const TYPE_PREFIX = "type:";
const AREA_PREFIX = "area:";

/** 一種工作類型在 GitHub 上的寫法（平台設定）。 */
export interface WorkTypeIssueConfig {
  /** `type:*` 標籤，例如 `type:feat` */
  label: string;
  /** 標題前綴，例如 `feat: ` */
  titlePrefix: string;
  /** 表單上「先提計畫」預設是否勾選 */
  planFirst: boolean;
  /** 高風險（ADR 0003：schema、migration、RLS、權限等）：一律先提計畫，而且不能取消 */
  highRisk: boolean;
}

/** 平台設定：工作類型 id → 寫法；可選的範圍（`area:<範圍>`）。 */
export interface IssueConfig {
  workTypes: Readonly<Record<string, WorkTypeIssueConfig>>;
  areas: readonly string[];
}

/** 交辦表單的資料。 */
export interface AssignmentForm {
  /** 平台的交辦編號 */
  assignmentId: string;
  /** 一句話交辦（標題） */
  summary: string;
  /** 目標或背景（選填；沒有時目標寫一句話交辦） */
  goal?: string;
  /** 驗收條件，至少一條；每條一行 */
  acceptance: readonly string[];
  workTypeId: string;
  /** 工作來源：目標 repo（第 1 階段只有本 repo，#108 D2），不影響 Issue 的內容 */
  sourceId: string;
  /** 員工的顯示名稱 */
  employee: string;
  /** 交辦人的顯示名稱 */
  assignedBy: string;
  /** 使用者的選擇；省略時用工作類型的預設。高風險類型一律是 true */
  planFirst?: boolean;
  /** 範圍（選填）：設定中的範圍之一 */
  area?: string;
}

/** 轉換失敗的原因（畫面依原因從翻譯檔取訊息）。 */
export type IssueFormError =
  | "unknownWorkType"
  | "invalidConfig"
  | "emptySummary"
  | "multilineSummary"
  | "noAcceptance"
  | "multilineAcceptance"
  | "invalidAssignmentId"
  | "invalidName"
  | "unknownArea";

export class IssueFormInvalid extends Error {
  constructor(readonly reason: IssueFormError) {
    super(reason);
    this.name = "IssueFormInvalid";
  }
}

/** 範本（feature.md）的 `## ` 標題，依出現順序。 */
export function templateHeadings(template: string): string[] {
  return template
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .filter((l) => /^## \S/.test(l))
    .map((l) => l.trimEnd());
}

// feature.md 的標題依序是：目標、驗收條件、範圍外、依賴與相關
const [GOAL_HEADING, ACCEPTANCE_HEADING] = templateHeadings(featureTemplate);

/** 「先提計畫」在表單上的狀態：預設是否勾選、能不能取消（#108 第 4 點）。 */
export function planFirstOption(workTypeId: string, config: IssueConfig): { checked: boolean; locked: boolean } {
  const t = workTypeOf(workTypeId, config);
  return t.highRisk ? { checked: true, locked: true } : { checked: t.planFirst, locked: false };
}

/** 實際是否先提計畫：高風險一律是；否則依使用者的選擇，沒有選擇時用預設。 */
export function resolvePlanFirst(workTypeId: string, choice: boolean | undefined, config: IssueConfig): boolean {
  const option = planFirstOption(workTypeId, config);
  return option.locked ? true : (choice ?? option.checked);
}

function workTypeOf(workTypeId: string, config: IssueConfig): WorkTypeIssueConfig {
  if (!Object.hasOwn(config.workTypes, workTypeId)) throw new IssueFormInvalid("unknownWorkType");
  const t = config.workTypes[workTypeId];
  // 設定錯誤也不能讓派工標籤或其他控制標籤混進建立時的標籤
  if (!t.label.startsWith(TYPE_PREFIX) || /\s/.test(t.label)) throw new IssueFormInvalid("invalidConfig");
  return t;
}

const SINGLE_LINE = (s: string) => !/[\r\n]/.test(s);
// 交辦編號：英數字、`_`、`-`，讀回時以末行比對
const ASSIGNMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ASSIGNMENT_LINE = /^crew-assignment: ([A-Za-z0-9_-]{1,64})(?:;|$)/;

/** 末行：交辦編號、員工與交辦人。 */
const assignmentLine = (form: AssignmentForm) =>
  `crew-assignment: ${form.assignmentId}; employee: ${form.employee.trim()}; by: ${form.assignedBy.trim()}`;

/** 交辦表單 → `{ title, body, labels }`。不合格時丟出 IssueFormInvalid。 */
export function assignmentToIssue(form: AssignmentForm, config: IssueConfig): IssueDraft {
  const type = workTypeOf(form.workTypeId, config);
  const summary = form.summary.trim();
  if (!summary) throw new IssueFormInvalid("emptySummary");
  if (!SINGLE_LINE(summary)) throw new IssueFormInvalid("multilineSummary");
  const acceptance = form.acceptance.map((a) => a.trim()).filter((a) => a.length > 0);
  if (acceptance.length === 0) throw new IssueFormInvalid("noAcceptance");
  if (!acceptance.every(SINGLE_LINE)) throw new IssueFormInvalid("multilineAcceptance");
  if (!ASSIGNMENT_ID.test(form.assignmentId)) throw new IssueFormInvalid("invalidAssignmentId");
  for (const name of [form.employee, form.assignedBy]) {
    if (!name.trim() || !SINGLE_LINE(name) || name.includes(";")) throw new IssueFormInvalid("invalidName");
  }
  const area = form.area?.trim() || null;
  if (area !== null && !config.areas.includes(area)) throw new IssueFormInvalid("unknownArea");

  const goal = form.goal?.trim() || summary;
  const body = [
    GOAL_HEADING,
    "",
    goal,
    "",
    ACCEPTANCE_HEADING,
    "",
    ...acceptance.map((a) => `- [ ] ${a}`),
    "",
    "---",
    "",
    assignmentLine(form),
    "",
  ].join("\n");

  const labels = [type.label];
  if (area !== null) labels.push(`${AREA_PREFIX}${area}`);
  if (resolvePlanFirst(form.workTypeId, form.planFirst, config)) labels.push(PLAN_FIRST_LABEL);
  return { title: `${type.titlePrefix}${summary}`, body, labels };
}

/** 讀回時：本文末行的平台交辦編號；沒有時是 null。 */
export function assignmentIdOf(body: string): string | null {
  const last = body.trimEnd().split(/\r?\n/).at(-1) ?? "";
  return ASSIGNMENT_LINE.exec(last)?.[1] ?? null;
}

/** 派工的一步：平台只做建立 Issue、加標籤與一般留言三種寫入（#108 D3）；派工只用前兩種與讀回。 */
export type DispatchStep =
  | { kind: "createIssue"; draft: IssueDraft }
  | { kind: "readBack"; expect: IssueDraft }
  | { kind: "addLabels"; labels: string[] };

/**
 * 派工的寫入順序（#108 第 4 點）：建立（含其他標籤，不含 agent:ready）→ 讀回比對 → 單獨加 agent:ready。
 * 讀回不一致或加標籤失敗時不重試，交辦顯示「已建立 Issue、未派工」，由人決定。
 */
export function dispatchSteps(draft: IssueDraft): DispatchStep[] {
  if (draft.labels.includes(DISPATCH_LABEL)) throw new IssueFormInvalid("invalidConfig");
  const created: IssueDraft = { title: draft.title, body: draft.body, labels: [...draft.labels] };
  return [
    { kind: "createIssue", draft: created },
    { kind: "readBack", expect: created },
    { kind: "addLabels", labels: [DISPATCH_LABEL] },
  ];
}

/** 讀回比對：不一致的欄位（標籤不論順序）；一致時是空陣列。 */
export function readBackMismatches(expected: IssueDraft, actual: IssueDraft): ("title" | "body" | "labels")[] {
  const out: ("title" | "body" | "labels")[] = [];
  if (actual.title !== expected.title) out.push("title");
  // GitHub 可能把本文的換行存成 CRLF
  if (actual.body.replace(/\r\n/g, "\n") !== expected.body) out.push("body");
  const a = [...actual.labels].sort();
  const e = [...expected.labels].sort();
  if (a.length !== e.length || a.some((l, i) => l !== e[i])) out.push("labels");
  return out;
}
