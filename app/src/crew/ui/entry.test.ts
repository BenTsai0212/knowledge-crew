import { describe, expect, it, vi } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { CREW_TRANSLATIONS } from "../i18n";
import { visibleViews, type View } from "../../ui/online-demo";
import { CREW_ONLY_ACCESS_CODE, CREW_ONLY_KIT_VIEWS, crewDefaultView, crewDirectEntryLabel, crewNoAskNote, crewOnlyMode, crewSeed, crewStartIdentity, crewTabLabel, entryPoints, hasCrewDemo, withCrew } from "./entry";
import { CREW_SECTIONS } from "./sections";

const off = { enabled: false };

describe("withCrew：crew 頁籤顯示的條件", () => {
  it("有 demo.json、非展示模式時接在 knowledge-kit 的頁籤之後", () => {
    const base = visibleViews(true, off, false, false);
    expect(withCrew(base, true, false)).toEqual([...base, "crew"]);
    expect(withCrew(visibleViews(false, off, false, false), true, false).at(-1)).toBe("crew");
  });

  it("線上 demo 照常顯示", () => {
    expect(withCrew(visibleViews(true, { enabled: true }, false, false), true, false)).toContain("crew");
  });

  it("沒有 demo.json 的客戶不顯示", () => {
    const base = visibleViews(true, off, false, false);
    expect(withCrew(base, false, false)).toEqual(base);
  });

  it("展示模式不顯示", () => {
    expect(withCrew(visibleViews(true, off, true, false), true, true)).toEqual(["qa", "graph"]);
    // 不依賴 visibleViews() 先過濾
    expect(withCrew(["home", "qa"] satisfies View[], true, true)).toEqual(["home", "qa"]);
  });

  it("參考情境 client/ 有 demo.json", () => {
    expect(hasCrewDemo).toBe(true);
  });
});

describe("crew-only（VITE_CREW_ONLY=1，#84）", () => {
  it("首頁、圖譜、時間軸與 AI 員工（#91）：身分（canReview）、線上 demo、評測台都不影響；問答、上傳、待審、評測台不顯示", () => {
    for (const canReview of [true, false])
      for (const enabled of [true, false])
        for (const evals of [true, false]) {
          const views = withCrew(visibleViews(canReview, { enabled }, false, evals), true, false, true);
          expect(views).toEqual(["home", "graph", "timeline", "crew"]);
          for (const hidden of ["qa", "upload", "review", "evals"] satisfies View[]) expect(views).not.toContain(hidden);
        }
  });

  it("knowledge-kit 的頁籤順序沿用 visibleViews()，AI 員工接在後面", () => {
    expect(CREW_ONLY_KIT_VIEWS).toEqual(["home", "graph", "timeline"]);
    expect(withCrew(["timeline", "qa", "graph", "home"] satisfies View[], true, false, true)).toEqual(["timeline", "graph", "home", "crew"]);
    // 展示模式在 crew-only 時一律關閉（online-demo.ts）；即使傳入展示模式的頁籤，也只留看得到的 knowledge-kit 頁籤
    expect(withCrew(visibleViews(true, off, true, false), true, true, true)).toEqual(["graph", "crew"]);
  });

  it("入口：crew-only 沒有問答、待審、上傳的入口，一般 build 與含問答的線上 demo 不變", () => {
    for (const canReview of [true, false]) {
      expect(entryPoints(withCrew(visibleViews(canReview, off, false, false), true, false, true))).toEqual({ ask: false, review: false, upload: false });
      expect(entryPoints(withCrew(visibleViews(canReview, off, false, false), true, false))).toEqual({ ask: true, review: canReview, upload: true });
      expect(entryPoints(withCrew(visibleViews(canReview, { enabled: true }, false, false), true, false))).toEqual({ ask: true, review: canReview, upload: true });
    }
  });

  it("首頁沒有提問框時的一行說明：每個語言都有；沒有翻譯時是空字串，不拋錯", () => {
    for (const language of clientConfig.client.languages) expect(crewNoAskNote(language)).not.toBe("");
    expect(crewNoAskNote("xx")).toBe("");
  });

  it("沒有 demo.json 的客戶不生效，沿用 knowledge-kit 的頁籤", () => {
    const base = visibleViews(true, off, false, false);
    expect(withCrew(base, false, false, true)).toEqual(base);
  });

  it("關閉時與現行相同（預設參數）", () => {
    const base = visibleViews(true, off, false, false);
    expect(withCrew(base, true, false, false)).toEqual(withCrew(base, true, false));
  });

  it("登入後的預設頁：開啟時是 AI 員工，關閉時沿用 knowledge-kit 的預設頁", () => {
    expect(crewDefaultView("home", true)).toBe("crew");
    expect(crewDefaultView("qa", true)).toBe("crew");
    expect(crewDefaultView("home", false)).toBe("home");
    expect(crewDefaultView("qa", false)).toBe("qa");
  });

  it("一開始的身分：開啟時是能驗收的主管，關閉時是第一個身分（線上 demo 與一般 build 不變）", () => {
    const { access } = clientConfig;
    expect(crewStartIdentity(access, true)).toBe("manager");
    expect(access.roles.find((r) => r.id === crewStartIdentity(access, true))?.canReview).toBe(true);
    expect(crewStartIdentity(access, false)).toBe(access.roles[0].id);
    expect(crewStartIdentity(access, crewOnlyMode)).toBe(access.roles[0].id);
  });

  it("一開始的身分：沒有能驗收的身分時是第一個身分", () => {
    const roles = [
      { id: "a", canReview: false },
      { id: "b", canReview: false },
    ];
    expect(crewStartIdentity({ roles } as never, true)).toBe("a");
    expect(crewStartIdentity({ roles: [{ id: "a", canReview: false }, { id: "b", canReview: true }, { id: "c", canReview: true }] } as never, true)).toBe("b");
  });

  it("測試環境沒有設定開關，所以是關閉的", () => {
    expect(crewOnlyMode).toBe(false);
  });

  it("登入用的固定值不是空字串（App 以「不是 null」代表已登入）", () => {
    expect(CREW_ONLY_ACCESS_CODE.trim()).not.toBe("");
  });

  it("「直接體驗」的文字：每個語言都有；沒有翻譯時是空字串，不拋錯", () => {
    for (const language of clientConfig.client.languages) expect(crewDirectEntryLabel(language)).not.toBe("");
    expect(crewDirectEntryLabel("xx")).toBe("");
  });
});

// 開資料庫（套用全部 migration）的測試接近 Vitest 預設的 5 秒，CI 較慢時會逾時（seed.test.ts 的 DB_TIMEOUT，PR #47）
const DB_TIMEOUT = 20_000;

describe("crewSeed：先 knowledge-kit、後 crew", { timeout: DB_TIMEOUT }, () => {
  it("沒有 demo.json 時只執行 knowledge-kit 的 seed", async () => {
    const base = vi.fn(async () => {});
    const db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: crewSeed(base, clientConfig, null) });
    expect(base).toHaveBeenCalledTimes(1);
    const n = await db.withIdentity("manager", async (tx) => (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM crew.assignments")).rows[0].n);
    expect(n).toBe(0);
    await db.close();
  });

  it("有 demo.json 時在 knowledge-kit 的 seed 之後匯入", async () => {
    const order: string[] = [];
    const db = await openDatabase(clientConfig, {
      migrations: crewMigrations,
      seed: crewSeed(async (pg) => {
        order.push("kit");
        const n = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM crew.assignments")).rows[0].n;
        expect(n).toBe(0);
      }, clientConfig),
    });
    expect(order).toEqual(["kit"]);
    const n = await db.withIdentity("manager", async (tx) => (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM crew.assignments")).rows[0].n);
    expect(n).toBeGreaterThan(0);
    await db.close();
  });

  it("demo.json 驗證失敗時拒絕，不靜默略過", async () => {
    const broken = { ...(DEMO_RAW as object), employees: "not a list" };
    await expect(openDatabase(clientConfig, { migrations: crewMigrations, seed: crewSeed(async () => {}, clientConfig, broken) })).rejects.toThrow();
  });
});

describe("頁籤與子導覽的名稱", () => {
  it("每種語言都有頁籤名稱", () => {
    for (const language of clientConfig.client.languages) expect(crewTabLabel(language)).not.toBe("");
  });

  it("沒有翻譯檔的語言是空字串，不拋錯", () => {
    expect(crewTabLabel("xx")).toBe("");
  });

  it("子導覽六個位置依序排列，每個都有名稱的鍵", () => {
    expect(CREW_SECTIONS.map((s) => s.id)).toEqual(["today", "employees", "assignments", "works", "trust", "ledger"]);
    for (const language of clientConfig.client.languages) {
      for (const s of CREW_SECTIONS) expect(CREW_TRANSLATIONS.common[language][s.label], `${language}.${s.label}`).toBeTruthy();
    }
  });
});
