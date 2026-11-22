// 「交辦」的資料整理（#38 計畫第 7 節）：以匯入虛構資料後的資料庫，檢查三種身分看到的清單、交辦與模擬交件的寫入。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { createReview, getAssignmentWorks, listAssignments } from "../db/store";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { pickReply } from "../demo/simulate";
import type { DemoFile } from "../demo/types";
import { assignStatus, initialChoice, readAssign, RECENT_COUNT, resultKey, simulateAssignment, submitAssignment, usualOf, visibleAssignments } from "./assign";
import { canReviewOf, readToday } from "./today";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;
const canReview = (identity: string | null) => canReviewOf(clientConfig.access, identity);
const read = (identity: string | null, language = lang) => readAssign(db, identity, language, canReview(identity), demo);
const count = async () => (await listAssignments(db, "manager")).length;
const item = async (id: string) => (await read("manager")).assignments.find((a) => a.id === id)!;

// 來源的顯示名稱（#60 的 `## 決定` 2）
const label = (id: string, language = lang) => {
  const s = demo.sources.find((x) => x.id === id)!;
  return s.label?.[language] ?? s.name;
};

let db: Database;
beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
});
afterAll(() => db.close());

describe("assignStatus", () => {
  it("還沒交件／待驗收／退回後等下一輪／已通過", () => {
    expect(assignStatus({ latestRound: null, latestVerdict: null })).toBe("notSubmitted");
    expect(assignStatus({ latestRound: 1, latestVerdict: null })).toBe("awaitingReview");
    expect(assignStatus({ latestRound: 1, latestVerdict: "returned" })).toBe("returned");
    expect(assignStatus({ latestRound: 2, latestVerdict: "accepted" })).toBe("accepted");
  });
});

describe("usualOf：員工平常的來源與工作類型（#76）", () => {
  const a = (employeeId: string, sourceId: string, workTypeId = "support") => ({ employeeId, sourceId, workTypeId });
  it("取該員工交辦紀錄中最常用的；其他員工的不算", () => {
    const list = [a("rowan", "x"), a("rowan", "y"), a("rowan", "y"), a("sorrel", "x"), a("sorrel", "x"), a("sorrel", "x")];
    expect(usualOf(list, "rowan")).toEqual({ sourceId: "y", workTypeId: "support" });
    expect(usualOf(list, "sorrel")).toEqual({ sourceId: "x", workTypeId: "support" });
  });
  it("次數相同時取較新的（清單是新到舊）", () => {
    expect(usualOf([a("rowan", "new", "content"), a("rowan", "old", "support")], "rowan")).toEqual({ sourceId: "new", workTypeId: "content" });
  });
  it("沒有交辦紀錄時都是 null", () => {
    expect(usualOf([a("rowan", "x")], "juniper")).toEqual({ sourceId: null, workTypeId: null });
    expect(usualOf([], "rowan")).toEqual({ sourceId: null, workTypeId: null });
  });
});

describe("initialChoice：交辦頁預選的員工（#83）", () => {
  const source = (id: string) => ({ id, label: id }) as never;
  const employee = (id: string, usualSourceId: string | null, workTypeId: string | null = "support") =>
    ({ id, displayName: id, roleNote: null, usualSourceId, workTypeId, level: "item" }) as const;
  const data = { sources: [source("a"), source("b")], employees: [employee("rowan", "b"), employee("sorrel", null), employee("linden", "b", null)] };

  it("預選的員工選上並帶入平常的來源；沒有平常的來源時用第一個來源", () => {
    expect(initialChoice(data, "rowan")).toEqual({ employeeId: "rowan", sourceId: "b" });
    expect(initialChoice(data, "sorrel")).toEqual({ employeeId: "sorrel", sourceId: "a" });
  });

  it("沒有預選、看不到或沒有工作類型時不選員工", () => {
    expect(initialChoice(data, undefined)).toEqual({ employeeId: "", sourceId: "a" });
    expect(initialChoice(data, "nobody")).toEqual({ employeeId: "", sourceId: "a" });
    expect(initialChoice(data, "linden")).toEqual({ employeeId: "", sourceId: "a" });
    expect(initialChoice({ sources: [], employees: [] }, "rowan")).toEqual({ employeeId: "", sourceId: "" });
  });
});

describe("resultKey 與 visibleAssignments（#76）", () => {
  it("交件的稱呼依工作類型；不認得的工作類型用 resultOther", () => {
    expect(["support", "content", "knowledge", "dev", "other"].map(resultKey)).toEqual([
      "resultReply",
      "resultPost",
      "resultKb",
      "resultCode",
      "resultOther",
    ]);
  });
  it("交辦清單預設最近 4 件，showAll 時全部", () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    expect(RECENT_COUNT).toBe(4);
    expect(visibleAssignments(items, false)).toEqual([0, 1, 2, 3]);
    expect(visibleAssignments(items, true)).toEqual(items);
    expect(visibleAssignments([0, 1], false)).toEqual([0, 1]);
  });
});

describe("readAssign：匯入虛構資料後（寫入之前）", () => {
  it("manager：每位員工依交辦紀錄帶入平常的來源、工作類型與目前層級", async () => {
    const data = await read("manager");
    const brief = data.employees.map(({ id, usualSourceId, workTypeId, level }) => ({ id, usualSourceId, workTypeId, level }));
    expect(brief).toEqual([
      { id: "juniper", usualSourceId: "company-site", workTypeId: "dev", level: "item" },
      { id: "linden", usualSourceId: "company-kb", workTypeId: "knowledge", level: "light" },
      { id: "rowan", usualSourceId: "support-inbox", workTypeId: "support", level: "item" },
      { id: "sorrel", usualSourceId: "social-account", workTypeId: "content", level: "item" },
    ]);
    expect(data.assignments.every((a) => !Number.isNaN(Date.parse(a.assignedAt)))).toBe(true);
  });

  it("staff：看不到交辦紀錄的員工沒有平常的來源與工作類型", async () => {
    const data = await read("staff");
    const linden = data.employees.find((e) => e.id === "linden")!;
    expect(linden).toMatchObject({ usualSourceId: null, workTypeId: null, level: "item" });
    expect(data.employees.find((e) => e.id === "rowan")).toMatchObject({ usualSourceId: "support-inbox", workTypeId: "support" });
  });

  it("manager：來源 4、員工 4、工作類型 4；交辦 44 件新到舊，s14、c11、k13、j06 待驗收，其餘已通過，沒有可模擬的", async () => {
    const data = await read("manager");
    expect(data.canReview).toBe(true);
    expect(data.sources.map((r) => r.id).sort()).toEqual(["company-kb", "company-site", "social-account", "support-inbox"]);
    expect(data.employees.map((e) => e.id)).toEqual(["juniper", "linden", "rowan", "sorrel"]);
    expect(data.workTypes).toEqual(["content", "dev", "knowledge", "support"]);
    expect(data.assignments).toHaveLength(44);
    expect(data.assignments.map((a) => a.id)).toEqual((await listAssignments(db, "manager")).map((a) => a.id));
    const awaiting = data.assignments.filter((a) => a.status === "awaitingReview").map((a) => a.id).sort();
    expect(awaiting).toEqual(["c11", "j06", "k13", "s14"]);
    expect(data.assignments.filter((a) => a.status !== "awaitingReview").every((a) => a.status === "accepted")).toBe(true);
    expect(data.assignments.every((a) => a.simulate === "none")).toBe(true);
  });

  it("staff：只有青翼專案（客服信箱、官方社群帳號）的 25 件，不能驗收、沒有可模擬的", async () => {
    const data = await read("staff");
    expect(data.canReview).toBe(false);
    expect(data.sources.map((r) => r.id)).toEqual(["social-account", "support-inbox"]);
    expect(data.assignments).toHaveLength(25);
    expect(data.assignments.every((a) => [label("support-inbox"), label("social-account")].includes(a.sourceName))).toBe(true);
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
    expect(data.assignments.map((a) => a.id).sort()).toEqual([...ids("c", 11), ...ids("s", 14)]);
    expect(data.assignments.every((a) => a.simulate === "none")).toBe(true);
  });

  it("guest 與沒有身分：全部為空，不拋錯", async () => {
    for (const identity of ["guest", null]) {
      const data = await read(identity);
      expect(data.canReview).toBe(false);
      expect(data.sources).toEqual([]);
      expect(data.assignments).toEqual([]);
    }
    expect((await read(null)).employees).toEqual([]);
  });

  it("交辦標題、員工說明與來源名稱依目前語言顯示", async () => {
    const s14 = demo.assignments.find((a) => a.id === "s14")!;
    const rowan = demo.employees.find((e) => e.id === "rowan")!;
    for (const language of [lang, other]) {
      const data = await read("staff", language);
      const found = data.assignments.find((a) => a.id === "s14")!;
      expect(found.title).toBe(s14.title[language]);
      expect(found.sourceName).toBe(label("support-inbox", language));
      expect(found.employee).toEqual({ id: "rowan", displayName: "Rowan", roleNote: rowan.roleNote[language] });
      expect(data.employees.find((e) => e.id === "rowan")!.roleNote).toBe(rowan.roleNote[language]);
      // 表單的來源選項：有 label 時用目前語言，repo 類照舊是 name
      expect(data.sources.map((r) => [r.id, r.label])).toEqual([
        ["social-account", label("social-account", language)],
        ["support-inbox", label("support-inbox", language)],
      ]);
    }
    expect((await read("manager", other)).sources.find((r) => r.id === "company-site")!.label).toBe("example-org/company-site");
  });
});

describe("四位員工的預先回覆", () => {
  it.each([["rowan", "support"], ["sorrel", "content"], ["linden", "knowledge"], ["juniper", "dev"]])("%s × %s：第 1 輪與退回後的下一輪是不同的兩則，中英文齊全", (employee, workType) => {
    const first = pickReply(demo, employee, workType, 1)!;
    const second = pickReply(demo, employee, workType, 2)!;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    for (const reply of [first, second]) {
      for (const language of clientConfig.client.languages) {
        expect(reply.summary[language]).toBeTruthy();
        expect(reply.body[language]).toBeTruthy();
        reply.points.forEach((p) => expect(p[language]).toBeTruthy());
        reply.changes.forEach((c) => expect(c.summary[language]).toBeTruthy());
      }
    }
  });
});

describe("交辦與模擬交件的寫入（manager）", () => {
  it("交辦給 Juniper（網站與工具開發）→ 模擬交件 → 待驗收、「今天」多一筆 → 退回 → 再模擬用第 2 則回覆", async () => {
    const awaitingBefore = (await readToday(db, "manager", lang, true)).awaitingReview.length;
    const a = await submitAssignment(db, "manager", { sourceId: "company-site", title: "新增標籤篩選", workTypeId: "dev", employeeId: "juniper" });
    expect(a.externalRef).toBe("27");

    const data = await read("manager");
    expect(data.assignments[0]).toMatchObject({
      id: a.id, title: "新增標籤篩選", sourceName: "example-org/company-site", externalRef: "27",
      status: "notSubmitted", latestRound: null, simulate: "available",
    });

    await simulateAssignment(db, "manager", a.id, demo, lang);
    expect(await item(a.id)).toMatchObject({ status: "awaitingReview", latestRound: 1, simulate: "none" });
    expect((await readToday(db, "manager", lang, true)).awaitingReview).toHaveLength(awaitingBefore + 1);

    const [w1] = await getAssignmentWorks(db, "manager", a.id);
    await createReview(db, "manager", { workId: w1.id, verdict: "returned", reason: "different_approach" });
    expect(await item(a.id)).toMatchObject({ status: "returned", simulate: "available" });

    await simulateAssignment(db, "manager", a.id, demo, lang);
    const works = await getAssignmentWorks(db, "manager", a.id);
    expect(works[1].summary).toBe(pickReply(demo, "juniper", "dev", 2)!.summary[lang]);
    expect(await item(a.id)).toMatchObject({ status: "awaitingReview", latestRound: 2 });
  });

  it("交辦給 Sorrel（貼文與商品介紹、官方社群帳號）→ 模擬交件 → 待驗收，摘要是第 1 輪的預先回覆", async () => {
    const a = await submitAssignment(db, "manager", { sourceId: "social-account", title: "Winter post", workTypeId: "content", employeeId: "sorrel" });
    expect(a.externalRef).toBeNull();
    expect((await item(a.id)).simulate).toBe("available");
    await simulateAssignment(db, "manager", a.id, demo, lang);
    expect(await item(a.id)).toMatchObject({ status: "awaitingReview", latestRound: 1 });
    const [w] = await getAssignmentWorks(db, "manager", a.id);
    expect(w.summary).toBe(pickReply(demo, "sorrel", "content", 1)!.summary[lang]);
  });

  it("沒有預先回覆的組合（Rowan × 貼文與商品介紹）：simulate 為 noReply，讀取不拋錯", async () => {
    const a = await submitAssignment(db, "manager", { sourceId: "social-account", title: "Add tests", workTypeId: "content", employeeId: "rowan" });
    expect(await item(a.id)).toMatchObject({ status: "notSubmitted", simulate: "noReply" });
    expect((await readAssign(db, "manager", lang, true, null)).assignments.find((x) => x.id === a.id)!.simulate).toBe("noReply");
  });

  it("空白標題拋錯且不寫入；標題前後的空白會去掉", async () => {
    const before = await count();
    await expect(submitAssignment(db, "manager", { sourceId: "company-site", title: "  \n ", workTypeId: "dev", employeeId: "juniper" })).rejects.toThrow(/title/);
    expect(await count()).toBe(before);
    const a = await submitAssignment(db, "manager", { sourceId: "company-site", title: "  Trim me  ", workTypeId: "dev", employeeId: "juniper" });
    expect((await item(a.id)).title).toBe("Trim me");
  });
});

describe("staff、guest 不能寫入", () => {
  it("交辦與模擬交件都被拒，manager 讀回的件數與輪次不變", async () => {
    const target = await submitAssignment(db, "manager", { sourceId: "support-inbox", title: "Pending", workTypeId: "support", employeeId: "rowan" });
    const before = await count();
    for (const identity of ["staff", "guest"]) {
      await expect(submitAssignment(db, identity, { sourceId: "support-inbox", title: "x", workTypeId: "support", employeeId: "rowan" })).rejects.toThrow();
      await expect(simulateAssignment(db, identity, target.id, demo, lang)).rejects.toThrow();
    }
    expect(await count()).toBe(before);
    expect(await getAssignmentWorks(db, "manager", target.id)).toEqual([]);
    expect((await item(target.id)).status).toBe("notSubmitted");
  });
});
