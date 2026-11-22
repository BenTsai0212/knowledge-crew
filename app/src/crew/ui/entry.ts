// knowledge-kit 的畫面接上 crew 的接入點（#34，ADR 0004「畫面入口」）：頁籤是否顯示、頁籤名稱、組合 seed。
// knowledge-kit 的 App.tsx、Sidebar.tsx 只呼叫這裡的函式；crew 的功能一律放在 app/src/crew/。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { LanguageCode } from "../../client/types";
import { crewOnly, type View } from "../../ui/online-demo";
import { DEMO_RAW } from "../demo/load";
import { demoSeed, type DemoSeedConfig } from "../demo/seed";
import { CREW_TRANSLATIONS } from "../i18n";

/** 選定的客戶有 client/crew/demo.json 時才顯示 crew（沒有的客戶只套用 migration、不匯入）。 */
export const hasCrewDemo: boolean = DEMO_RAW !== null;

/**
 * 只展示 AI 員工的 build（VITE_CREW_ONLY=1，#84）且客戶有 demo.json 時開啟。
 * 沒有 demo.json 的客戶不能只留 AI 員工（畫面會是空的），開關不生效。
 */
export const crewOnlyMode: boolean = crewOnly && hasCrewDemo;

/**
 * 在 knowledge-kit 的頁籤（visibleViews() 的結果）之後接上 crew。沒有 demo.json 或展示模式時不加；
 * 身分不影響（內容由 RLS 決定），線上 demo 照常顯示（#34 的 `## 決定` 2）。
 * crew-only（#84 的 `## 決定` 3）：只有 AI 員工，knowledge-kit 的頁籤全部不顯示。
 */
export function withCrew(views: readonly View[], hasDemo: boolean, presentation: boolean, only = false): View[] {
  if (hasDemo && only) return ["crew"];
  return hasDemo && !presentation ? [...views, "crew"] : [...views];
}

/** 登入後的預設頁：crew-only 時是 AI 員工（CrewPage 的預設是「今天」），其他情況沿用 knowledge-kit 的預設頁。 */
export const crewDefaultView = (base: View, only: boolean): View => (only ? "crew" : base);

/**
 * crew-only 時登入用的固定值：App 以「邀請碼不是 null」代表已登入，沿用既有的登入、身分切換流程。
 * 不是 secret，也不會送出：crew-only 沒有任何會呼叫 /api/* 的頁面。
 */
export const CREW_ONLY_ACCESS_CODE = "crew-only";

/** 登入頁「直接體驗」按鈕的文字（crew-only）；客戶沒有 crew 的翻譯檔時是空字串。 */
export function crewDirectEntryLabel(language: LanguageCode): string {
  return CREW_TRANSLATIONS.common?.[language]?.directEntry ?? "";
}

type Seed = (pg: PGliteInterface) => Promise<void>;

/**
 * openDatabase() 的 seed：先執行 knowledge-kit 的 seed，有 demo.json 時再匯入 crew 的虛構資料。
 * demo.json 驗證失敗時拋錯（Promise 被拒絕），由 App 顯示既有的載入失敗畫面，不靜默略過。
 */
export function crewSeed(base: Seed, config: DemoSeedConfig, raw: unknown = DEMO_RAW): Seed {
  return async (pg) => {
    await base(pg);
    if (raw !== null) await demoSeed(raw, config)(pg);
  };
}

/** 頁籤名稱；客戶沒有 crew 的翻譯檔時（不顯示 crew 頁籤）是空字串，不拋錯。 */
export function crewTabLabel(language: LanguageCode): string {
  return CREW_TRANSLATIONS.common?.[language]?.tab ?? "";
}
