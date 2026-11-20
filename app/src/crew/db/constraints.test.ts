// crew 0002 的 CHECK 與 UNIQUE（#26）。superuser 的 PGlite，寫法同 migrate.test.ts 的 bare()。
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate";
import { crewMigrations } from "./migrate";

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    CREATE ROLE kk_owner NOLOGIN; CREATE ROLE kk_app NOLOGIN;
    CREATE SCHEMA kk; CREATE SCHEMA kk_meta; CREATE SCHEMA crew;
  `);
  await applyMigrations(pg);
  await applyMigrations(pg, crewMigrations);
  await pg.exec(`
    INSERT INTO kk.visibility_levels (id, rank) VALUES ('internal', 0);
    INSERT INTO kk.projects (id) VALUES ('bluewing');
    INSERT INTO kk.identities (id, visibility_level_id) VALUES ('manager', 'internal');
    INSERT INTO crew.repos (id, full_name, project_id) VALUES ('lantern', 'example-org/lantern-notes', 'bluewing');
    INSERT INTO crew.employees (id, display_name) VALUES ('juniper', 'Juniper');
    INSERT INTO crew.work_types (id) VALUES ('ui');
    INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by)
      VALUES ('a1', 'lantern', 1, 'Fix header', 'ui', 'juniper', 'manager');
    INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES
      ('w1', 'a1', 1, 10, 'Header'), ('w2', 'a1', 2, 11, 'Header'), ('w3', 'a1', 3, 12, 'Header');
  `);
}, 30_000);
afterAll(async () => {
  await pg.close();
});

const review = (id: string, work: string, verdict: string, reason: string | null) =>
  `INSERT INTO crew.reviews (id, work_id, verdict, reason, decided_by) VALUES ('${id}', '${work}', '${verdict}', ${reason === null ? "NULL" : `'${reason}'`}, 'manager')`;

describe("crew 0002 的約束", () => {
  it.each([
    ["assignments 的 (repo_id, issue_number) 重複", "INSERT INTO crew.assignments (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by) VALUES ('a2', 'lantern', 1, 'X', 'ui', 'juniper', 'manager')", /unique/],
    ["works 的 (assignment_id, round) 重複", "INSERT INTO crew.works (id, assignment_id, round, pr_number, summary) VALUES ('wx', 'a1', 1, 13, 'X')", /unique/],
    ["work_checks.status = running", "INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w1', 'test', 'running')", /check constraint/],
    ["reviews.verdict = maybe", review("rx", "w1", "maybe", null), /check constraint/],
    ["reviews.reason = other", review("rx", "w1", "returned", "other"), /check constraint/],
    ["returned 沒有 reason", review("rx", "w1", "returned", null), /check constraint/],
    ["accepted 帶 reason", review("rx", "w1", "accepted", "wrong"), /check constraint/],
    ["level_decisions.decision = pause", "INSERT INTO crew.level_decisions (id, employee_id, work_type_id, decision, decided_by) VALUES ('ld', 'juniper', 'ui', 'pause', 'manager')", /check constraint/],
  ])("%s 被拒", async (_name, sql, error) => {
    await expect(pg.exec(sql)).rejects.toThrow(error);
  });

  it("合法的驗收可以寫入；同一個 work_id 第二筆被拒", async () => {
    await pg.exec(review("r1", "w1", "returned", "wrong"));
    await pg.exec(review("r2", "w2", "accepted", null));
    await expect(pg.exec(review("r3", "w1", "accepted", null))).rejects.toThrow(/unique/);
  });

  it("同一檢查可以先 pending 再 pass，兩筆並存", async () => {
    await pg.exec(`
      INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w3', 'test', 'pending');
      INSERT INTO crew.work_checks (work_id, name, status) VALUES ('w3', 'test', 'pass');
    `);
    const rows = await pg.query<{ status: string }>(
      "SELECT status FROM crew.work_checks WHERE work_id = 'w3' AND name = 'test' ORDER BY checked_at, id",
    );
    expect(rows.rows.map((r) => r.status)).toEqual(["pending", "pass"]);
  });
});
