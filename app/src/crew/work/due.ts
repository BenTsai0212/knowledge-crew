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

/** 相對期限（#193，設計規格 v5 第 5 節）：逾期 N 天／今天到期／明天到期／N 天後到期／沒有到期日 */
export type RelativeDue =
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "inDays"; days: number }
  | { kind: "none" };

/** 到期日相對於今天的天數；與 dueStatus() 相同，以日期計算（不看時刻與時區），格式不對時拋錯。 */
export function relativeDue(dueAt: string | null, today: string): RelativeDue {
  const now = dayNumber(today);
  if (dueAt === null) return { kind: "none" };
  const left = dayNumber(dueAt) - now;
  if (left < 0) return { kind: "overdue", days: -left };
  if (left === 0) return { kind: "today" };
  if (left === 1) return { kind: "tomorrow" };
  return { kind: "inDays", days: left };
}

/** 畫面標示的相對期限：已通過（done）的交辦不顯示（none）；需要確切日期的地方另外顯示日期。 */
export function shownRelativeDue(dueAt: string | null, today: string, done: boolean): RelativeDue {
  const due = relativeDue(dueAt, today);
  return done ? { kind: "none" } : due;
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
