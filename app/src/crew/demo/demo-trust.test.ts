// 虛構資料的起始信任狀態（#60 計畫第 2 節）：匯入 demo.json 後以 getTrustInputs 讀回，用 rules.ts 與 DEMO_PARAMS 計算。
// 四位 AI 員工在 demo 開始時的狀態由這裡斷言，不只寫在註解。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { getTrustInputs } from "../db/store";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, recentDots, relaxSuggestion, reviewLevel } from "../trust/rules";
import { DEMO_RAW } from "./load";
import { demoSeed } from "./seed";

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

const trust = async (employee: string, workType: string) => {
  const { reviews, decisions } = await getTrustInputs(db, "manager", employee, workType);
  return {
    reviews,
    decisions,
    dots: recentDots(reviews, DEMO_PARAMS.dots),
    level: reviewLevel(reviews, decisions),
    suggestion: relaxSuggestion(reviews, decisions, DEMO_PARAMS),
    resets: autoResets(reviews, decisions),
  };
};

describe("demo 開始時的信任狀態（#60）", () => {
  it("DEMO_PARAMS 是計畫計算時的值（dots 10、window 10、min 10）", () => {
    expect(DEMO_PARAMS).toMatchObject({ dots: 10, window: 10, min: 10 });
  });

  it("Rowan × 客戶回覆：逐項看；最近 10 次內有做錯了，發生在看重點期間，帳本有一筆改回逐項看；沒有建議", async () => {
    const t = await trust("rowan", "support");
    expect(t.reviews).toHaveLength(15);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax"]);
    expect(t.dots).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "wrong", "ok", "ok"]);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
    expect(t.resets.map((r) => r.review.id)).toEqual(["s12-1"]);
    // 做錯了在看重點的決定之後
    expect(Date.parse(t.resets[0].at)).toBeGreaterThan(Date.parse(t.decisions[0].decidedAt));
  });

  it("Sorrel × 貼文與商品介紹：逐項看；最近 10 次沒有做錯了、次數達門檻，有建議改看重點", async () => {
    const t = await trust("sorrel", "content");
    expect(t.reviews).toHaveLength(12);
    expect(t.decisions).toEqual([]);
    expect(t.dots).toEqual(["ok", "ok", "ok", "neutral", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(t.level).toBe("item");
    expect(t.suggestion?.basis.map((r) => r.id)).toEqual([
      "c02-1", "c03-1", "c04-1", "c05-1", "c05-2", "c06-1", "c07-1", "c08-1", "c09-1", "c10-1",
    ]);
    expect(t.resets).toEqual([]);
  });

  it("Linden × 知識庫整理：看重點（有一筆同意改看重點，之後沒有做錯了）", async () => {
    const t = await trust("linden", "knowledge");
    expect(t.reviews).toHaveLength(14);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax"]);
    expect(t.dots).toEqual(["ok", "ok", "ok", "neutral", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(t.level).toBe("light");
    expect(t.suggestion).toBeNull();
    expect(t.resets).toEqual([]);
    const after = t.reviews.filter((r) => Date.parse(r.decidedAt) > Date.parse(t.decisions[0].decidedAt));
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((r) => r.reason === "wrong")).toBe(false);
  });

  it("Juniper × 網站與工具開發：同意改看重點 → 看重點驗收一次 → 收回，逐項看；收回後要重新累積，沒有建議（#125）", async () => {
    const t = await trust("juniper", "dev");
    expect(t.reviews).toHaveLength(11);
    expect(t.decisions.map((d) => d.decision)).toEqual(["relax", "revoke"]);
    expect(t.dots).toEqual(["ok", "neutral", "ok", "ok", "ok", "ok", "neutral", "ok", "ok", "ok"]);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
    expect(t.resets).toEqual([]);
    // 同意之前已累積 DEMO_PARAMS.min 次、沒有做錯；同意與收回之間有一次驗收（以看重點進行）；收回之後沒有驗收
    const [relax, revoke] = t.decisions.map((d) => Date.parse(d.decidedAt));
    const before = t.reviews.filter((r) => Date.parse(r.decidedAt) < relax);
    expect(before.length).toBeGreaterThanOrEqual(DEMO_PARAMS.min);
    expect(before.some((r) => r.reason === "wrong")).toBe(false);
    expect(t.reviews.filter((r) => Date.parse(r.decidedAt) > relax && Date.parse(r.decidedAt) < revoke)).toHaveLength(1);
    expect(t.reviews.filter((r) => Date.parse(r.decidedAt) > revoke)).toEqual([]);
  });
});
