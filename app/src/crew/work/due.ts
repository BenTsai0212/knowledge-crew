// 交辦的到期狀態（#133）：以日期（YYYY-MM-DD）計算，不看時刻與時區。
// demo 的「今天」固定（client/crew/demo.json 的 today），逾期與「即將到期」不隨真實日期改變；沒有 today 時用目前的日期。
import type { DemoFile } from "../demo/types";

/** 逾期／即將到期（今天起 SOON_DAYS 天內）／還早／沒有到期日 */
export type DueStatus = "overdue" | "soon" | "later" | "none";

/** 「即將到期」的天數：到期日在今天起 3 天內（含今天與第 3 天） */
export const SOON_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD 且是存在的日期（例如不接受 2026-02-30） */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

const dayNumber = (date: string): number => {
  if (!isDateOnly(date)) throw new Error(`Not a date (YYYY-MM-DD): ${date}`);
  return Date.parse(`${date}T00:00:00Z`) / DAY;
};

/** 到期日相對於今天的狀態；兩者都是 YYYY-MM-DD，格式不對時拋錯。 */
export function dueStatus(dueAt: string | null, today: string): DueStatus {
  const now = dayNumber(today);
  if (dueAt === null) return "none";
  const left = dayNumber(dueAt) - now;
  if (left < 0) return "overdue";
  return left <= SOON_DAYS ? "soon" : "later";
}

/** 畫面標示的到期狀態：已通過（done）的交辦不再標逾期或即將到期，只顯示日期（later）。 */
export function shownDueStatus(dueAt: string | null, today: string, done: boolean): DueStatus {
  const status = dueStatus(dueAt, today);
  return done && (status === "overdue" || status === "soon") ? "later" : status;
}

/** 本地時間的日期（YYYY-MM-DD） */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 計算到期狀態用的「今天」：demo 有 today 時用它（固定），否則用目前的日期。 */
export function crewToday(demo: Pick<DemoFile, "today"> | null, now: Date = new Date()): string {
  return demo?.today ?? localDate(now);
}
