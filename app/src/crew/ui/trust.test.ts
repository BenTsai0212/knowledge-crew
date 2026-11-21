// 「員工」「信任」的資料整理（#37）：以匯入虛構資料後的資料庫，檢查三種身分的結果、同意少看與收回的寫入。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { createReview, getAssignmentWorks, getTrustInputs } from "../db/store";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import type { DemoFile } from "../demo/types";
import { crewStrings } from "../i18n";
import { relaxSuggestion } from "../trust/rules";
import { DEMO_PARAMS } from "../trust/demo-params";
import { workTypeLabel } from "./labels";
import { canReviewOf } from "./today";
import { agreeRelax, readTrust, revokeRelax, type Trust, type TrustRow } from "./trust";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;

const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
const read = (db: Database, identity: string | null, language = lang) =>
  readTrust(db, identity, language, canReviewOf(clientConfig.access, identity));
const pairs = (t: Trust) => t.rows.map((r) => [r.employee.id, r.workTypeId]);
const row = (t: Trust, employeeId: string, workTypeId: string): TrustRow => {
  const found = t.rows.find((r) => r.employee.id === employeeId && r.workTypeId === workTypeId);
  if (!found) throw new Error(`沒有 ${employeeId} × ${workTypeId}`);
  return found;
};
const count = (dots: string[], dot: string) => dots.filter((d) => d === dot).length;

let db: Database;
beforeAll(async () => {
  db = await open();
});
afterAll(() => db.close());

describe("readTrust：匯入虛構資料後", () => {
  it("manager：三個組合，依員工再依工作類型排序", async () => {
    const trust = await read(db, "manager");
    expect(trust.canReview).toBe(true);
    expect(pairs(trust)).toEqual([["basil", "docs"], ["basil", "test"], ["juniper", "ui"]]);
  });

  it("manager：Juniper × 介面是少看，最近 10 次有 1 個其他退回、沒有做錯了，沒有建議", async () => {
    const r = row(await read(db, "manager"), "juniper", "ui");
    expect(r.level).toBe("light");
    expect(r.dots).toHaveLength(DEMO_PARAMS.dots);
    expect(count(r.dots, "neutral")).toBe(1);
    expect(count(r.dots, "wrong")).toBe(0);
    expect(r.lastReset).toBeNull();
    expect(r.suggestion).toBeNull();
  });

  it("manager：Basil × 文件是逐項看且有建議，依據是最近 10 次、basisReviewId 是其中最新一筆", async () => {
    const r = row(await read(db, "manager"), "basil", "docs");
    expect(r.level).toBe("item");
    expect(r.reviewCount).toBeGreaterThanOrEqual(10);
    const { reviews, decisions } = await getTrustInputs(db, "manager", "basil", "docs");
    const basis = relaxSuggestion(reviews, decisions, DEMO_PARAMS)!.basis;
    expect(r.suggestion).toEqual({ count: 10, basisReviewId: basis.at(-1)!.id });
    expect(r.suggestion!.basisReviewId).toBe(reviews.at(-1)!.id);
  });

  it("manager：Basil × 測試是逐項看、沒有建議", async () => {
    const r = row(await read(db, "manager"), "basil", "test");
    expect(r.level).toBe("item");
    expect(r.suggestion).toBeNull();
    expect(r.dots.length).toBe(r.reviewCount);
  });

  it("staff：只看到青翼專案的組合（Juniper × 介面、Basil × 測試），沒有建議", async () => {
    const trust = await read(db, "staff");
    expect(trust.canReview).toBe(false);
    expect(pairs(trust)).toEqual([["basil", "test"], ["juniper", "ui"]]);
    expect(trust.rows.every((r) => r.suggestion === null)).toBe(true);
  });

  it("guest 與沒有身分：沒有組合，不拋錯", async () => {
    expect((await read(db, "guest")).rows).toEqual([]);
    expect(await read(db, null)).toEqual({ canReview: false, employees: [], rows: [] });
  });

  it("員工說明依目前語言；找不到時顯示資料庫的原文", async () => {
    const basil = demo.employees.find((e) => e.id === "basil")!;
    for (const language of [lang, other]) {
      expect(row(await read(db, "manager", language), "basil", "docs").employee).toEqual({
        id: "basil",
        displayName: "Basil",
        roleNote: basil.roleNote[language],
      });
    }
    expect(row(await read(db, "manager", "xx"), "basil", "docs").employee.roleNote).toBe(basil.roleNote[lang]);
  });
});

describe("同意少看與收回（每個測試用自己的資料庫）", () => {
  it("manager 同意少看：Basil × 文件變為少看、建議消失，basis_review_id 是依據中最新一筆", async () => {
    const own = await open();
    try {
      const before = row(await read(own, "manager"), "basil", "docs");
      await agreeRelax(own, "manager", { ...before, suggestion: before.suggestion! });
      const after = row(await read(own, "manager"), "basil", "docs");
      expect(after.level).toBe("light");
      expect(after.suggestion).toBeNull();
      const stored = await own.withIdentity("manager", async (tx) =>
        (await tx.query<{ basis: string }>(
          "SELECT basis_review_id AS basis FROM crew.level_decisions WHERE employee_id = 'basil' AND work_type_id = 'docs'",
        )).rows,
      );
      expect(stored).toEqual([{ basis: before.suggestion!.basisReviewId }]);
    } finally {
      await own.close();
    }
  });

  it("manager 收回：Juniper × 介面變回逐項看", async () => {
    const own = await open();
    try {
      await revokeRelax(own, "manager", row(await read(own, "manager"), "juniper", "ui"));
      const after = row(await read(own, "manager"), "juniper", "ui");
      expect(after.level).toBe("item");
      expect(after.lastReset).toBeNull();
    } finally {
      await own.close();
    }
  });

  it("staff 與 guest 不能寫入，讀回不變", async () => {
    const own = await open();
    try {
      const manager = await read(own, "manager");
      const docs = row(manager, "basil", "docs");
      const ui = row(manager, "juniper", "ui");
      for (const identity of ["staff", "guest"]) {
        await expect(agreeRelax(own, identity, { ...docs, suggestion: docs.suggestion! })).rejects.toThrow();
        await expect(revokeRelax(own, identity, ui)).rejects.toThrow();
      }
      expect(await read(own, "manager")).toEqual(manager);
    } finally {
      await own.close();
    }
  });

  it("少看期間做錯了：Juniper × 介面改回逐項看，lastReset 是該次驗收的時間", async () => {
    const own = await open();
    try {
      const work = (await getAssignmentWorks(own, "manager", "j13")).at(-1)!;
      expect(work.review).toBeNull();
      await createReview(own, "manager", { workId: work.id, verdict: "returned", reason: "wrong" });
      const after = row(await read(own, "manager"), "juniper", "ui");
      const { reviews } = await getTrustInputs(own, "manager", "juniper", "ui");
      expect(after.level).toBe("item");
      expect(after.dots.at(-1)).toBe("wrong");
      expect(after.lastReset).toBe(reviews.at(-1)!.decidedAt);
    } finally {
      await own.close();
    }
  });
});

describe("「信任」「員工」的文字", () => {
  it("組合的標題在英文名字與中文之間留半形空格", () => {
    expect(fill(crewStrings("trust", "zh-TW").rowTitle, { employee: "Basil", workType: workTypeLabel("docs", "zh-TW") })).toBe("Basil 的「文件」");
  });

  it("圓點的三種結果有不同的文字說明（不只靠顏色）", () => {
    for (const language of clientConfig.client.languages) {
      const t = crewStrings("trust", language);
      expect(new Set([t.dotOk, t.dotWrong, t.dotNeutral]).size).toBe(3);
    }
    expect(crewStrings("trust", "zh-TW").dotNeutral).toContain("不影響信任");
  });

  it("兩個畫面的「逐項看／少看」文字一致", () => {
    for (const language of clientConfig.client.languages) {
      const e = crewStrings("employees", language);
      const t = crewStrings("trust", language);
      expect([e.levelItem, e.levelLight]).toEqual([t.levelItem, t.levelLight]);
      expect(e.levelItem).not.toBe(e.levelLight);
    }
  });
});
