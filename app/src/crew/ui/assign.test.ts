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
import { assignStatus, readAssign, simulateAssignment, submitAssignment } from "./assign";
import { canReviewOf, readToday } from "./today";

const demo = DEMO_RAW as DemoFile;
const lang = clientConfig.client.defaultLanguage;
const other = clientConfig.client.languages.find((l) => l !== lang)!;
const canReview = (identity: string | null) => canReviewOf(clientConfig.access, identity);
const read = (identity: string | null, language = lang) => readAssign(db, identity, language, canReview(identity), demo);
const count = async () => (await listAssignments(db, "manager")).length;
const item = async (id: string) => (await read("manager")).assignments.find((a) => a.id === id)!;

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

describe("readAssign：匯入虛構資料後（寫入之前）", () => {
  it("manager：repo 2、員工 2、工作類型 3；交辦 26 件新到舊，b11、j13 待驗收，其餘已通過，沒有可模擬的", async () => {
    const data = await read("manager");
    expect(data.canReview).toBe(true);
    expect(data.sources.map((r) => r.id).sort()).toEqual(["harbor-docs", "lantern-notes"]);
    expect(data.employees.map((e) => e.id)).toEqual(["basil", "juniper"]);
    expect(data.workTypes).toEqual(["docs", "test", "ui"]);
    expect(data.assignments).toHaveLength(26);
    expect(data.assignments.map((a) => a.id)).toEqual((await listAssignments(db, "manager")).map((a) => a.id));
    const awaiting = data.assignments.filter((a) => a.status === "awaitingReview").map((a) => a.id).sort();
    expect(awaiting).toEqual(["b11", "j13"]);
    expect(data.assignments.filter((a) => a.status !== "awaitingReview").every((a) => a.status === "accepted")).toBe(true);
    expect(data.assignments.every((a) => a.simulate === "none")).toBe(true);
  });

  it("staff：只有青翼專案（lantern-notes）的 15 件，不能驗收、沒有可模擬的", async () => {
    const data = await read("staff");
    expect(data.canReview).toBe(false);
    expect(data.sources.map((r) => r.id)).toEqual(["lantern-notes"]);
    expect(data.assignments).toHaveLength(15);
    expect(data.assignments.every((a) => a.sourceName === "example-org/lantern-notes")).toBe(true);
    expect(data.assignments.map((a) => a.id).sort()).toEqual(
      ["j01", "j02", "j03", "j04", "j05", "j06", "j07", "j08", "j09", "j10", "j11", "j12", "j13", "t01", "t02"],
    );
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

  it("交辦標題與員工說明依目前語言顯示", async () => {
    const j13 = demo.assignments.find((a) => a.id === "j13")!;
    const juniper = demo.employees.find((e) => e.id === "juniper")!;
    for (const language of [lang, other]) {
      const data = await read("staff", language);
      const found = data.assignments.find((a) => a.id === "j13")!;
      expect(found.title).toBe(j13.title[language]);
      expect(found.employee).toEqual({ id: "juniper", displayName: "Juniper", roleNote: juniper.roleNote[language] });
      expect(data.employees.find((e) => e.id === "juniper")!.roleNote).toBe(juniper.roleNote[language]);
    }
  });
});

describe("Basil × 文件的預先回覆", () => {
  it("第 1 輪與退回後的下一輪是不同的兩則，中英文齊全", () => {
    const first = pickReply(demo, "basil", "docs", 1)!;
    const second = pickReply(demo, "basil", "docs", 2)!;
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
  it("交辦給 Juniper（介面）→ 模擬交件 → 待驗收、「今天」多一筆 → 退回 → 再模擬用第 2 則回覆", async () => {
    const awaitingBefore = (await readToday(db, "manager", lang, true)).awaitingReview.length;
    const a = await submitAssignment(db, "manager", { sourceId: "lantern-notes", title: "新增標籤篩選", workTypeId: "ui", employeeId: "juniper" });
    expect(a.externalRef).toBe("116");

    const data = await read("manager");
    expect(data.assignments[0]).toMatchObject({
      id: a.id, title: "新增標籤篩選", sourceName: "example-org/lantern-notes", externalRef: "116",
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
    expect(works[1].summary).toBe(pickReply(demo, "juniper", "ui", 2)!.summary[lang]);
    expect(await item(a.id)).toMatchObject({ status: "awaitingReview", latestRound: 2 });
  });

  it("交辦給 Basil（文件、harbor-docs）→ 模擬交件 → 待驗收，摘要是第 1 輪的預先回覆", async () => {
    const a = await submitAssignment(db, "manager", { sourceId: "harbor-docs", title: "Backup guide", workTypeId: "docs", employeeId: "basil" });
    expect(a.externalRef).toBe("52");
    expect((await item(a.id)).simulate).toBe("available");
    await simulateAssignment(db, "manager", a.id, demo, lang);
    expect(await item(a.id)).toMatchObject({ status: "awaitingReview", latestRound: 1 });
    const [w] = await getAssignmentWorks(db, "manager", a.id);
    expect(w.summary).toBe(pickReply(demo, "basil", "docs", 1)!.summary[lang]);
  });

  it("沒有預先回覆的組合（Basil × 測試）：simulate 為 noReply，讀取不拋錯", async () => {
    const a = await submitAssignment(db, "manager", { sourceId: "lantern-notes", title: "Add tests", workTypeId: "test", employeeId: "basil" });
    expect(await item(a.id)).toMatchObject({ status: "notSubmitted", simulate: "noReply" });
    expect((await readAssign(db, "manager", lang, true, null)).assignments.find((x) => x.id === a.id)!.simulate).toBe("noReply");
  });

  it("空白標題拋錯且不寫入；標題前後的空白會去掉", async () => {
    const before = await count();
    await expect(submitAssignment(db, "manager", { sourceId: "lantern-notes", title: "  \n ", workTypeId: "ui", employeeId: "juniper" })).rejects.toThrow(/title/);
    expect(await count()).toBe(before);
    const a = await submitAssignment(db, "manager", { sourceId: "lantern-notes", title: "  Trim me  ", workTypeId: "ui", employeeId: "juniper" });
    expect((await item(a.id)).title).toBe("Trim me");
  });
});

describe("staff、guest 不能寫入", () => {
  it("交辦與模擬交件都被拒，manager 讀回的件數與輪次不變", async () => {
    const target = await submitAssignment(db, "manager", { sourceId: "lantern-notes", title: "Pending", workTypeId: "ui", employeeId: "juniper" });
    const before = await count();
    for (const identity of ["staff", "guest"]) {
      await expect(submitAssignment(db, identity, { sourceId: "lantern-notes", title: "x", workTypeId: "ui", employeeId: "juniper" })).rejects.toThrow();
      await expect(simulateAssignment(db, identity, target.id, demo, lang)).rejects.toThrow();
    }
    expect(await count()).toBe(before);
    expect(await getAssignmentWorks(db, "manager", target.id)).toEqual([]);
    expect((await item(target.id)).status).toBe("notSubmitted");
  });
});
