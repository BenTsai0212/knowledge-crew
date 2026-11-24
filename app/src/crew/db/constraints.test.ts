// crew 0002 的 CHECK 與 UNIQUE（#26）、0004 的工作來源與外部編號（#57），與 0005 的知識庫回流（#92）。superuser 的 PGlite，寫法同 migrate.test.ts 的 bare()。
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
    INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('lantern', 'repo', 'example-org/lantern-notes', 'bluewing');
    INSERT INTO crew.employees (id, display_name) VALUES ('juniper', 'Juniper');
    INSERT INTO crew.work_types (id) VALUES ('ui');
    INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by)
      VALUES ('a1', 'lantern', 1, 'Fix header', 'ui', 'juniper', 'manager');
    INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES
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
    ["assignments 的 (source_id, external_ref) 重複", "INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES ('a2', 'lantern', 1, 'X', 'ui', 'juniper', 'manager')", /unique/],
    ["works 的 (assignment_id, round) 重複", "INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('wx', 'a1', 1, 13, 'X')", /unique/],
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

describe("crew 0004 的工作來源與外部編號", () => {
  const assignment = (id: string, source: string, ref: string | null) =>
    `INSERT INTO crew.assignments (id, source_id, external_ref, title, work_type_id, employee_id, assigned_by) VALUES ('${id}', '${source}', ${ref === null ? "NULL" : `'${ref}'`}, 'X', 'ui', 'juniper', 'manager')`;

  it("既有的來源是 repo 類；類型只允許四種、一定要指定", async () => {
    expect((await pg.query<{ kind: string }>("SELECT kind FROM crew.sources")).rows).toEqual([{ kind: "repo" }]);
    for (const kind of ["mailbox", "social", "knowledge_base"]) {
      await pg.exec(`INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-${kind}', '${kind}', 'Source ${kind}', 'bluewing')`);
    }
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-x', 'chat', 'X', 'bluewing')")).rejects.toThrow(/check constraint/);
    await expect(pg.exec("INSERT INTO crew.sources (id, name, project_id) VALUES ('s-y', 'Y', 'bluewing')")).rejects.toThrow(/null value/);
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-z', 'mailbox', '', 'bluewing')")).rejects.toThrow(/check constraint/);
    await expect(pg.exec("INSERT INTO crew.sources (id, kind, name, project_id) VALUES ('s-w', 'mailbox', 'Source mailbox', 'bluewing')")).rejects.toThrow(/unique/);
  });

  it("外部編號可以為空，同一來源可有多筆；有值時同一來源內不重複，不同來源可以重複；空字串被拒", async () => {
    await pg.exec(assignment("n1", "s-mailbox", null));
    await pg.exec(assignment("n2", "s-mailbox", null));
    await pg.exec(assignment("m1", "s-mailbox", "MSG-1"));
    await expect(pg.exec(assignment("m2", "s-mailbox", "MSG-1"))).rejects.toThrow(/unique/);
    await pg.exec(assignment("m3", "s-social", "MSG-1"));
    await expect(pg.exec(assignment("m4", "s-mailbox", ""))).rejects.toThrow(/check constraint/);
    await pg.exec("INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('wn', 'n1', 1, NULL, 'X')");
    await expect(pg.exec("INSERT INTO crew.works (id, assignment_id, round, external_ref, summary) VALUES ('we', 'n2', 1, '', 'X')")).rejects.toThrow(/check constraint/);
  });

  it("限制名稱與表、欄位一致", async () => {
    const names = (await pg.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conname IN ('sources_name_key', 'assignments_source_id_external_ref_key') ORDER BY 1",
    )).rows.map((r) => r.conname);
    expect(names).toEqual(["assignments_source_id_external_ref_key", "sources_name_key"]);
  });
});

describe("crew 0005 的約束（#92）", () => {
  it("回流等級只能填在知識庫類的來源，且是存在的機密等級", async () => {
    const source = (id: string, kind: string, level: string) =>
      `INSERT INTO crew.sources (id, kind, name, project_id, knowledge_visibility_level_id) VALUES ('${id}', '${kind}', '${id}', 'bluewing', '${level}')`;
    await pg.exec(source("kb-ok", "knowledge_base", "internal"));
    await expect(pg.exec(source("kb-repo", "repo", "internal"))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(source("kb-missing", "knowledge_base", "secret"))).rejects.toThrow(/foreign key/);
  });

  // 約束不看驗收的結果（是否「通過」由 policy 檢查），沿用上面寫入的 r1、r2
  it("回流紀錄：一次驗收一份文件，一份文件只來自一次驗收，文件必須存在", async () => {
    await pg.exec(`
      INSERT INTO kk.documents (id, title, language, visibility_level_id) VALUES ('crew-w1', 'T', 'en', 'internal'), ('crew-w2', 'T', 'en', 'internal');
      INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r1', 'crew-w1');
    `);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r1', 'crew-w2')")).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r2', 'crew-w1')")).rejects.toThrow(/unique|duplicate key/);
    await expect(pg.exec("INSERT INTO crew.knowledge_flowbacks (review_id, document_id) VALUES ('r2', 'nowhere')")).rejects.toThrow(/foreign key/);
  });
});

describe("crew 0006 的約束（#133）", () => {
  const insert = (id: string, extra: string, values: string) =>
    `INSERT INTO crew.assignments (id, source_id, title, work_type_id, employee_id, assigned_by${extra}) VALUES ('${id}', 'lantern', 'X', 'ui', 'juniper', 'manager'${values})`;

  it("既有的交辦：沒有到期日、優先順序是 normal", async () => {
    const [a1] = (await pg.query<{ due_at: string | null; priority: string }>("SELECT due_at, priority FROM crew.assignments WHERE id = 'a1'")).rows;
    expect(a1).toEqual({ due_at: null, priority: "normal" });
  });

  it("到期日可以為空；優先順序只允許 high、normal、low，不能是 NULL", async () => {
    await pg.exec(insert("d1", ", due_at, priority", ", '2026-11-20', 'high'"));
    await pg.exec(insert("d2", ", priority", ", 'low'"));
    const rows = (await pg.query<{ id: string; due: string | null; priority: string }>(
      "SELECT id, to_char(due_at, 'YYYY-MM-DD') AS due, priority FROM crew.assignments WHERE id IN ('d1', 'd2') ORDER BY id",
    )).rows;
    expect(rows).toEqual([{ id: "d1", due: "2026-11-20", priority: "high" }, { id: "d2", due: null, priority: "low" }]);
    await expect(pg.exec(insert("d3", ", priority", ", 'urgent'"))).rejects.toThrow(/check constraint/);
    await expect(pg.exec(insert("d4", ", priority", ", NULL"))).rejects.toThrow(/not-null|null value/);
    await expect(pg.exec(insert("d5", ", due_at", ", '2026-02-30'"))).rejects.toThrow();
  });
});
