// 虛構資料 client/crew/demo.json 的匯入（#29）。交給 openDatabase() 的 seed 選項，以 superuser 寫入，可以填過去的時間。
// 匯入前以 validateDemo() 驗證，有錯就拋錯、一筆也不寫入。文字寫入 client.json 的 defaultLanguage（#29 的 `## 決定` 1）；
// 畫面依目前語言以 texts.ts 的 demoText() 換成 demo.json 的對應文字。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { AccessFile, LanguageCode } from "../../client/types";
import { demoWorkId, type DemoFile } from "./types";
import { assertDemo, type ValidateOptions } from "./validate";

export interface DemoSeedConfig {
  access: AccessFile;
  client: { defaultLanguage: LanguageCode; languages: readonly LanguageCode[] };
}

/** 回傳可交給 openDatabase() 的 seed 選項的函式；`raw` 是未驗證的 demo.json 內容。 */
export function demoSeed(raw: unknown, config: DemoSeedConfig, options: Pick<ValidateOptions, "now"> = {}) {
  return async (pg: PGliteInterface): Promise<void> => {
    const demo = assertDemo(raw, config.access, { ...options, languages: config.client.languages });
    await insertDemo(pg, demo, config.client.defaultLanguage);
  };
}

async function insertDemo(pg: PGliteInterface, demo: DemoFile, language: LanguageCode): Promise<void> {
  await pg.transaction(async (tx) => {
    const insert = (table: string, columns: string[], values: unknown[]) =>
      tx.query(`INSERT INTO crew.${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, values);

    for (const r of demo.repos) await insert("repos", ["id", "full_name", "project_id"], [r.id, r.fullName, r.project]);
    for (const e of demo.employees) {
      await insert("employees", ["id", "display_name", "role_note"], [e.id, e.displayName, e.roleNote[language]]);
    }
    for (const w of demo.workTypes) await insert("work_types", ["id"], [w]);

    for (const a of demo.assignments) {
      await insert(
        "assignments",
        ["id", "repo_id", "issue_number", "title", "work_type_id", "employee_id", "assigned_by", "assigned_at"],
        [a.id, a.repo, a.issueNumber, a.title[language], a.workType, a.employee, a.assignedBy, a.assignedAt],
      );
      for (const w of a.works) {
        const workId = demoWorkId(a.id, w.round);
        await insert(
          "works",
          ["id", "assignment_id", "round", "pr_number", "summary", "body", "submitted_at"],
          [workId, a.id, w.round, w.prNumber, w.summary[language], w.body[language], w.submittedAt],
        );
        for (const [i, p] of w.points.entries()) await insert("work_points", ["work_id", "ordinal", "text"], [workId, i + 1, p[language]]);
        for (const [i, c] of w.changes.entries()) {
          await insert("work_changes", ["work_id", "ordinal", "path", "summary"], [workId, i + 1, c.path, c.summary[language]]);
        }
        // 依檔案順序寫入：同時間時以自動編號的 id 決定最新一筆
        for (const c of w.checks) await insert("work_checks", ["work_id", "name", "status", "checked_at"], [workId, c.name, c.status, c.checkedAt]);
        const r = w.review;
        if (r) {
          await insert(
            "reviews",
            ["id", "work_id", "verdict", "reason", "note", "decided_by", "decided_at"],
            [r.id, workId, r.verdict, r.reason ?? null, r.note ?? null, r.decidedBy, r.decidedAt],
          );
        }
      }
    }

    for (const d of demo.levelDecisions) {
      await insert(
        "level_decisions",
        ["id", "employee_id", "work_type_id", "decision", "basis_review_id", "decided_by", "decided_at"],
        [d.id, d.employee, d.workType, d.decision, d.basisReview ?? null, d.decidedBy, d.decidedAt],
      );
    }
  });
}
