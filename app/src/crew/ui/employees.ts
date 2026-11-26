// 「員工」畫面的資料整理（#37；#83 改為員工卡，設計規格 v3 第 6.5 節）：看得到的員工與每類工作的目前層級、
// 驗收次數、待驗收件數、平常的工作來源、最近的圓點與一句說明（看重點的建議或最近的層級事件）。
// 由 readTrust() 的結果依員工分組；沒有看得到的組合的員工也列出（workTypes 為空）。
// 完全沒有看得到的組合時（guest：RLS 讓它看得到員工，但看不到交辦）回傳空的，畫面顯示空狀態。
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { listAssignments, listGuidelines, type AssignmentSummary, type SourceKind, type StoredGuideline } from "../db/store";
import type { GuidelineStatus, ProposerKind } from "../guidelines/status";
import type { Dot, ReviewLevel } from "../trust/types";
import { assignStatus, usualOf } from "./assign";
import { guidelineTexts } from "./guideline-text";
import { sourceLabel } from "./refs";
import { readTrust, type CrewEmployee, type TimelineEvent, type Trust } from "./trust";

/** 卡片的一句說明：有看重點的建議（只給能驗收的身分），或時間軸上最近的層級事件。 */
export type EmployeeNote = { kind: "suggestion" } | { kind: "event"; event: TimelineEvent };

export interface EmployeeWorkType {
  workTypeId: string;
  level: ReviewLevel;
  reviewCount: number;
  /** 最近幾次的圓點（舊到新，與信任頁相同） */
  dots: Dot[];
  /** dots 的每一格被事後更正的時間（#164）；省略或 null 時沒有更正 */
  dotCorrections?: (string | null)[];
  /** 待驗收件數：最新一輪已交件、還沒驗收的交辦 */
  awaiting: number;
  /** 平常的工作來源（該員工 × 工作類型的交辦中最常用的，名稱是目前語言）；沒有時是 null */
  source: { label: string; kind: SourceKind } | null;
  note: EmployeeNote | null;
}

/** 員工卡上的一條守則（#145，ADR 0007）；文字是目前語言（demo 以外是資料庫的原文） */
export interface EmployeeGuideline {
  id: string;
  workTypeId: string;
  status: GuidelineStatus;
  /** 目前的文字（確認時修改過就是修改後的文字） */
  text: string;
  /** 提出的文字（「修改後確認」預填） */
  proposedText: string;
  /** 確認時修改過 */
  revised: boolean;
  proposerKind: ProposerKind;
  proposedAt: string;
  /** 來源退回的時間；看不到來源交辦時是提出的時間 */
  returnedAt: string;
  /** 確認的時間；沒有確認時是 null */
  confirmedAt: string | null;
  /** 收回或不採用的時間；其他狀態是 null */
  closedAt: string | null;
  /** 之後的交件依照了幾次（員工自述，看得到的交件） */
  followed: number;
  /** 驗收的逐條回饋把這條標成「沒做到」的次數（看得到的驗收，crew ADR 0008 第 14 點） */
  notDone: number;
  /** 「看那次退回」切到的交辦 */
  sourceAssignmentId: string;
}

/** 員工卡的守則：等確認排最前，再來是生效的；已收回與不採用收在一起（依提出時間） */
export interface EmployeeGuidelines {
  pending: EmployeeGuideline[];
  active: EmployeeGuideline[];
  closed: EmployeeGuideline[];
}

export type EmployeeSummary = CrewEmployee & { workTypes: EmployeeWorkType[]; guidelines: EmployeeGuidelines };

type AssignmentFields = Pick<AssignmentSummary, "employeeId" | "workTypeId" | "sourceId" | "sourceKind" | "sourceName" | "latestRound" | "latestVerdict">;

export function groupEmployees(
  trust: Pick<Trust, "employees" | "rows">,
  assignments: readonly AssignmentFields[],
  language: LanguageCode,
): Omit<EmployeeSummary, "guidelines">[] {
  if (trust.rows.length === 0) return [];
  return trust.employees.map((e) => ({
    ...e,
    workTypes: trust.rows
      .filter((r) => r.employee.id === e.id)
      .map(({ workTypeId, level, reviewCount, dots, dotCorrections, suggestion, timeline }): EmployeeWorkType => {
        const own = assignments.filter((a) => a.employeeId === e.id && a.workTypeId === workTypeId);
        const usual = own.find((a) => a.sourceId === usualOf(own, e.id).sourceId);
        const event = timeline.events.at(-1)?.items.at(-1);
        return {
          workTypeId,
          level,
          reviewCount,
          dots,
          dotCorrections,
          awaiting: own.filter((a) => assignStatus(a) === "awaitingReview").length,
          source: usual ? { label: sourceLabel(usual.sourceId, usual.sourceName, language), kind: usual.sourceKind } : null,
          note: suggestion ? { kind: "suggestion" } : event ? { kind: "event", event } : null,
        };
      }),
  }));
}

export async function readEmployees(
  db: Database,
  identity: string | null,
  language: LanguageCode,
  canReview = false,
): Promise<EmployeeSummary[]> {
  // 看重點的建議只給能驗收的身分（與信任頁一致）
  const trust = await readTrust(db, identity, language, canReview);
  if (identity === null || trust.rows.length === 0) return [];
  const employees = groupEmployees(trust, await listAssignments(db, identity), language);
  const guidelines = await listGuidelines(db, identity);
  const followed = await readFollowCounts(db, identity);
  return employees.map((e) => ({ ...e, guidelines: groupGuidelines(guidelines.filter((g) => g.employeeId === e.id), followed, language) }));
}

/** 一位員工的守則分成等確認、生效、已收回與不採用；文字以 demoText() 換成目前語言。 */
export function groupGuidelines(
  guidelines: readonly StoredGuideline[],
  followed: ReadonlyMap<string, number>,
  language: LanguageCode,
): EmployeeGuidelines {
  const items = guidelines.map((g) => toEmployeeGuideline(g, followed.get(g.id) ?? 0, language));
  return {
    pending: items.filter((g) => g.status === "pending"),
    active: items.filter((g) => g.status === "active"),
    closed: items.filter((g) => g.status === "revoked" || g.status === "rejected"),
  };
}

function toEmployeeGuideline(g: StoredGuideline, followed: number, language: LanguageCode): EmployeeGuideline {
  const { proposed: proposedText, revised: revision } = guidelineTexts(g, language);
  const confirm = g.decisions.find((d) => d.decision === "confirm");
  const last = g.decisions.at(-1);
  return {
    id: g.id,
    workTypeId: g.workTypeId,
    status: g.status,
    text: revision ?? proposedText,
    proposedText,
    revised: revision !== null,
    proposerKind: g.proposerKind,
    proposedAt: g.proposedAt,
    returnedAt: g.sourceReview?.decidedAt ?? g.proposedAt,
    confirmedAt: confirm?.decidedAt ?? null,
    closedAt: (g.status === "revoked" || g.status === "rejected") && last ? last.decidedAt : null,
    followed,
    notDone: g.notDoneCount,
    sourceAssignmentId: g.sourceAssignmentId,
  };
}

/** 每條守則被看得到的交件依照了幾次（crew.work_guidelines；可見範圍由 RLS 決定） */
function readFollowCounts(db: Database, identity: string): Promise<Map<string, number>> {
  return db.withIdentity(identity, async (tx) => {
    const result = await tx.query<{ id: string; count: number }>(
      `SELECT guideline_id AS id, count(*)::int AS count FROM crew.work_guidelines GROUP BY guideline_id`,
    );
    return new Map(result.rows.map((r) => [r.id, r.count]));
  });
}
