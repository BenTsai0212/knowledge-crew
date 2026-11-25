// 時間戳（timestamptz）的顯示一律用展示公司的時區（#153 第 8 點，使用者決定 B1），不跟著觀看者的時區。
// 時區在選定客戶的 crew/settings.json（@client 別名，與 demo/load.ts 相同的讀法）；客戶沒有這個檔時退回 UTC。
// 只有日期的欄位（到期日、demo 的 today）不經過這裡：它們以 UTC 解讀日期字串（components.tsx 的 formatDueDate、work/due.ts）。
import type { LanguageCode } from "../client/types";

const files = import.meta.glob<unknown>("@client/crew/settings.json", { eager: true, import: "default" });

/** settings 的 timeZone；不是 Intl 接受的 IANA 時區時拋錯（build 與測試時就發現）。 */
export function resolveTimeZone(settings: unknown): string {
  if (settings === null || settings === undefined) return "UTC";
  const zone = (settings as { timeZone?: unknown }).timeZone;
  if (typeof zone !== "string" || zone === "") throw new Error("crew/settings.json: timeZone must be a non-empty string");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    throw new Error(`crew/settings.json: unknown timeZone "${zone}"`);
  }
  return zone;
}

/** 展示公司的時區 */
export const CREW_TIME_ZONE = resolveTimeZone(Object.values(files)[0] ?? null);

function parts(iso: string, language: LanguageCode, options: Intl.DateTimeFormatOptions, zone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const list = new Intl.DateTimeFormat(language, { ...options, timeZone: zone }).formatToParts(date);
  return (type: Intl.DateTimeFormatPartTypes) => list.find((p) => p.type === type)?.value ?? "";
}

/** 以展示公司的時區格式化；不是合法時間時原樣回傳。 */
export function formatInZone(iso: string, language: LanguageCode, options: Intl.DateTimeFormatOptions, zone = CREW_TIME_ZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, { ...options, timeZone: zone }).format(date);
}

/** 等寬的 MM/DD */
export function shortDate(iso: string, language: LanguageCode, zone = CREW_TIME_ZONE): string {
  const part = parts(iso, language, { month: "2-digit", day: "2-digit" }, zone);
  return part === null ? iso : `${part("month")}/${part("day")}`;
}

/** 「MM/DD HH:mm」 */
export function shortDateTime(iso: string, language: LanguageCode, zone = CREW_TIME_ZONE): string {
  const part = parts(iso, language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, zone);
  return part === null ? iso : `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

/** 展示公司時區的日期（YYYY-MM-DD） */
export function zonedDay(date: Date, zone = CREW_TIME_ZONE): string {
  const list = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).formatToParts(date);
  const part = (type: string) => list.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 與 now 在展示公司的時區是同一天。 */
export const isSameDay = (iso: string, now: Date, zone = CREW_TIME_ZONE): boolean => zonedDay(new Date(iso), zone) === zonedDay(now, zone);
