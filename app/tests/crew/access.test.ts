// crew 資料表的越權測試（#24）。用到被禁止的語句，所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import type { PGliteInterface } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { crewMigrations } from "../../src/crew/db/migrate";
import { openDatabase, type Database } from "../../src/db/database";

// 虛構資料，以 superuser 匯入
async function seedCrew(pg: PGliteInterface): Promise<void> {
  await pg.exec(`
    INSERT INTO crew.repos (id, full_name, project_id) VALUES
      ('lantern', 'example-org/lantern-notes', 'bluewing'),
      ('harbor', 'example-org/harbor-docs', 'longpier');
    INSERT INTO crew.employees (id, display_name, role_note) VALUES
      ('juniper', 'Juniper', 'UI'),
      ('basil', 'Basil', NULL);
    INSERT INTO crew.work_types (id) VALUES ('ui'), ('docs');
  `);
}

const TABLES = ["repos", "employees", "work_types"] as const;
const ALL = { employees: ["basil", "juniper"], work_types: ["docs", "ui"] };
const NONE = { repos: [], employees: [], work_types: [] };

let db: Database;

beforeAll(async () => {
  db = await openDatabase(clientConfig, { migrations: crewMigrations, seed: seedCrew });
});
afterAll(async () => {
  await db.close();
});

const ids = (identity: string | null, table: string) =>
  db.withIdentity(identity, async (tx) =>
    (await tx.query<{ id: string }>(`SELECT id FROM crew.${table} ORDER BY id`)).rows.map((r) => r.id),
  );

const readAll = async (identity: string | null) =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await ids(identity, t)] as const)));

const MATRIX: [string, string | null, Record<string, string[]>][] = [
  ["沒有身分", null, NONE],
  ["不存在的身分", "nobody", NONE],
  ["guest", "guest", { repos: [], ...ALL }],
  ["staff", "staff", { repos: ["lantern"], ...ALL }],
  ["manager", "manager", { repos: ["harbor", "lantern"], ...ALL }],
];

describe("讀取", () => {
  it.each(MATRIX)("%s", async (_name, identity, expected) => {
    expect(await readAll(identity)).toEqual(expected);
  });

  it("以條件查詢也讀不到其他專案的 repo", async () => {
    const n = await db.withIdentity("staff", async (tx) => (await tx.query("SELECT * FROM crew.repos WHERE project_id = 'longpier'")).rows.length);
    expect(n).toBe(0);
  });
});

describe("kk_app 不能寫入", () => {
  it.each([
    ["repos INSERT", "INSERT INTO crew.repos (id, full_name, project_id) VALUES ('x', 'example-org/x', 'bluewing')"],
    ["repos UPDATE", "UPDATE crew.repos SET full_name = 'example-org/y'"],
    ["repos DELETE", "DELETE FROM crew.repos"],
    ["employees INSERT", "INSERT INTO crew.employees (id, display_name) VALUES ('x', 'X')"],
    ["employees UPDATE", "UPDATE crew.employees SET display_name = 'Y'"],
    ["employees DELETE", "DELETE FROM crew.employees"],
    ["work_types INSERT", "INSERT INTO crew.work_types (id) VALUES ('x')"],
    ["work_types UPDATE", "UPDATE crew.work_types SET id = 'y'"],
    ["work_types DELETE", "DELETE FROM crew.work_types"],
  ])("%s 失敗", async (_name, sql) => {
    await expect(db.withIdentity("manager", (tx) => tx.exec(sql))).rejects.toThrow("permission denied");
  });

  it.each([
    ["DISABLE ROW LEVEL SECURITY", "ALTER TABLE crew.repos DISABLE ROW LEVEL SECURITY"],
    ["NO FORCE ROW LEVEL SECURITY", "ALTER TABLE crew.repos NO FORCE ROW LEVEL SECURITY"],
    ["DROP POLICY", "DROP POLICY can_see ON crew.repos"],
  ])("%s 失敗", async (_name, sql) => {
    await expect(db.withIdentity("staff", (tx) => tx.exec(sql))).rejects.toThrow("must be owner");
  });

  it("失敗之後讀取結果不變", async () => {
    for (const [name, identity, expected] of MATRIX) expect(await readAll(identity), name).toEqual(expected);
  });
});

describe("結構", () => {
  it("crew 的資料表都屬於 kk_owner，並 ENABLE 與 FORCE ROW LEVEL SECURITY", async () => {
    const rows = await db.withIdentity(null, async (tx) =>
      (
        await tx.query<{ relname: string; owner: string; rls: boolean; force: boolean }>(`
          SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'crew' AND c.relkind = 'r'
          ORDER BY c.relname`)
      ).rows,
    );
    expect(rows.map((r) => r.relname)).toEqual(["assignments", "employees", "level_decisions", "repos", "reviews", "work_changes", "work_checks", "work_points", "work_types", "works"]);
    for (const r of rows) expect(r, r.relname).toMatchObject({ owner: "kk_owner", rls: true, force: true });
  });
});
