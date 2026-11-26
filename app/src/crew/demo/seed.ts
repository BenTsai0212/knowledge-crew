// 虛構資料 client/crew/demo.json 的匯入（#29）。交給 openDatabase() 的 seed 選項，以 superuser 寫入，可以填過去的時間。
// 匯入前以 validateDemo() 驗證，有錯就拋錯、一筆也不寫入。文字寫入 client.json 的 defaultLanguage（#29 的 `## 決定` 1）；
// 畫面依目前語言以 texts.ts 的 demoText() 換成 demo.json 的對應文字。
// 已通過的知識庫條目以 createReview() 相同的寫法回流（db/store.ts 的 writeFlowback()，#92 的 `## 決定` 與計畫第 5 節），
// 所以 demo 一開始就看得到；驗收者沒有上傳權限時不回流（同 createReview()）。
// 守則（#142）在驗收與看重點的決定之後寫入：守則（依提出時間）→ 決定（依檔案順序）→ 交件依照的守則。資料庫的外鍵只要求父列先寫入；
// 時間條件（交件當時生效、決定晚於提出）不套用 RLS，由 validateDemo() 在匯入前檢查。
// 確認的守則以 decideGuideline() 相同的規則寫成知識庫文件（writeGuidelineDocument()，#149）：來源有守則等級、確認者能上傳；
// 之後收回的守則文件照樣寫入（收回不刪文件）。
// 事後更正與逐條回饋（#161）最後寫入；「更正晚於驗收」等時間條件同樣由 validateDemo() 檢查。
import type { PGliteInterface } from "@electric-sql/pglite";
import type { AccessFile, LanguageCode } from "../../client/types";
import { writeFlowback, writeGuidelineDocument } from "../db/store";
import { identityName, toGuidelineDocument } from "../knowledge/guideline-document";
import { demoGuidelineDecisionId, demoWorkId, type DemoFile } from "./types";
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
      await insert("sources", ["id", "kind", "name", "project_id", "knowledge_visibility_level_id", "guideline_visibility_level_id"], [
        s.id, s.kind, s.name, s.project, s.knowledgeVisibility ?? null, s.guidelineVisibility ?? null,
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
            ["id", "work_id", "verdict", "reason", "note", "not_in_points", "decided_by", "decided_at"],
            [r.id, workId, r.verdict, r.reason ?? null, r.note?.[language] ?? null, r.verdict === "returned" && r.notInPoints === true, r.decidedBy, r.decidedAt],
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

    // 來源退回 → 交件、交辦與驗收者（人提的守則的提出者）
    const reviewSource = new Map(
      demo.assignments.flatMap((a) =>
        a.works.flatMap((w) => (w.review ? [[w.review.id, { workId: demoWorkId(a.id, w.round), assignment: a, review: w.review, decidedBy: w.review.decidedBy }] as const] : [])),
      ),
    );
    const byProposedAt = [...demo.guidelines].sort((x, y) => Date.parse(x.proposedAt) - Date.parse(y.proposedAt));
    for (const g of byProposedAt) {
      const source = reviewSource.get(g.sourceReview)!;
      await insert(
        "guidelines",
        ["id", "employee_id", "work_type_id", "text", "source_review_id", "source_work_id", "source_assignment_id", "proposer_kind", "proposed_by", "proposed_at"],
        [g.id, g.employee, g.workType, g.text[language], g.sourceReview, source.workId, source.assignment.id, g.proposer, g.proposer === "human" ? source.decidedBy : null, g.proposedAt],
      );
    }
    for (const g of demo.guidelines) {
      let confirmId: string | null = null;
      for (const [i, d] of g.decisions.entries()) {
        const id = demoGuidelineDecisionId(g.id, i + 1);
        if (d.decision === "confirm") confirmId = id;
        await insert("guideline_decisions", ["id", "guideline_id", "decision", "revised_text", "confirm_id", "decided_by", "decided_at"], [
          id, g.id, d.decision, d.revisedText?.[language] ?? null, d.decision === "revoke" ? confirmId : null, d.decidedBy, d.decidedAt,
        ]);
      }
    }
    for (const g of demo.guidelines) {
      const at = g.decisions.findIndex((d) => d.decision === "confirm");
      const confirm = g.decisions[at];
      const { assignment, review } = reviewSource.get(g.sourceReview)!;
      const source = demo.sources.find((s) => s.id === assignment.source)!;
      if (!confirm || !source.guidelineVisibility || !uploaders.has(confirm.decidedBy)) continue;
      const doc = toGuidelineDocument({
        employeeName: demo.employees.find((e) => e.id === g.employee)!.displayName, workTypeId: g.workType,
        text: (confirm.revisedText ?? g.text)[language], proposerKind: g.proposer,
        returnDate: review.decidedAt.slice(0, 10), reason: review.reason!,
        confirmerName: identityName(access, confirm.decidedBy, language), confirmDate: confirm.decidedAt.slice(0, 10), revised: confirm.revisedText !== undefined,
      }, language);
      await writeGuidelineDocument(tx, {
        guidelineId: g.id, confirmId: demoGuidelineDecisionId(g.id, at + 1), doc, projectId: source.project, level: source.guidelineVisibility,
        actor: confirm.decidedBy, language, date: confirm.decidedAt.slice(0, 10), at: confirm.decidedAt,
      });
    }
    for (const a of demo.assignments) {
      for (const w of a.works) {
        for (const guidelineId of w.guidelines ?? []) {
          await insert("work_guidelines", ["work_id", "guideline_id", "assignment_id", "employee_id", "work_type_id"], [
            demoWorkId(a.id, w.round), guidelineId, a.id, a.employee, a.workType,
          ]);
        }
      }
    }
    for (const a of demo.assignments) {
      for (const w of a.works) {
        const r = w.review;
        if (!r) continue;
        const workId = demoWorkId(a.id, w.round);
        for (const p of r.feedback?.points ?? []) {
          await insert("review_feedback", ["review_id", "work_id", "target_kind", "point_ordinal", "result"], [r.id, workId, "point", p.ordinal, p.result]);
        }
        for (const g of r.feedback?.guidelines ?? []) {
          await insert("review_feedback", ["review_id", "work_id", "target_kind", "guideline_id", "result"], [r.id, workId, "guideline", g.guideline, g.result]);
        }
        const c = r.verdict === "accepted" ? r.correction : undefined;
        if (c) {
          await insert("review_corrections", ["id", "review_id", "note", "not_in_points", "corrected_by", "corrected_at"], [
            c.id, r.id, c.note?.[language] ?? null, c.notInPoints === true, c.correctedBy, c.correctedAt,
          ]);
        }
      }
    }
  });
}
