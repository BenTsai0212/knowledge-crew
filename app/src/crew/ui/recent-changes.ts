// 「最近的變化」（#182，crew ADR 0009 第四節、設計規格 v4 第 4 節）：外框的鈴鐺打開的面板，列出最近 4 則。
// 變化從工作帳本的事件推算，不另存、不記錄已讀（鈴鐺不顯示數字）：
// 審查方式改變（同意、收回、自動改回）、守則等你確認（員工提出、還沒有決定）、抽查的結果、退回。
// 抽查不存（crew ADR 0008 第 7 點），由 trust/spot-check.ts 的 spotChecks() 推算被抽查的驗收，再由本檔把那次驗收標成抽查的結果。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { getTrustInputs } from "../db/store";
import { DEMO_PARAMS } from "../trust/demo-params";
import { spotChecks } from "../trust/spot-check";
import type { TrustParams } from "../trust/types";
import { readLedger, type LedgerEvent } from "./ledger";
import type { CrewTarget } from "./sections";

/** 面板列出的則數（設計規格 v4 第 4 節） */
export const RECENT_CHANGES_LIMIT = 4;

/** 變化的種類：決定圖示與句子 */
export type RecentChangeKind = "returned" | "spot" | "level" | "guideline";

export interface RecentChange {
  /** 帳本事件的 id（畫面的 key） */
  id: string;
  kind: RecentChangeKind;
  event: LedgerEvent;
  /** 點了切到的位置：退回與抽查是那件工作，審查方式與守則是員工 */
  target: CrewTarget;
}

const GUIDELINE_DECIDED = new Set<LedgerEvent["kind"]>(["guidelineConfirmed", "guidelineEdited", "guidelineRejected", "guidelineRetired"]);

/** 驗收事件（accepted／returned）的驗收 id：帳本事件的 id 是 `<kind>:<驗收 id>`（ledger.ts 的 mergeLedger()） */
export function reviewIdOf(event: Pick<LedgerEvent, "id" | "kind">): string | null {
  if (event.kind !== "accepted" && event.kind !== "returned") return null;
  return event.id.slice(event.kind.length + 1);
}

function workTarget(event: LedgerEvent): CrewTarget {
  return event.assignment === null ? { section: "employees", employeeId: event.employee.id } : { section: "works", assignmentId: event.assignment.id };
}

/**
 * 從帳本事件（新到舊，ledger.ts 的 compareLedger()）挑出最近的變化。
 * - 驗收：被抽查的那次（spotReviewIds）是抽查的結果（通過或退回），其他的退回是退回；其他的通過不列。
 * - 同意改看重點、收回、自動改回（含事後更正觸發的）是審查方式改變。
 * - 員工提出的守則，之後沒有確認、修改後確認、不採用或收回時，是守則等你確認；已有決定的不列。
 * - 其他事件（交辦、交件、提出看重點的建議、事後更正本身、守則的決定）不列。
 */
export function recentChanges(events: readonly LedgerEvent[], spotReviewIds: ReadonlySet<string>, limit = RECENT_CHANGES_LIMIT): RecentChange[] {
  const decided = new Set(events.filter((e) => GUIDELINE_DECIDED.has(e.kind) && e.guideline).map((e) => e.guideline!.id));
  const out: RecentChange[] = [];
  for (const event of events) {
    if (out.length >= limit) break;
    const kind = changeKind(event, spotReviewIds, decided);
    if (kind === null) continue;
    const target = kind === "returned" || kind === "spot" ? workTarget(event) : { section: "employees" as const, employeeId: event.employee.id };
    out.push({ id: event.id, kind, event, target });
  }
  return out;
}

function changeKind(event: LedgerEvent, spotReviewIds: ReadonlySet<string>, decidedGuidelines: ReadonlySet<string>): RecentChangeKind | null {
  switch (event.kind) {
    case "accepted":
    case "returned": {
      const reviewId = reviewIdOf(event);
      if (reviewId !== null && spotReviewIds.has(reviewId)) return "spot";
      return event.kind === "returned" ? "returned" : null;
    }
    case "relax":
    case "revoke":
    case "autoReset":
      return "level";
    case "guidelineProposed":
      return event.guideline && !decidedGuidelines.has(event.guideline.id) ? "guideline" : null;
    default:
      return null;
  }
}

/** 帳本事件中出現的員工 × 工作類型 */
function pairsOf(events: readonly LedgerEvent[]): { employeeId: string; workTypeId: string }[] {
  const pairs = new Map<string, { employeeId: string; workTypeId: string }>();
  for (const e of events) pairs.set(JSON.stringify([e.employee.id, e.workTypeId]), { employeeId: e.employee.id, workTypeId: e.workTypeId });
  return [...pairs.values()];
}

/** 帳本事件中出現的員工 × 工作類型裡，被抽查的驗收 id（抽查不存，由 spotChecks() 推算） */
export async function readSpotReviewIds(
  db: Database,
  identity: string | null,
  events: readonly LedgerEvent[],
  params: Pick<TrustParams, "spotEvery"> = DEMO_PARAMS,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const { employeeId, workTypeId } of pairsOf(events)) {
    const inputs = await getTrustInputs(db, identity, employeeId, workTypeId);
    const spots = spotChecks(inputs.works, inputs.reviews, inputs.decisions, inputs.corrections, params);
    for (const w of inputs.works) if (w.reviewId !== null && spots.has(w.id)) ids.add(w.reviewId);
  }
  return ids;
}

/** 目前身分看得到的最近的變化（可見範圍與工作帳本相同，由 RLS 決定）。guest 與沒有身分時是空陣列。 */
export async function readRecentChanges(db: Database, identity: string | null, language: LanguageCode): Promise<RecentChange[]> {
  const events = await readLedger(db, identity, language);
  return recentChanges(events, await readSpotReviewIds(db, identity, events));
}
