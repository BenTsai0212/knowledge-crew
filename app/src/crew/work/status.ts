// 工作狀態與需注意的標記（#134）：由既有的交辦、交件與驗收推算，不新增欄位。
// 「今天」與到期狀態相同（work/due.ts 的 crewToday()：demo 固定），日期以 YYYY-MM-DD 比較，不看時刻。
import type { Verdict } from "../trust/types";
import { dueStatus, localDate } from "./due";

/** 待交件（交辦了、還沒有交件）／等驗收（最新一輪還沒驗收）／修正中（最新一次驗收是退回）／已完成（通過） */
export type WorkStatus = "notSubmitted" | "awaiting" | "revising" | "done";

/** 看板的欄位順序 */
export const WORK_STATUSES: readonly WorkStatus[] = ["notSubmitted", "awaiting", "revising", "done"];

/** 停滯：在目前狀態停留超過這個天數（已完成不算） */
export const STALL_DAYS = 3;

export interface StatusInput {
  /** 交辦時間（ISO） */
  assignedAt: string;
  /** 最新一輪；沒有交件時是 null */
  latestRound: number | null;
  /** 最新一輪的交件時間（ISO）；沒有交件時是 null */
  latestSubmittedAt: string | null;
  /** 最新一輪的驗收結果；還沒驗收或沒有交件時是 null */
  latestVerdict: Verdict | null;
  /** 最新一輪的驗收時間（ISO）；還沒驗收時是 null */
  latestDecidedAt: string | null;
}

export function workStatus(input: Pick<StatusInput, "latestRound" | "latestVerdict">): WorkStatus {
  if (input.latestRound === null) return "notSubmitted";
  if (input.latestVerdict === null) return "awaiting";
  return input.latestVerdict === "returned" ? "revising" : "done";
}

/** 進入目前狀態的時間（ISO）：待交件是交辦時間、等驗收是交件時間、修正中與已完成是驗收時間 */
export function statusSince(input: StatusInput): string {
  switch (workStatus(input)) {
    case "notSubmitted":
      return input.assignedAt;
    case "awaiting":
      return input.latestSubmittedAt ?? input.assignedAt;
    default:
      return input.latestDecidedAt ?? input.latestSubmittedAt ?? input.assignedAt;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** 在目前狀態停留的天數：今天的日期減去進入狀態那天的日期（本地時間）；今天才進入是 0，不會是負數。 */
export function stayDays(input: StatusInput, today: string): number {
  const since = localDate(new Date(statusSince(input)));
  return Math.max(0, dayNumber(today) - dayNumber(since));
}

export interface AttentionFlags {
  overdue: boolean;
  /** 3 天內到期（work/due.ts 的 soon） */
  soon: boolean;
  /** 在目前狀態停留超過 STALL_DAYS 天 */
  stalled: boolean;
}

/** 需注意的標記；已完成的工作都沒有（不標逾期、即將到期與停滯）。 */
export function attentionFlags(input: StatusInput & { dueAt: string | null }, today: string): AttentionFlags {
  if (workStatus(input) === "done") return { overdue: false, soon: false, stalled: false };
  const due = dueStatus(input.dueAt, today);
  return { overdue: due === "overdue", soon: due === "soon", stalled: stayDays(input, today) > STALL_DAYS };
}

export const needsAttention = (flags: AttentionFlags): boolean => flags.overdue || flags.soon || flags.stalled;
