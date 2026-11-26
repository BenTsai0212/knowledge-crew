// 今天的工作的資料整理（#34 計畫第 5 節）：待驗收、進行中、建議改看重點；首頁的「今天的工作」（#96，home-today.ts）使用。只用 store.ts 與 rules.ts，
// 可見範圍由 RLS 決定。資料庫的文字以 demoText() 換成目前語言，找不到時用資料庫的原文。
import type { AccessFile, LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import {
  getAssignmentWorks, getTrustInputs, listAssignments, listEmployees, listGuidelines, type AssignmentSummary, type SourceKind, type StoredEmployee,
} from "../db/store";
import { demoText } from "../demo/texts";
import { sourceLabel } from "./refs";
import { DEMO_PARAMS } from "../trust/demo-params";
import { relaxSuggestion } from "../trust/rules";
import type { TrustParams, WorkCheck } from "../trust/types";

export interface TodayEmployee {
  id: string;
  displayName: string;
  /** 目前語言的說明；沒有時是 null */
  roleNote: string | null;
}

export interface TodayAssignment {
  id: string;
  title: string;
  sourceKind: SourceKind;
  sourceName: string;
  externalRef: string | null;
  workTypeId: string;
  employee: TodayEmployee;
  /** 待驗收：最新一輪各檢查最新一筆的狀態（首頁的「有檢查沒通過」，#96）；進行中是空的 */
  checks: WorkCheck[];
  /** 進行中：退回後等下一輪（否則是還沒交件） */
  returned: boolean;
}

export interface TodaySuggestion {
  employee: TodayEmployee;
  workTypeId: string;
  /** 依據的驗收次數 */
  count: number;
}

/** 等確認的守則（#145：員工提出、還沒有決定；決定在員工頁做） */
export interface TodayGuideline {
  id: string;
  employee: TodayEmployee;
  workTypeId: string;
}

export interface Today {
  /** 能驗收的身分（client/access.json 的 canReview）才有「等你驗收」與建議改看重點 */
  canReview: boolean;
  awaitingReview: TodayAssignment[];
  inProgress: TodayAssignment[];
  suggestions: TodaySuggestion[];
  /** 等確認的守則（只有能驗收的身分），依提出時間 */
  guidelines: TodayGuideline[];
}

/** 與 knowledge-kit 判斷待審頁籤相同：依 client/access.json 的角色。 */
export function canReviewOf(access: Pick<AccessFile, "roles">, identity: string | null): boolean {
  return access.roles.find((r) => r.id === identity)?.canReview ?? false;
}

const EMPTY = (canReview: boolean): Today => ({ canReview, awaitingReview: [], inProgress: [], suggestions: [], guidelines: [] });

/** 最新一輪已交件、還沒驗收 */
const isAwaiting = (a: AssignmentSummary) => a.latestRound !== null && a.latestVerdict === null;
/** 還沒交件，或退回後等下一輪 */
const isInProgress = (a: AssignmentSummary) => a.latestRound === null || a.latestVerdict === "returned";

export async function readToday(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  canReview: boolean,
  params: Pick<TrustParams, "window" | "min"> = DEMO_PARAMS,
): Promise<Today> {
  // 沒有身分時比照 guest：不讀取（#34 的 `## 決定` 補充 3）
  if (identity === null) return EMPTY(false);
  const [assignments, employees] = await Promise.all([listAssignments(db, identity), listEmployees(db, identity)]);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const employee = (id: string): TodayEmployee => toEmployee(byId.get(id) ?? { id, displayName: id, roleNote: null }, language);
  const toItem = (a: AssignmentSummary): TodayAssignment => ({
    id: a.id,
    title: demoText("title", a.id, language) ?? a.title,
    sourceKind: a.sourceKind,
    sourceName: sourceLabel(a.sourceId, a.sourceName, language),
    externalRef: a.externalRef,
    workTypeId: a.workTypeId,
    employee: employee(a.employeeId),
    checks: [],
    returned: a.latestVerdict === "returned",
  });
  const withChecks = async (item: TodayAssignment): Promise<TodayAssignment> => {
    const works = await getAssignmentWorks(db, identity, item.id);
    return { ...item, checks: works.at(-1)?.checks ?? [] };
  };
  // listAssignments() 是新到舊；畫面依交辦時間舊到新排
  const oldestFirst = [...assignments].reverse();
  const today: Today = {
    ...EMPTY(canReview),
    awaitingReview: await Promise.all(oldestFirst.filter(isAwaiting).map(toItem).map(withChecks)),
    inProgress: oldestFirst.filter(isInProgress).map(toItem),
  };
  // 建議改看重點與等確認的守則只給能驗收的身分（只有他們能決定），其他身分不必計算
  if (!canReview) return today;
  const pairs = new Map<string, { employeeId: string; workTypeId: string }>();
  for (const a of oldestFirst) pairs.set(`${a.employeeId}\u0000${a.workTypeId}`, { employeeId: a.employeeId, workTypeId: a.workTypeId });
  for (const { employeeId, workTypeId } of pairs.values()) {
    const { reviews, decisions, corrections } = await getTrustInputs(db, identity, employeeId, workTypeId);
    const suggestion = relaxSuggestion(reviews, decisions, params, corrections);
    if (suggestion) today.suggestions.push({ employee: employee(employeeId), workTypeId, count: suggestion.basis.length });
  }
  const guidelines = await listGuidelines(db, identity);
  today.guidelines = guidelines
    .filter((g) => g.status === "pending")
    .map((g) => ({ id: g.id, employee: employee(g.employeeId), workTypeId: g.workTypeId }));
  return today;
}

function toEmployee(e: StoredEmployee, language: LanguageCode): TodayEmployee {
  return { id: e.id, displayName: e.displayName, roleNote: demoText("roleNote", e.id, language) ?? e.roleNote };
}
