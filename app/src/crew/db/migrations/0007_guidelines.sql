-- 守則（crew ADR 0007 決定 6、#142 的計畫與 `## 決定`）：守則、人的決定、一次交件依照的守則。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式、不建觸發器），欄位一律加表名；已合併的 migration 不修改，只新增。
-- 「員工 × 工作類型要和來源相同」以複合外鍵守住（superuser 匯入 demo 時也擋得住），所以 guidelines、work_guidelines
-- 重複存來源的交件、交辦與員工 × 工作類型。「沒有確認不能收回」同樣以外鍵守住（收回指向那筆確認）：policy 不能查詢自己的表
-- （infinite recursion）。「交件當時生效」由寫入 policy 守住，demo 以 superuser 匯入時不套用 RLS，改由 demo 的驗證（validate.ts）檢查。

-- 供外鍵參照的 UNIQUE（id 已是主鍵，加上其他欄位仍唯一）
ALTER TABLE crew.assignments ADD UNIQUE (id, employee_id, work_type_id);
ALTER TABLE crew.works ADD UNIQUE (id, assignment_id);
-- 能成為守則的退回：原因是「做錯了」或「我想要不一樣的做法」，而且有意見。原因只在退回時填（0002 的 CHECK），
-- 所以原因符合就代表是退回；「流程上的小問題」與通過都是 false
ALTER TABLE crew.reviews ADD COLUMN can_be_guideline boolean NOT NULL GENERATED ALWAYS AS (
  coalesce(reviews.reason IN ('wrong', 'different_approach'), false) AND coalesce(btrim(reviews.note), '') <> ''
) STORED;
ALTER TABLE crew.reviews ADD UNIQUE (id, work_id, can_be_guideline);

-- 一條守則。人提的守則由 createReview() 在同一交易寫入一筆確認；員工提出時 proposed_by 是 NULL（員工就是 employee_id）。
-- 同一次退回可以有多條守則（已收回的要恢復時提一條新的，ADR 0007 決定 3）
CREATE TABLE crew.guidelines (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES crew.employees (id),
  work_type_id text NOT NULL REFERENCES crew.work_types (id),
  text text NOT NULL CHECK (btrim(guidelines.text) <> ''),
  source_review_id text NOT NULL,
  source_work_id text NOT NULL,
  source_assignment_id text NOT NULL,
  source_eligible boolean NOT NULL DEFAULT true CHECK (guidelines.source_eligible),
  proposer_kind text NOT NULL CHECK (guidelines.proposer_kind IN ('human', 'employee')),
  proposed_by text REFERENCES kk.identities (id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((guidelines.proposer_kind = 'human') = (guidelines.proposed_by IS NOT NULL)),
  FOREIGN KEY (source_review_id, source_work_id, source_eligible) REFERENCES crew.reviews (id, work_id, can_be_guideline),
  FOREIGN KEY (source_work_id, source_assignment_id) REFERENCES crew.works (id, assignment_id),
  FOREIGN KEY (source_assignment_id, employee_id, work_type_id) REFERENCES crew.assignments (id, employee_id, work_type_id),
  UNIQUE (id, employee_id, work_type_id)
);

-- 人的決定，只新增不覆寫；狀態由決定推算（app/src/crew/guidelines/status.ts）。修改的文字只能出現在確認
CREATE TABLE crew.guideline_decisions (
  id text PRIMARY KEY,
  guideline_id text NOT NULL REFERENCES crew.guidelines (id),
  decision text NOT NULL CHECK (guideline_decisions.decision IN ('confirm', 'reject', 'revoke')),
  revised_text text CHECK (
    guideline_decisions.revised_text IS NULL
    OR (guideline_decisions.decision = 'confirm' AND btrim(guideline_decisions.revised_text) <> '')),
  -- 收回時指向同一守則的確認（沒有確認不能收回）；其他決定是 NULL
  confirm_id text,
  confirm_decision text GENERATED ALWAYS AS (CASE WHEN confirm_id IS NOT NULL THEN 'confirm' END) STORED,
  decided_by text NOT NULL DEFAULT kk.current_identity_id() REFERENCES kk.identities (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((guideline_decisions.decision = 'revoke') = (guideline_decisions.confirm_id IS NOT NULL)),
  UNIQUE (id, guideline_id, decision),
  FOREIGN KEY (confirm_id, guideline_id, confirm_decision) REFERENCES crew.guideline_decisions (id, guideline_id, decision)
);
-- 確認與不採用合計只有一次（不採用或已收回後不能再確認、不能重複確認）；收回只有一次
CREATE UNIQUE INDEX guideline_decisions_settle_once ON crew.guideline_decisions (guideline_id)
  WHERE decision IN ('confirm', 'reject');
CREATE UNIQUE INDEX guideline_decisions_revoke_once ON crew.guideline_decisions (guideline_id)
  WHERE decision = 'revoke';

-- 一次交件依照的守則（員工自述，ADR 0007 決定 5）：交件與守則的員工 × 工作類型不同時外鍵失敗
CREATE TABLE crew.work_guidelines (
  work_id text NOT NULL,
  guideline_id text NOT NULL,
  assignment_id text NOT NULL,
  employee_id text NOT NULL,
  work_type_id text NOT NULL,
  PRIMARY KEY (work_id, guideline_id),
  FOREIGN KEY (work_id, assignment_id) REFERENCES crew.works (id, assignment_id),
  FOREIGN KEY (assignment_id, employee_id, work_type_id) REFERENCES crew.assignments (id, employee_id, work_type_id),
  FOREIGN KEY (guideline_id, employee_id, work_type_id) REFERENCES crew.guidelines (id, employee_id, work_type_id)
);

ALTER TABLE crew.guidelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.guideline_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.work_guidelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.guidelines FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.guideline_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.work_guidelines FORCE ROW LEVEL SECURITY;

-- 讀取：與 crew.level_decisions（0003）相同，看得到同一員工 × 同一工作類型的交辦才看得到守則；決定跟著守則；
-- 依照的守則跟著交件（外鍵保證交件與守則的員工 × 工作類型相同）
CREATE POLICY can_see ON crew.guidelines FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM crew.assignments a
    WHERE a.employee_id = guidelines.employee_id AND a.work_type_id = guidelines.work_type_id));
CREATE POLICY can_see ON crew.guideline_decisions FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.guidelines g WHERE g.id = guideline_decisions.guideline_id));
CREATE POLICY can_see ON crew.work_guidelines FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_guidelines.work_id));

-- 寫入：與寫入驗收相同，目前身分有 can_review、不能冒名、看得到範圍
CREATE POLICY propose ON crew.guidelines FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND (guidelines.proposer_kind = 'employee' OR guidelines.proposed_by = kk.current_identity_id())
    AND EXISTS (
      SELECT 1 FROM crew.assignments a
      WHERE a.employee_id = guidelines.employee_id AND a.work_type_id = guidelines.work_type_id)
    AND EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.id = guidelines.source_review_id));
CREATE POLICY decide ON crew.guideline_decisions FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND guideline_decisions.decided_by = kk.current_identity_id()
    AND EXISTS (SELECT 1 FROM crew.guidelines g WHERE g.id = guideline_decisions.guideline_id));
-- 只能依照交件當時生效的守則：交件時間以前確認、以前沒有收回
CREATE POLICY follow ON crew.work_guidelines FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (
      SELECT 1 FROM crew.works w
      WHERE w.id = work_guidelines.work_id
        AND EXISTS (
          SELECT 1 FROM crew.guideline_decisions d
          WHERE d.guideline_id = work_guidelines.guideline_id AND d.decision = 'confirm' AND d.decided_at <= w.submitted_at)
        AND NOT EXISTS (
          SELECT 1 FROM crew.guideline_decisions d
          WHERE d.guideline_id = work_guidelines.guideline_id AND d.decision = 'revoke' AND d.decided_at <= w.submitted_at)));

-- 沒有 UPDATE、DELETE；INSERT 以欄位層級授予，不含時間欄位與 source_eligible（指定時 permission denied）
GRANT SELECT ON crew.guidelines, crew.guideline_decisions, crew.work_guidelines TO kk_app;
GRANT INSERT (id, employee_id, work_type_id, text, source_review_id, source_work_id, source_assignment_id, proposer_kind, proposed_by)
  ON crew.guidelines TO kk_app;
GRANT INSERT (id, guideline_id, decision, revised_text, confirm_id, decided_by) ON crew.guideline_decisions TO kk_app;
GRANT INSERT (work_id, guideline_id, assignment_id, employee_id, work_type_id) ON crew.work_guidelines TO kk_app;
