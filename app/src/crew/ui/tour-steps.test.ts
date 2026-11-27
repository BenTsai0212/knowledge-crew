// 第一次來的導覽（#122）：步驟、看過的紀錄、對話框的位置，以及回流知識庫那一步選到的工作。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { crewStrings } from "../i18n";
import { readWorkList } from "./review";
import {
  dialogPlace,
  inView,
  phoneTargetTop,
  PHONE_GAP,
  pickTarget,
  PRIMARY_WAIT_MS,
  readTourFlowback,
  readTourSeen,
  scrollBlock,
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  writeTourSeen,
  type SeenStorage,
} from "./tour-steps";

const lang = clientConfig.client.defaultLanguage;
const DB_TIMEOUT = 20_000;

describe("TOUR_STEPS", () => {
  it("8 步：今天的工作 → 驗收面板 → 退回原因 → 守則 → 信任 → 抽查 → 事後更正 → 回流知識庫（#171）", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["today", "review", "return", "guidelines", "trust", "spot", "correction", "flowback"]);
    expect(TOUR_STEPS.map((s) => s.go.kind)).toEqual(["home", "crew", "crew", "crew", "crew", "crew", "crew", "flowback"]);
  });

  it("抽查與事後更正切到「工作與驗收」並選取 demo 的 k17、k01，退路是驗收面板（#171）", () => {
    const spot = TOUR_STEPS.find((s) => s.id === "spot")!;
    expect(spot.go).toEqual({ kind: "crew", target: { section: "works", assignmentId: "k17" } });
    expect(spot.targets).toEqual([".crew-review__spot", ".crew-review__panel"]);
    const correction = TOUR_STEPS.find((s) => s.id === "correction")!;
    expect(correction.go).toEqual({ kind: "crew", target: { section: "works", assignmentId: "k01" } });
    expect(correction.targets).toEqual([".crew-review__correction", ".crew-review__panel"]);
  });

  it("入口小卡寫的步數與步驟數相同（#171）", () => {
    expect(TOUR_STEPS).toHaveLength(8);
    const stepCount: Record<string, RegExp> = { "zh-TW": /(^|\D)8 步/, en: /^Eight steps/ };
    for (const language of clientConfig.client.languages) {
      if (stepCount[language]) expect(crewStrings("tour", language).cardBody, language).toMatch(stepCount[language]);
    }
  });

  it("守則一步切到「員工」，先標出有等確認守則的區塊（#151）", () => {
    const step = TOUR_STEPS.find((s) => s.id === "guidelines")!;
    expect(step.go).toEqual({ kind: "crew", target: { section: "employees" } });
    expect(step.targets).toEqual([".crew-employees__guidelines[data-pending]", ".crew-employees__guidelines"]);
  });

  it("審查方式一步切到「員工」（#191：原本的「信任」子頁移到員工卡內），標出第一個審查方式的列", () => {
    const step = TOUR_STEPS.find((s) => s.id === "trust")!;
    expect(step.go).toEqual({ kind: "crew", target: { section: "employees" } });
    expect(step.targets).toEqual([".crew-trust__row", ".crew-employees"]);
  });

  it("每一步都有標題、說明與至少一個目標，文字在每種語言都有", () => {
    for (const step of TOUR_STEPS) {
      expect(step.targets.length, step.id).toBeGreaterThan(0);
      for (const language of clientConfig.client.languages) {
        const t = crewStrings("tour", language);
        expect(t[step.title], `${step.id}.${language}`).not.toBe("");
        expect(t[step.body], `${step.id}.${language}`).not.toBe("");
      }
    }
  });
});

describe("pickTarget", () => {
  const has = (...present: string[]) => (selector: string) => present.includes(selector);

  it("先只找第一個目標，過了 PRIMARY_WAIT_MS 才用退路", () => {
    expect(pickTarget([".a", ".b"], has(".a", ".b"), 0)).toBe(".a");
    expect(pickTarget([".a", ".b"], has(".b"), 0)).toBeNull();
    expect(pickTarget([".a", ".b"], has(".b"), PRIMARY_WAIT_MS)).toBe(".b");
    expect(pickTarget([".a", ".b"], has(), PRIMARY_WAIT_MS)).toBeNull();
  });
});

describe("看過的紀錄", () => {
  const memory = (): SeenStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const throwing: SeenStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  it("沒寫過是沒看過；寫入後是看過", () => {
    const storage = memory();
    expect(readTourSeen(() => storage)).toBe(false);
    writeTourSeen(() => storage);
    expect(storage.data.get(TOUR_STORAGE_KEY)).toBe("1");
    expect(readTourSeen(() => storage)).toBe(true);
  });

  it("讀寫拋錯或沒有 localStorage 時當成沒看過，不拋錯", () => {
    expect(readTourSeen(() => throwing)).toBe(false);
    expect(() => writeTourSeen(() => throwing)).not.toThrow();
    expect(readTourSeen(() => null)).toBe(false);
    expect(() => writeTourSeen(() => null)).not.toThrow();
    expect(
      readTourSeen(() => {
        throw new Error("SecurityError");
      }),
    ).toBe(false);
  });
});

describe("對話框的位置與捲動", () => {
  it("目標在下半部時放上方，其他（含沒有目標）放下方", () => {
    expect(dialogPlace({ top: 600, height: 100 }, 800)).toBe("top");
    expect(dialogPlace({ top: 100, height: 100 }, 800)).toBe("bottom");
    expect(dialogPlace(null, 800)).toBe("bottom");
  });

  it("比畫面高六成的目標對齊上緣，其他置中；整個在畫面上時不必捲動", () => {
    expect(scrollBlock({ top: 0, height: 700 }, 800)).toBe("start");
    expect(scrollBlock({ top: 0, height: 200 }, 800)).toBe("center");
    expect(inView({ top: 10, height: 200 }, 800)).toBe(true);
    expect(inView({ top: 700, height: 200 }, 800)).toBe(false);
    expect(inView({ top: -5, height: 200 }, 800)).toBe(false);
  });
});

describe("phoneTargetTop：手機的目標捲到對話框上方（#131）", () => {
  // 頂端列到 91、底部分頁列從 772 開始、對話框高 191：可用空間是 103～557（454px）
  const frame = { top: 91, bottom: 772 };
  const space = { top: 91 + PHONE_GAP, bottom: 772 - PHONE_GAP - 191 - PHONE_GAP };

  it("放得下時在對話框上方的空間置中，整個不被對話框蓋住", () => {
    const top = phoneTargetTop(300, frame, 191);
    expect(top).toBe(space.top + Math.floor((space.bottom - space.top - 300) / 2));
    expect(top).toBeGreaterThanOrEqual(space.top);
    expect(top + 300).toBeLessThanOrEqual(space.bottom);
  });

  it("比空間高時對齊空間的上緣：上緣不被頂端列蓋住，空間內全是目標", () => {
    expect(phoneTargetTop(486, frame, 191)).toBe(space.top);
    expect(phoneTargetTop(space.bottom - space.top, frame, 191)).toBe(space.top);
  });

  it("沒有頂端列與分頁列時以整個畫面計算", () => {
    expect(phoneTargetTop(100, { top: 0, bottom: 800 }, 200)).toBe(PHONE_GAP + Math.floor((800 - 3 * PHONE_GAP - 200 - 100) / 2));
  });
});

describe.skipIf(DEMO_RAW === null)("readTourFlowback：匯入虛構資料後", () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  }, DB_TIMEOUT);
  afterAll(() => db.close());

  const reviewer = clientConfig.access.roles.find((r) => r.canReview)!.id;

  it("能驗收的身分：最近驗收過的清單中最新一件已回流的知識庫工作", async () => {
    const id = await readTourFlowback(db, reviewer, lang);
    expect(id).not.toBeNull();
    const { recent } = await readWorkList(db, reviewer, lang);
    const item = recent.find((i) => i.id === id)!;
    expect(item.verdict).toBe("accepted");
    expect(item.workTypeId).toBe("knowledge");
    // 清單上排在它之前的知識庫工作都沒有回流（或沒有）
    expect(recent.slice(0, recent.indexOf(item)).filter((i) => i.workTypeId === "knowledge" && i.verdict === "accepted")).toEqual([]);
  }, DB_TIMEOUT);
});
