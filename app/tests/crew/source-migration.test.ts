// crew 0004（#57）套用在已有資料的資料庫上：既有的 repo、Issue／PR 編號轉成新結構，RLS 結果不變。
// 以 SET ROLE 檢查 kk_app 看得到的範圍，所以放在 app/src/ 之外（見 app/tests/db/forbidden-sql.test.ts）。
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { crewMigrations } from "../../src/crew/db/migrate";
import { applyMigrations } from "../../src/db/migrate";

const SOURCES = "crew/0004_work_sources_external_refs";

// 同 app/src/crew/db/migrate.test.ts 的 bare()
async function bare() {
  const pg = await PGlite.create();
  await pg.exec(`
    CREATE ROLE kk_owner NOLOGIN; CREATE ROLE kk_app NOLOGIN;
    CREATE SCHEMA kk; CREATE SCHEMA kk_meta; CREATE SCHEMA crew;
  `);
  return pg;
}

it("0004 套用在已有資料的資料庫上：repo 成為 repo 類、Issue／PR 編號轉成文字，RLS 結果不變", { timeout: 30_000 }, async () => {
  const pg = await bare();
  await applyMigrations(pg);
  const before = crewMigrations.filter((m) => m.version < SOURCES);
  expect(before.length).toBe(crewMigrations.findIndex((m) => m.version === SOURCES));
  await applyMigrations(pg, before);
  await pg.exec(`
    INSERT INTO kk.visibility_levels (id, rank) VALUES ('internal', 0);
    INSERT INTO kk.projects (id) VALUES ('bluewing'), ('longpier');
    INSERT INTO kk.identities (id, visibility_level_id, can_review) VALUES ('manager', 'internal', true), ('staff', 'internal', false);
    INSERT INTO kk.identity_projects (identity_id, project_id) VALUES ('manager', 'bluewing'), ('manager', 'longpier'), ('staff', 'bluewing');
    INSERT INTO crew.repos (id, full_name, project_id) VALUES ('lantern', 'example-org/lantern-notes', 'bluewing'), ('harbor', 'example-org/harbor-docs', 'longpier');
    INSERT INTO crew.employees (id, display_name) VALUES ('juniper', 'Juniper');
    INSERT INTO crew.work_types (id) VALUES ('ui');
    INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by) VALUES
      ('a1', 'lantern', 116, 'X', 'ui', 'juniper', 'manager'), ('a2', 'harbor', 116, 'Y', 'ui', 'juniper', 'manager');
    INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('w1', 'a1', 1, 218, 'X');
  `);
  const visible = async (identity: string) => {
    await pg.exec("SET ROLE kk_app");
    await pg.query("SELECT set_config('kk.identity_id', $1, false)", [identity]);
    const n = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM crew.assignments")).rows[0].n;
    await pg.exec("RESET ROLE");
    return n;
  };
  const visibleBefore = [await visible("manager"), await visible("staff")];

  // 只套用到 0004（之後的 crew migration 另有測試）
  expect(await applyMigrations(pg, crewMigrations.filter((m) => m.version <= SOURCES))).toEqual([SOURCES]);
  expect((await pg.query("SELECT id, kind, name FROM crew.sources ORDER BY id")).rows).toEqual([
    { id: "harbor", kind: "repo", name: "example-org/harbor-docs" },
    { id: "lantern", kind: "repo", name: "example-org/lantern-notes" },
  ]);
  expect((await pg.query("SELECT id, source_id, external_ref FROM crew.assignments ORDER BY id")).rows).toEqual([
    { id: "a1", source_id: "lantern", external_ref: "116" },
    { id: "a2", source_id: "harbor", external_ref: "116" },
  ]);
  expect((await pg.query("SELECT external_ref FROM crew.works")).rows).toEqual([{ external_ref: "218" }]);
  await expect(
    pg.exec("INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES ('a3', 'lantern', '116', 'Z', 'ui', 'juniper', 'manager')"),
  ).rejects.toThrow(/unique/);
  expect([await visible("manager"), await visible("staff")]).toEqual(visibleBefore);
  expect(visibleBefore).toEqual([2, 1]);
  await pg.close();
});
