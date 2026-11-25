// knowledge-kit 的畫面接上 crew 的接入點（#34，ADR 0004「畫面入口」）：頁籤是否顯示、頁籤名稱、組合 seed。
// knowledge-kit 的 App.tsx、Sidebar.tsx 只呼叫這裡的函式；crew 的功能一律放在 app/src/crew/。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { AccessFile, LanguageCode } from "../../client/types";
import { crewOnly, type View } from "../../ui/online-demo";
import { DEMO_RAW } from "../demo/load";
import { demoSeed, type DemoSeedConfig } from "../demo/seed";
import { CREW_TRANSLATIONS } from "../i18n";

/** 選定的客戶有 client/crew/demo.json 時才顯示 crew（沒有的客戶只套用 migration、不匯入）。 */
export const hasCrewDemo: boolean = DEMO_RAW !== null;

/**
 * 只展示 AI 員工的 build（VITE_CREW_ONLY=1，#84）且客戶有 demo.json 時開啟。
 * 沒有 demo.json 的客戶沒有 AI 員工可以展示，開關不生效。
 */
export const crewOnlyMode: boolean = crewOnly && hasCrewDemo;

/** crew-only 時留下的 knowledge-kit 頁籤（RFC 0001 的 2026-11-22 修訂，#91）：不呼叫模型的首頁、圖譜、時間軸。 */
export const CREW_ONLY_KIT_VIEWS: readonly View[] = ["home", "graph", "timeline"];

/**
 * 在 knowledge-kit 的頁籤（visibleViews() 的結果）之後接上 crew。沒有 demo.json 或展示模式時不加；
 * 身分不影響（內容由 RLS 決定），線上 demo 照常顯示（#34 的 `## 決定` 2）。
 * crew-only（#84 的 `## 決定` 3，#91 調整）：knowledge-kit 的頁籤只留首頁、圖譜、時間軸（順序沿用 knowledge-kit），AI 員工接在後面；
 * 問答、上傳、待審、評測台不顯示。
 */
export function withCrew(views: readonly View[], hasDemo: boolean, presentation: boolean, only = false): View[] {
  if (hasDemo && only) return [...views.filter((v) => CREW_ONLY_KIT_VIEWS.includes(v)), "crew"];
  return hasDemo && !presentation ? [...views, "crew"] : [...views];
}

/**
 * 首頁與圖譜上會切到其他頁籤的入口（#91）：目標頁籤不在 views 中時不顯示。一般 build 與含問答的線上 demo 的頁籤都有問答與上傳，
 * 待審只給 canReview 的身分（visibleViews()），所以行為不變；crew-only 時沒有問答（提問框、預設問題、「再問一次」、圖譜的「在問答中問」）、
 * 上傳（「有更新」）與待審（「等你處理」）的入口，提問框換成 noAskNote 的一行說明。
 */
export interface EntryPoints {
  ask: boolean;
  review: boolean;
  upload: boolean;
}

export function entryPoints(views: readonly View[]): EntryPoints {
  return { ask: views.includes("qa"), review: views.includes("review"), upload: views.includes("upload") };
}

/** 沒有問答時首頁提問框位置的一行說明（crew-only）；客戶沒有 crew 的翻譯檔時是空字串。 */
export function crewNoAskNote(language: LanguageCode): string {
  return CREW_TRANSLATIONS.common?.[language]?.noAsk ?? "";
}

/** 登入後的預設頁：crew-only 時是首頁（今天的工作在首頁，#96），其他情況沿用 knowledge-kit 的預設頁。 */
export const crewDefaultView = (base: View, only: boolean): View => (only ? "home" : base);

/**
 * 一開始的身分：crew-only 時是第一個能驗收的身分（主管，client/access.json 的 canReview；#86 的修正要求 2），
 * 讓「直接體驗」後首頁的今天的工作就有待驗收的工作與看重點的建議；身分仍可切換。沒有能驗收的身分或其他情況是第一個身分。
 */
export function crewStartIdentity(access: Pick<AccessFile, "roles">, only: boolean): string {
  const first = access.roles[0].id;
  return only ? (access.roles.find((r) => r.canReview)?.id ?? first) : first;
}

/**
 * crew-only 時登入用的固定值：App 以「邀請碼不是 null」代表已登入，沿用既有的登入、身分切換流程。
 * 不是 secret，也不會送出：crew-only 的頁面（首頁、圖譜、時間軸、AI 員工）都沒有會呼叫 /api/* 的入口。
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

/**
 * 進入後的焦點（#153 第 6 點，WCAG 2.4.3）：crew-only 按「直接體驗」後，登入面板被首頁取代，焦點會落到 <body>。
 * 等 selector 的元素出現（React 重新渲染之後）再移過去；timeout 內沒有出現就放棄。元素要有 tabIndex={-1}。
 */
export function focusWhenShown(selector: string, timeout = 5000): void {
  const tryFocus = () => {
    const target = document.querySelector<HTMLElement>(selector);
    target?.focus({ preventScroll: true });
    return target !== null;
  };
  if (tryFocus()) return;
  const observer = new MutationObserver(() => {
    if (tryFocus()) stop();
  });
  const timer = setTimeout(stop, timeout);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true });
}
