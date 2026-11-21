// store.ts 的讀寫（#29 計畫第 1、5 節）：匯入 demo.json 後經 withIdentity() 讀寫，RLS 照常套用。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { DEMO_PARAMS } from "../trust/demo-params";
import { autoResets, recentDots, relaxSuggestion, reviewLevel } from "../trust/rules";
import { crewMigrations } from "./migrate";
import {
  createAssignment,
  createLevelDecision,
  createReview,
  createWork,
  getAssignmentWorks,
  getTrustInputs,
  listAssignments,
  listEmployees,
  listSources,
  listReviews,
  nextExternalRef,
  type NewWork,
} from "./store";

const open = () => openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });

const trust = async (db: Database, identity: string, employee: string, workType: string) => {
  const { reviews, decisions } = await getTrustInputs(db, identity, employee, workType);
  return {
    level: reviewLevel(reviews, decisions),
    suggestion: relaxSuggestion(reviews, decisions, DEMO_PARAMS),
    resets: autoResets(reviews, decisions),
    dots: recentDots(reviews, DEMO_PARAMS.dots),
    reviews,
  };
};

describe("讀取（匯入 demo.json 後）", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("repo 與員工依 RLS：staff 只看到 lantern-notes，guest 看不到", async () => {
    expect((await listSources(db, "manager")).map((r) => r.name)).toEqual(["example-org/harbor-docs", "example-org/lantern-notes"]);
    expect(await listSources(db, "staff")).toEqual([{ id: "lantern-notes", kind: "repo", name: "example-org/lantern-notes", projectId: "bluewing" }]);
    expect(await listSources(db, "guest")).toEqual([]);
    expect((await listEmployees(db, "staff")).map((e) => e.id)).toEqual(["basil", "juniper"]);
    expect(await listEmployees(db, null)).toEqual([]);
  });

  it("listAssignments：新到舊，含最新輪次與結果；等待驗收的 latestVerdict 為 null", async () => {
    const list = await listAssignments(db, "manager");
    expect(list).toHaveLength(26);
    const times = list.map((a) => Date.parse(a.assignedAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));
    expect(byId.j01).toMatchObject({ sourceName: "example-org/lantern-notes", externalRef: "101", latestRound: 2, latestVerdict: "accepted", assignedBy: "manager" });
    expect(byId.j01.assignedAt).toBe(new Date("2026-09-01T09:00:00+08:00").toISOString());
    for (const id of ["j13", "b11"]) expect(byId[id]).toMatchObject({ latestRound: 1, latestVerdict: null });
    expect((await listAssignments(db, "staff")).length).toBe(15);
    expect(await listAssignments(db, "guest")).toEqual([]);
  });

  it("getAssignmentWorks：重點、變更、檢查（同名多筆時取最新）與驗收", async () => {
    const works = await getAssignmentWorks(db, "manager", "j01");
    expect(works.map((w) => w.round)).toEqual([1, 2]);
    const [first, second] = works;
    expect(first).toMatchObject({ id: "j01-w1", externalRef: "201", checks: [{ name: "ci", status: "pass" }] });
    expect(first.points.length).toBeGreaterThan(0);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(first.review).toMatchObject({ id: "j01-1", workId: "j01-w1", verdict: "returned", reason: "wrong", decidedBy: "manager" });
    expect(second.review).toMatchObject({ id: "j01-2", verdict: "accepted", reason: null });
    expect((await getAssignmentWorks(db, "manager", "j13"))[0].review).toBeNull();
    expect(await getAssignmentWorks(db, "staff", "b01")).toEqual([]);
  });

  it("listReviews：依時間排序，可只取某交辦", async () => {
    const all = await listReviews(db, "manager");
    expect(all).toHaveLength(28);
    const times = all.map((r) => Date.parse(r.decidedAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect((await listReviews(db, "manager", { assignmentId: "j07" })).map((r) => [r.id, r.reason])).toEqual([
      ["j07-1", "different_approach"],
      ["j07-2", null],
    ]);
    expect(await listReviews(db, "staff", { assignmentId: "b05" })).toEqual([]);
  });

  it("Juniper × ui：light、沒有自動改回、最近 10 次有 1 個 neutral 沒有 wrong（manager 與 staff 相同）", async () => {
    for (const identity of ["manager", "staff"]) {
      const t = await trust(db, identity, "juniper", "ui");
      expect(t.reviews).toHaveLength(14);
      expect(t.level).toBe("light");
      expect(t.resets).toEqual([]);
      expect(t.dots).toHaveLength(10);
      expect(t.dots.filter((d) => d === "neutral")).toHaveLength(1);
      expect(t.dots).not.toContain("wrong");
    }
  });

  it("Basil × docs：item，有建議少看，依據是最近 10 次（不含 b01）", async () => {
    const t = await trust(db, "manager", "basil", "docs");
    expect(t.reviews).toHaveLength(12);
    expect(t.level).toBe("item");
    expect(t.suggestion).not.toBeNull();
    expect(t.suggestion!.basis.map((r) => r.id)).toEqual(t.reviews.slice(-10).map((r) => r.id));
    expect(t.suggestion!.basis.map((r) => r.id)).not.toContain("b01-1");
    expect(t.suggestion!.basis.map((r) => r.id)).not.toContain("b01-2");
  });

  it("Basil × test：item，驗收不足 min 次沒有建議", async () => {
    const t = await trust(db, "manager", "basil", "test");
    expect(t.reviews).toHaveLength(2);
    expect(t.level).toBe("item");
    expect(t.suggestion).toBeNull();
  });

  it("guest 與沒有身分讀不到信任的輸入", async () => {
    for (const identity of ["guest", null]) {
      expect(await getTrustInputs(db, identity, "juniper", "ui")).toEqual({ reviews: [], decisions: [] });
    }
  });
});

const WORK: Omit<NewWork, "assignmentId"> = {
  externalRef: "999",
  summary: "Draft",
  body: "Body",
  points: ["Layout", "Colors"],
  changes: [{ path: "src/a.tsx", summary: "Changed" }],
  checks: [{ name: "ci", status: "pending" }, { name: "lint", status: "fail" }, { name: "ci", status: "pass" }],
};

describe("寫入", () => {
  let db: Database;
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it("manager：交辦、交件、驗收、少看的決定，寫入後讀回一致；身分與時間由資料庫填入", async () => {
    const before = Date.now();
    const a = await createAssignment(db, "manager", { sourceId: "lantern-notes", title: "New card", workTypeId: "ui", employeeId: "juniper" });
    expect(a.externalRef).toBe("116");
    const summary = (await listAssignments(db, "manager")).find((x) => x.id === a.id)!;
    expect(summary).toMatchObject({ title: "New card", assignedBy: "manager", latestRound: null, latestVerdict: null });
    expect(Date.parse(summary.assignedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect((await listAssignments(db, "manager"))[0].id).toBe(a.id);

    const w1 = await createWork(db, "manager", { ...WORK, assignmentId: a.id });
    expect(w1.round).toBe(1);
    const r1 = await createReview(db, "manager", { workId: w1.id, verdict: "returned", reason: "process", note: "Split it" });
    const w2 = await createWork(db, "manager", { ...WORK, externalRef: "1000", assignmentId: a.id });
    expect(w2.round).toBe(2);

    const works = await getAssignmentWorks(db, "manager", a.id);
    expect(works).toHaveLength(2);
    expect(works[0]).toMatchObject({
      id: w1.id, externalRef: "999", summary: "Draft", body: "Body", points: ["Layout", "Colors"], changes: WORK.changes,
      checks: [{ name: "ci", status: "pass" }, { name: "lint", status: "fail" }],
      review: { id: r1.id, verdict: "returned", reason: "process", note: "Split it", decidedBy: "manager" },
    });
    expect(works[1].review).toBeNull();
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({ latestRound: 2, latestVerdict: null });

    const d = await createLevelDecision(db, "manager", { employeeId: "juniper", workTypeId: "ui", decision: "revoke", basisReviewId: r1.id });
    expect(d.id).toBeTruthy();
    const t = await trust(db, "manager", "juniper", "ui");
    expect(t.level).toBe("item");
    expect(t.reviews.at(-1)).toMatchObject({ id: r1.id, verdict: "returned", reason: "process" });
  });

  it.each([["staff"], ["guest"], [null]])("%s：寫入被拒，沒有留下資料", async (identity) => {
    const before = await listAssignments(db, "manager");
    const reviews = await listReviews(db, "manager");
    const decisions = (await getTrustInputs(db, "manager", "juniper", "ui")).decisions;
    await expect(createAssignment(db, identity, { sourceId: "lantern-notes", title: "X", workTypeId: "ui", employeeId: "juniper" })).rejects.toThrow();
    await expect(createWork(db, identity, { ...WORK, assignmentId: "j13" })).rejects.toThrow();
    await expect(createReview(db, identity, { workId: "j13-w1", verdict: "accepted" })).rejects.toThrow();
    await expect(createLevelDecision(db, identity, { employeeId: "juniper", workTypeId: "ui", decision: "revoke" })).rejects.toThrow();
    expect(await listAssignments(db, "manager")).toEqual(before);
    expect(await listReviews(db, "manager")).toEqual(reviews);
    expect((await getTrustInputs(db, "manager", "juniper", "ui")).decisions).toEqual(decisions);
    expect(await getAssignmentWorks(db, "manager", "j13")).toHaveLength(1);
  });
});

describe("外部編號（#57）", () => {
  let db: Database;
  beforeAll(async () => {
    // demo.json 只有 repo 類；另加一個青翼專案的信箱（虛構）
    const seed = demoSeed(DEMO_RAW, clientConfig);
    db = await openDatabase(clientConfig, {
      migrations: crewMigrations,
      seed: async (pg) => {
        await seed(pg);
        await pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('inbox', 'mailbox', 'Support inbox', 'bluewing')");
      },
    });
  });
  afterAll(() => db.close());

  it("來源有類型、依名稱排序；看得到的範圍照舊由專案決定", async () => {
    expect((await listSources(db, "manager")).map((s) => [s.id, s.kind])).toEqual([
      ["inbox", "mailbox"], ["harbor-docs", "repo"], ["lantern-notes", "repo"],
    ]);
    expect((await listSources(db, "staff")).map((s) => s.id)).toEqual(["inbox", "lantern-notes"]);
    expect(await listSources(db, "guest")).toEqual([]);
  });

  it("repo 類：交辦產生下一個 Issue 編號、交件產生下一個 PR 編號", async () => {
    expect(await nextExternalRef(db, "manager", "lantern-notes")).toBe("218");
    expect(await nextExternalRef(db, "manager", "harbor-docs")).toBe("74");
    // 看不到的來源沒有編號
    expect(await nextExternalRef(db, "staff", "harbor-docs")).toBeNull();
  });

  it("repo 以外的類型：交辦與交件的外部編號是 null，讀回也是 null", async () => {
    const a = await createAssignment(db, "manager", { sourceId: "inbox", title: "Reply", workTypeId: "docs", employeeId: "basil" });
    expect(a.externalRef).toBeNull();
    const externalRef = await nextExternalRef(db, "manager", "inbox");
    expect(externalRef).toBeNull();
    await createWork(db, "manager", { ...WORK, externalRef, assignmentId: a.id });
    expect((await listAssignments(db, "manager")).find((x) => x.id === a.id)).toMatchObject({
      sourceKind: "mailbox", sourceName: "Support inbox", externalRef: null, latestRound: 1,
    });
    expect((await getAssignmentWorks(db, "manager", a.id))[0].externalRef).toBeNull();
    // 第二筆同樣沒有編號（NULL 不互相衝突）
    expect((await createAssignment(db, "manager", { sourceId: "inbox", title: "Reply 2", workTypeId: "docs", employeeId: "basil" })).externalRef).toBeNull();
  });
});
