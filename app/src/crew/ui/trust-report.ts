// 信任頁的總覽報表（#121，展示版第 2 階段）：每個看得到的「員工 × 工作類型」一列，
// 驗收次數、第一次就通過的比例、三種退回原因各幾次、目前層級與層級變化。
// 計數一律由工作帳本的事件（ledger.ts）算出，與帳本一致；目前層級沿用 readTrust() 的結果（rules.ts）。
import type { ReturnReason, ReviewLevel } from "../trust/types";
import { decidedSpotChecks, type CrewEmployee, type TrustRow } from "./trust";
import type { LedgerEvent } from "./ledger";

/** 層級變化：同意改看重點、收回看重點、做錯了自動改回逐項看（帳本的種類）。 */
export type LevelChangeKind = "relax" | "revoke" | "autoReset";

export interface TrustReportRow {
  employee: CrewEmployee;
  workTypeId: string;
  /** 驗收次數（全部紀錄：通過＋退回） */
  reviews: number;
  /** 第一次就通過：第 1 輪已驗收的交辦中，第 1 輪就通過的件數 */
  firstPass: { passed: number; total: number };
  /** 三種退回原因各幾次 */
  returns: Record<ReturnReason, number>;
  level: ReviewLevel;
  /** 層級變化的次數 */
  levelChanges: number;
  /** 最近一次層級變化；沒有時是 null */
  lastChange: { kind: LevelChangeKind; at: string } | null;
  /** 已驗收的抽查次數與其中做錯了的次數（#166）；沒有已驗收的抽查時是 null。抽查不記在帳本，取自 readTrust() 的列 */
  spot: { count: number; wrong: number } | null;
}

const LEVEL_CHANGES: ReadonlySet<string> = new Set<LevelChangeKind>(["relax", "revoke", "autoReset"]);

/**
 * 依 readTrust() 的列（看得到的組合與順序、目前層級）與帳本的事件整理報表。
 * events 依時間新到舊（mergeLedger() 的順序）；只算同一員工 × 同一工作類型的事件。
 */
export function trustReport(rows: readonly TrustRow[], events: readonly LedgerEvent[]): TrustReportRow[] {
  return rows.map((row) => {
    const mine = events.filter((e) => e.employee.id === row.employee.id && e.workTypeId === row.workTypeId);
    const returns: Record<ReturnReason, number> = { wrong: 0, different_approach: 0, process: 0 };
    const firstRound = new Map<string, boolean>();
    let reviews = 0;
    let levelChanges = 0;
    let lastChange: TrustReportRow["lastChange"] = null;
    for (const e of mine) {
      if (e.kind === "accepted" || e.kind === "returned") {
        reviews += 1;
        if (e.kind === "returned" && e.reason !== null) returns[e.reason] += 1;
        if (e.round === 1 && e.assignment) firstRound.set(e.assignment.id, e.kind === "accepted");
      } else if (LEVEL_CHANGES.has(e.kind)) {
        levelChanges += 1;
        // 新到舊：第一筆就是最近一次
        lastChange ??= { kind: e.kind as LevelChangeKind, at: e.at };
      }
    }
    const passed = [...firstRound.values()].filter(Boolean).length;
    return {
      employee: row.employee,
      workTypeId: row.workTypeId,
      reviews,
      firstPass: { passed, total: firstRound.size },
      returns,
      level: row.level,
      levelChanges,
      lastChange,
      spot: decidedSpotChecks(row.spotChecks) === 0 ? null : { count: decidedSpotChecks(row.spotChecks), wrong: row.spotChecks.wrong },
    };
  });
}

/** 第一次就通過的比例（0～100 的整數）；沒有第 1 輪的驗收時是 null。 */
export const firstPassPercent = ({ passed, total }: TrustReportRow["firstPass"]): number | null =>
  total === 0 ? null : Math.round((passed / total) * 100);
