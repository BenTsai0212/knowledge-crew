import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../client/load";
import { openDatabase } from "../../db/database";
import { applyMigrations, migrations } from "../../db/migrate";
import { crewMigrations } from "./migrate";

const FIRST = "crew/0001_repos_employees_work_types";

// superuser 的 PGlite 加上 database.ts 會建立的角色與 schema（同 database.test.ts 的 migrate 測試）
async function bare() {
  const pg = await PGlite.create();
  await pg.exec(`
    CREATE ROLE kk_owner NOLOGIN; CREATE ROLE kk_app NOLOGIN;
    CREATE SCHEMA kk; CREATE SCHEMA kk_meta; CREATE SCHEMA crew;
  `);
  return pg;
}

describe("crew 的 migration", { timeout: 30_000 }, () => {
  it("版本都以 crew/ 開頭並依版本排序", () => {
    const versions = crewMigrations.map((m) => m.version);
    for (const v of versions) expect(v).toMatch(/^crew\/\d{4}_[a-z0-9_]+$/);
    expect(versions).toEqual([...versions].sort());
    expect(versions).toContain(FIRST);
    // #142 的守則
    expect(versions).toContain("crew/0007_guidelines");
  });

  it("在 knowledge-kit 之後依序套用，不重複套用，兩邊的版本都有記錄", async () => {
    const pg = await bare();
    await applyMigrations(pg);
    expect(await applyMigrations(pg, crewMigrations)).toEqual(crewMigrations.map((m) => m.version));
    expect(await applyMigrations(pg, crewMigrations)).toEqual([]);
    const recorded = (await pg.query<{ version: string }>("SELECT version FROM kk_meta.schema_migrations")).rows.map((r) => r.version);
    expect(recorded).toEqual(expect.arrayContaining([...migrations.map((m) => m.version), ...crewMigrations.map((m) => m.version)]));
    await pg.close();
  });

  it("已套用的 crew migration 被修改時拋錯", async () => {
    const pg = await bare();
    await applyMigrations(pg);
    await applyMigrations(pg, crewMigrations);
    const changed = crewMigrations.map((m) => (m.version === FIRST ? { ...m, sql: `${m.sql}\n-- changed` } : m));
    await expect(applyMigrations(pg, changed)).rejects.toThrow(`${FIRST} 已套用但內容被修改`);
    await pg.close();
  });

  it("knowledge-kit 的 migration 清單沒有因 crew 改變", () => {
    const kk = migrations.map((m) => m.version);
    expect(kk.filter((v) => v.startsWith("crew/"))).toEqual([]);
    expect(kk.filter((v) => crewMigrations.some((c) => c.version === v))).toEqual([]);
    const crewSql = new Set(crewMigrations.map((m) => m.sql));
    expect(migrations.filter((m) => crewSql.has(m.sql))).toEqual([]);
  });

  it("約束：executor_type 只允許 platform；來源必須屬於存在的專案", async () => {
    const pg = await bare();
    await applyMigrations(pg);
    await applyMigrations(pg, crewMigrations);
    await pg.exec("INSERT INTO kk.projects (id) VALUES ('bluewing')");
    await expect(
      pg.exec("INSERT INTO crew.employees (id, display_name, executor_type) VALUES ('x', 'X', 'external')"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('x', 'repo', 'example-org/x', 'nowhere')"),
    ).rejects.toThrow(/foreign key/);
    await pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('a', 'repo', 'example-org/a', 'bluewing')");
    await expect(
      pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('b', 'repo', 'example-org/a', 'bluewing')"),
    ).rejects.toThrow(/unique/);
    await pg.close();
  });

  it("openDatabase() 不傳 migrations 時沒有 crew 的資料表", async () => {
    const db = await openDatabase(clientConfig);
    const tables = await db.withIdentity(null, async (tx) =>
      (await tx.query("SELECT 1 FROM pg_tables WHERE schemaname = 'crew'")).rows.length,
    );
    expect(tables).toBe(0);
    await db.close();
  });
});
