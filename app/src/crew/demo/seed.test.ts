import type { PGliteInterface } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase, type Database } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { listGuidelines, listWorkGuidelines } from "../db/store";
import { DEMO_RAW } from "./load";
import { demoSeed } from "./seed";
import type { DemoFile } from "./types";

const demo = DEMO_RAW as DemoFile;
const TABLES = ["sources", "employees", "work_types", "assignments", "works", "work_points", "work_changes", "work_checks", "reviews", "level_decisions",
  "guidelines", "guideline_decisions", "work_guidelines", "review_corrections", "review_feedback"];

const counts = async (pg: PGliteInterface) =>
  Object.fromEntries(
    await Promise.all(TABLES.map(async (t) => [t, (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM crew.${t}`)).rows[0].n])),
  );

// 以 superuser 匯入後在同一個連線讀取（不經 RLS），回傳 inspect 的結果；raw 為 undefined 時不匯入
async function seedAndInspect<T>(raw: unknown, inspect: (pg: PGliteInterface) => Promise<T>): Promise<T> {
  let result!: T;
  const db = await openDatabase(clientConfig, {
    migrations: crewMigrations,
    seed: async (pg) => {
      if (raw !== undefined) await demoSeed(raw, clientConfig)(pg);
      result = await inspect(pg);
    },
  });
  await db.close();
  return result;
}

// 開資料庫（套用全部 migration）的測試接近 Vitest 預設的 5 秒，CI 的 runner 較慢時會逾時（PR #47）
const DB_TIMEOUT = 20_000;

describe("demoSeed", () => {
  it("參考情境的 demo.json 存在", () => {
    expect(DEMO_RAW).not.toBeNull();
  });

  it("匯入後的筆數與 demo.json 一致（交辦 64、工作 70、驗收 63、看重點的決定 4；#134 加了 6 件、#161 加了 10 件交辦；#142 的守則 6、決定 6、依照 44；#161 的更正 1、逐條回饋 6）", async () => {
    const works = demo.assignments.flatMap((a) => a.works);
    const expected = {
      sources: 4, employees: 4, work_types: 4, assignments: 64, works: 70, reviews: 63, level_decisions: 4,
      guidelines: 6, guideline_decisions: 6, work_guidelines: 44, review_corrections: 1, review_feedback: 6,
      work_points: works.reduce((n, w) => n + w.points.length, 0),
      work_changes: works.reduce((n, w) => n + w.changes.length, 0),
      work_checks: works.reduce((n, w) => n + w.checks.length, 0),
    };
    expect(await seedAndInspect(DEMO_RAW, counts)).toEqual(expected);
  }, DB_TIMEOUT);

  it("過去的時間原樣寫入；文字是 client.json 的 defaultLanguage", async () => {
    const s12 = demo.assignments.find((a) => a.id === "s12")!;
    const lang = clientConfig.client.defaultLanguage;
    const row = await seedAndInspect(DEMO_RAW, async (pg) => {
      const a = await pg.query<{ title: string; assigned_at: Date }>("SELECT title, assigned_at FROM crew.assignments WHERE id = 's12'");
      const r = await pg.query<{ decided_at: Date; reason: string }>("SELECT decided_at, reason FROM crew.reviews WHERE id = 's12-1'");
      return { ...a.rows[0], ...r.rows[0] };
    });
    expect(row.title).toBe(s12.title[lang]);
    expect(row.assigned_at.toISOString()).toBe(new Date(s12.assignedAt).toISOString());
    expect(row.decided_at.toISOString()).toBe(new Date(s12.works[0].review!.decidedAt).toISOString());
    expect(row.reason).toBe("wrong");
  }, DB_TIMEOUT);

  it("等待驗收的交辦：最後一輪已交件、沒有驗收", async () => {
    const pending = await seedAndInspect(DEMO_RAW, async (pg) =>
      (await pg.query<{ id: string }>(`
        SELECT a.id FROM crew.assignments a
        JOIN crew.works w ON w.assignment_id = a.id
        LEFT JOIN crew.reviews r ON r.work_id = w.id
        WHERE r.id IS NULL ORDER BY a.id`)).rows.map((r) => r.id),
    );
    // #134 加了停滯的等驗收 c12、j11；#161 加了抽查的 k17
    expect(pending).toEqual(["c11", "c12", "j06", "j11", "k13", "k17", "s14"]);
  }, DB_TIMEOUT);

  it("同一檢查有多筆時依檔案順序寫入（同時間時 id 較大的是後寫的）", async () => {
    const rows = await seedAndInspect(DEMO_RAW, async (pg) =>
      (await pg.query<{ status: string }>("SELECT status FROM crew.work_checks WHERE work_id = 's01-w1' ORDER BY id")).rows,
    );
    expect(rows.map((r) => r.status)).toEqual(demo.assignments[0].works[0].checks.map((c) => c.status));
  }, DB_TIMEOUT);

  it("驗證不通過時拋錯，一筆也不寫入", async () => {
    const bad = structuredClone(demo);
    bad.assignments[3].employee = "nobody";
    const result = await seedAndInspect(undefined, async (pg) => {
      const error = await demoSeed(bad, clientConfig)(pg).then(() => null, (e: Error) => e.message);
      return { error, counts: await counts(pg) };
    });
    expect(result.error).toMatch(/assignments\[3\]\.employee/);
    expect(result.counts).toEqual(Object.fromEntries(TABLES.map((t) => [t, 0])));
  }, DB_TIMEOUT);
});

// 守則（#142 附錄 A）：匯入後以存取函式讀回（經 RLS，manager 看得到四位員工）
describe("demoSeed：守則", () => {
  let db: Database;
  const lang = clientConfig.client.defaultLanguage;
  const at = (s: string) => new Date(s).toISOString();

  it("6 條守則的提出者、狀態、目前的文字與來源退回", async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
    const guidelines = await listGuidelines(db, "manager");
    expect(guidelines.map((g) => [g.id, `${g.employeeId}/${g.workTypeId}`, g.proposerKind, g.status, g.sourceReviewId])).toEqual([
      ["g04", "linden/knowledge", "human", "revoked", "k01-1"],
      ["g03", "sorrel/content", "human", "active", "c01-1"],
      ["g06", "juniper/dev", "employee", "rejected", "j02-1"],
      ["g01", "rowan/support", "human", "active", "s05-1"],
      ["g05", "linden/knowledge", "employee", "active", "k07-1"],
      ["g02", "rowan/support", "employee", "pending", "s12-1"],
    ]);
    const byId = new Map(guidelines.map((g) => [g.id, g]));
    const source = new Map(demo.guidelines.map((g) => [g.id, g]));
    // 人提：提出者是退回的驗收者，文字是那句意見，確認與退回同時
    const g01 = byId.get("g01")!;
    expect(g01.proposedBy).toBe("manager");
    expect(g01.text).toBe(g01.sourceReview!.note);
    expect(g01.currentText).toBe(source.get("g01")!.text[lang]);
    expect(g01.decisions.map((d) => [d.id, d.decision, d.decidedAt])).toEqual([["g01-d1", "confirm", at("2026-09-17T15:00:00+08:00")]]);
    expect(g01.proposedAt).toBe(g01.sourceReview!.decidedAt);
    // 員工提出：沒有提出者；修改後確認以修改後的文字為準
    const g05 = byId.get("g05")!;
    expect(g05.proposedBy).toBeNull();
    expect(g05.text).toBe(source.get("g05")!.text[lang]);
    expect(g05.currentText).toBe(source.get("g05")!.decisions[0].revisedText![lang]);
    // 收回指向那筆確認
    expect(byId.get("g04")!.decisions.map((d) => [d.id, d.decision, d.decidedAt])).toEqual([
      ["g04-d1", "confirm", at("2026-09-02T15:00:00+08:00")],
      ["g04-d2", "revoke", at("2026-10-20T10:00:00+08:00")],
    ]);
    await db.close();
  }, DB_TIMEOUT);

  it("交件依照的守則：k08～k10 依照 g04 與 g05，收回後的 k11 只依照 g05，來源交辦的第 2 輪與 s15、k14 沒有", async () => {
    db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: demoSeed(DEMO_RAW, clientConfig) });
    const follows = async (workId: string) => (await listWorkGuidelines(db, "manager", workId)).map((g) => g.id).sort();
    expect(await follows("k08-w1")).toEqual(["g04", "g05"]);
    expect(await follows("k11-w1")).toEqual(["g05"]);
    expect(await follows("s16-w1")).toEqual(["g01"]);
    expect(await follows("c12-w1")).toEqual(["g03"]);
    for (const w of ["s05-w2", "c01-w2", "k01-w2", "k07-w2", "j03-w1", "s01-w1"]) expect(await follows(w), w).toEqual([]);
    expect(demo.assignments.filter((a) => ["s15", "k14"].includes(a.id)).map((a) => a.works.length)).toEqual([0, 0]);
    await db.close();
  }, DB_TIMEOUT);

  it("退回的意見寫入預設語言；通過沒有意見", async () => {
    const notes = await seedAndInspect(DEMO_RAW, async (pg) =>
      (await pg.query<{ id: string; note: string | null; can_be_guideline: boolean }>(
        "SELECT id, note, can_be_guideline FROM crew.reviews WHERE note IS NOT NULL ORDER BY id")).rows,
    );
    const expected = demo.assignments.flatMap((a) => a.works.flatMap((w) => (w.review?.note ? [{ id: w.review.id, note: w.review.note[lang] }] : [])));
    expect(notes.map(({ id, note }) => ({ id, note }))).toEqual(expected.sort((x, y) => x.id.localeCompare(y.id)));
    expect(notes).toHaveLength(10);
    // 流程上的小問題不能成為守則
    expect(notes.filter((n) => !n.can_be_guideline).map((n) => n.id)).toEqual(["c05-1", "j04-1"]);
  }, DB_TIMEOUT);
});
