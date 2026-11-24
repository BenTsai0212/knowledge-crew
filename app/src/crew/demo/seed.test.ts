import type { PGliteInterface } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase } from "../../db/database";
import { crewMigrations } from "../db/migrate";
import { DEMO_RAW } from "./load";
import { demoSeed } from "./seed";
import type { DemoFile } from "./types";

const demo = DEMO_RAW as DemoFile;
const TABLES = ["sources", "employees", "work_types", "assignments", "works", "work_points", "work_changes", "work_checks", "reviews", "level_decisions"];

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

  it("匯入後的筆數與 demo.json 一致（交辦 48、工作 56、驗收 52、看重點的決定 4）", async () => {
    const works = demo.assignments.flatMap((a) => a.works);
    const expected = {
      sources: 4, employees: 4, work_types: 4, assignments: 48, works: 56, reviews: 52, level_decisions: 4,
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
    expect(pending).toEqual(["c11", "j06", "k13", "s14"]);
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
