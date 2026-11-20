// 選定客戶的 crew/demo.json（@client 別名）在 build 時讀入；客戶沒有這個檔時是 null（之後的畫面依此決定是否顯示 crew）。
// 形狀不在這裡檢查：seed 匯入前以 validate.ts 的 validateDemo() 驗證。
import type { DemoFile } from "./types";

const files = import.meta.glob<unknown>("@client/crew/demo.json", { eager: true, import: "default" });

export const DEMO_RAW: unknown = Object.values(files)[0] ?? null;

/** 未驗證的內容；使用前先通過 validateDemo()。 */
export const DEMO: DemoFile | null = DEMO_RAW as DemoFile | null;
