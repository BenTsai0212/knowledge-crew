// 「最近的變化」（#182）：純函式從帳本事件挑出的種類、順序、則數與點了到哪裡，以及匯入虛構資料後的結果。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "../demo/load";
import { demoSeed } from "../demo/seed";
import { readLedger, type LedgerEvent, type LedgerKind } from "./ledger";
import { readRecentChanges, readSpotReviewIds, recentChanges, RECENT_CHANGES_LIMIT, reviewIdOf } from "./recent-changes";

const lang = clientConfig.client.defaultLanguage;

const event = (id: string, kind: LedgerKind, at: string, extra: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id,
  kind,
  at,
  employee: { id: "basil", displayName: "Basil" },
  workTypeId: "docs",
  assignment: { id: "a1", title: "A1", sourceKind: "repo", sourceName: "example-org/r", externalRef: "1" },
  actor: null,
  round: null,
  reason: null,
  ...extra,
});

const T = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("reviewIdOf", () => {
  it("驗收事件的 id 是 <kind>:<驗收 id>；其他事件沒有", () => {
    expect(reviewIdOf({ id: "accepted:rv1", kind: "accepted" })).toBe("rv1");
    expect(reviewIdOf({ id: "returned:s12-1", kind: "returned" })).toBe("s12-1");
    expect(reviewIdOf({ id: "relax:d1", kind: "relax" })).toBeNull();
  });
});

describe("recentChanges", () => {
  it("只挑審查方式改變、退回、抽查的結果與等你確認的守則；其他事件不列", () => {
    const events = [
      event("assigned:a1", "assigned", T(20)),
      event("submitted:w1", "submitted", T(19)),
      event("accepted:rv9", "accepted", T(18)),
      event("proposed:rv9", "proposed", T(17)),
      event("corrected:c1", "corrected", T(16)),
      event("relax:d1", "relax", T(15)),
      event("returned:rv1", "returned", T(14), { reason: "process" }),
    ];
    expect(recentChanges(events, new Set()).map((c) => [c.id, c.kind])).toEqual([
      ["relax:d1", "level"],
      ["returned:rv1", "returned"],
    ]);
  });

  it("同意、收回、自動改回（含事後更正觸發的）都是審查方式改變，點了到員工", () => {
    const events = [
      event("relax:d1", "relax", T(4)),
      event("revoke:d2", "revoke", T(3)),
      event("autoReset:rv2", "autoReset", T(2), { byCorrection: true }),
      event("autoReset:rv1", "autoReset", T(1)),
    ];
    const changes = recentChanges(events, new Set());
    expect(changes.map((c) => c.kind)).toEqual(["level", "level", "level", "level"]);
    for (const c of changes) expect(c.target).toEqual({ section: "employees", employeeId: "basil" });
  });

  it("被抽查的驗收是抽查的結果（通過與退回都列），不再另列為退回；點了到那件工作", () => {
    const events = [
      event("accepted:rv3", "accepted", T(3)),
      event("returned:rv2", "returned", T(2), { reason: "wrong" }),
      event("returned:rv1", "returned", T(1), { reason: "process" }),
    ];
    const changes = recentChanges(events, new Set(["rv3", "rv2"]));
    expect(changes.map((c) => [c.id, c.kind])).toEqual([
      ["accepted:rv3", "spot"],
      ["returned:rv2", "spot"],
      ["returned:rv1", "returned"],
    ]);
    for (const c of changes) expect(c.target).toEqual({ section: "works", assignmentId: "a1" });
  });

  it("員工提出的守則：還沒有決定時列為等你確認，有確認、修改後確認、不採用或收回時不列；人記成的守則不列", () => {
    const g = (id: string) => ({ guideline: { id, text: id } });
    const events = [
      event("guidelineConfirmed:g2-d", "guidelineConfirmed", T(9), g("g2")),
      event("guidelineRejected:g3-d", "guidelineRejected", T(8), g("g3")),
      event("guidelineProposed:g1", "guidelineProposed", T(7), g("g1")),
      event("guidelineProposed:g2", "guidelineProposed", T(6), g("g2")),
      event("guidelineProposed:g3", "guidelineProposed", T(5), g("g3")),
      event("guidelineSaved:g4", "guidelineSaved", T(4), g("g4")),
    ];
    const changes = recentChanges(events, new Set());
    expect(changes.map((c) => [c.id, c.kind])).toEqual([["guidelineProposed:g1", "guideline"]]);
    expect(changes[0].target).toEqual({ section: "employees", employeeId: "basil" });
  });

  it("依帳本的順序（新到舊）取最近 4 則", () => {
    const events = Array.from({ length: 6 }, (_, i) => event(`returned:rv${6 - i}`, "returned", T(6 - i), { reason: "process" }));
    const changes = recentChanges(events, new Set());
    expect(RECENT_CHANGES_LIMIT).toBe(4);
    expect(changes.map((c) => c.id)).toEqual(["returned:rv6", "returned:rv5", "returned:rv4", "returned:rv3"]);
    expect(recentChanges(events, new Set(), 2)).toHaveLength(2);
  });

  it("退回沒有交辦（看不到）時，點了到員工", () => {
    const [change] = recentChanges([event("returned:rv1", "returned", T(1), { assignment: null, reason: "wrong" })], new Set());
    expect(change.target).toEqual({ section: "employees", employeeId: "basil" });
  });

  it("沒有事件時是空陣列", () => {
    expect(recentChanges([], new Set())).toEqual([]);
  });
});

describe("readRecentChanges：匯入虛構資料後", () => {
  let db: Database;
  beforeAll(async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
  });
  afterAll(() => db.close());

  it("manager：最多 4 則，依時間新到舊，每則都是列出的種類", async () => {
    const changes = await readRecentChanges(db, "manager", lang);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.length).toBeLessThanOrEqual(RECENT_CHANGES_LIMIT);
    for (let i = 1; i < changes.length; i++) expect(changes[i - 1].event.at >= changes[i].event.at).toBe(true);
    for (const c of changes) expect(["returned", "spot", "level", "guideline"]).toContain(c.kind);
  });

  it("抽查的結果：demo 的看重點期間有被抽查的驗收，標成 spot；面板是全部變化的前 4 則", async () => {
    const events = await readLedger(db, "manager", lang);
    const spots = await readSpotReviewIds(db, "manager", events);
    expect(spots.size).toBeGreaterThan(0);
    const all = recentChanges(events, spots, Infinity);
    expect(all.filter((c) => c.kind === "spot").map((c) => reviewIdOf(c.event))).toEqual(
      events.filter((e) => spots.has(reviewIdOf(e) ?? "")).map((e) => reviewIdOf(e)),
    );
    expect(await readRecentChanges(db, "manager", lang)).toEqual(all.slice(0, RECENT_CHANGES_LIMIT));
  });

  it("guest 與沒有身分：空陣列", async () => {
    expect(await readRecentChanges(db, "guest", lang)).toEqual([]);
    expect(await readRecentChanges(db, null, lang)).toEqual([]);
  });
});
