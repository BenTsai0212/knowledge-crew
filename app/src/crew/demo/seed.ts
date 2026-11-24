// 虛構資料 client/crew/demo.json 的匯入（#29）。交給 openDatabase() 的 seed 選項，以 superuser 寫入，可以填過去的時間。
// 匯入前以 validateDemo() 驗證，有錯就拋錯、一筆也不寫入。文字寫入 client.json 的 defaultLanguage（#29 的 `## 決定` 1）；
// 畫面依目前語言以 texts.ts 的 demoText() 換成 demo.json 的對應文字。
// 已通過的知識庫條目以 createReview() 相同的寫法回流（db/store.ts 的 writeFlowback()，#92 的 `## 決定` 與計畫第 5 節），
// 所以 demo 一開始就看得到；驗收者沒有上傳權限時不回流（同 createReview()）。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { AccessFile, LanguageCode } from "../../client/types";
import { writeFlowback } from "../db/store";
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
    await insertDemo(pg, demo, config.client.defaultLanguage, config.access);
  };
}

async function insertDemo(pg: PGliteInterface, demo: DemoFile, language: LanguageCode, access: AccessFile): Promise<void> {
  await pg.transaction(async (tx) => {
    const insert = (table: string, columns: string[], values: unknown[]) =>
      tx.query(`INSERT INTO crew.${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, values);

    for (const s of demo.sources) {
      await insert("sources", ["id", "kind", "name", "project_id", "knowledge_visibility_level_id"], [
        s.id, s.kind, s.name, s.project, s.knowledgeVisibility ?? null,
      ]);
    }
    for (const e of demo.employees) {
      await insert("employees", ["id", "display_name", "role_note"], [e.id, e.displayName, e.roleNote[language]]);
    }
    for (const w of demo.workTypes) await insert("work_types", ["id"], [w]);

    for (const a of demo.assignments) {
      await insert(
        "assignments",
        ["id", "source_id", "external_ref", "title", "work_type_id", "employee_id", "assigned_by", "assigned_at", "due_at", "priority"],
        [a.id, a.source, a.externalRef ?? null, a.title[language], a.workType, a.employee, a.assignedBy, a.assignedAt, a.dueAt ?? null, a.priority ?? "normal"],
      );
      for (const w of a.works) {
        const workId = demoWorkId(a.id, w.round);
        await insert(
          "works",
          ["id", "assignment_id", "round", "external_ref", "summary", "body", "submitted_at"],
          [workId, a.id, w.round, w.externalRef ?? null, w.summary[language], w.body[language], w.submittedAt],
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

    const kbLevel = new Map(demo.sources.map((s) => [s.id, s.knowledgeVisibility ?? null]));
    const uploaders = new Set(access.roles.filter((r) => r.canUpload).map((r) => r.id));
    for (const a of demo.assignments) {
      const level = kbLevel.get(a.source);
      const project = demo.sources.find((s) => s.id === a.source)!.project;
      for (const w of a.works) {
        const r = w.review;
        if (!level || r?.verdict !== "accepted" || !uploaders.has(r.decidedBy)) continue;
        await writeFlowback(tx, {
          reviewId: r.id, workId: demoWorkId(a.id, w.round), body: w.body[language], projectId: project, level,
          actor: r.decidedBy, language, date: r.decidedAt.slice(0, 10), at: r.decidedAt,
        });
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
