-- 讓放手站得住（crew ADR 0008、#161 的計畫與 `## 決定`）：事後更正、逐條回饋、退回的「沒被標成重點」，以及更正記成守則。
-- 抽查不存（ADR 0008 第 7 點），由信任規則從交件、驗收、層級決定與更正推算。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式、不建觸發器），欄位一律加表名；已合併的 migration 不修改，只新增。
-- 對象的規則以 CHECK 與複合外鍵守住（superuser 匯入 demo 時也擋得住）；「時間不能早於驗收」「只能在驗收的同一交易寫入」
-- 由寫入 policy 守住，demo 以 superuser 匯入時不套用 RLS，改由 demo 的驗證（validate.ts）檢查。

-- 供外鍵參照的 UNIQUE（id 已是主鍵，加上其他欄位仍唯一）
ALTER TABLE crew.reviews ADD UNIQUE (id, verdict);
ALTER TABLE crew.reviews ADD UNIQUE (id, work_id);

-- 退回時「這個錯沒有被標成重點」（第 15 點）：只在原因是「做錯了」時可以為 true
ALTER TABLE crew.reviews ADD COLUMN not_in_points boolean NOT NULL DEFAULT false
  CHECK (NOT reviews.not_in_points OR coalesce(reviews.reason = 'wrong', false));

-- 事後更正（第 1～6、15 點）：只能更正通過的驗收（複合外鍵指向 verdict = 'accepted'），一次驗收最多一筆
CREATE TABLE crew.review_corrections (
  id text PRIMARY KEY,
  review_id text NOT NULL UNIQUE,
  review_verdict text NOT NULL DEFAULT 'accepted' CHECK (review_corrections.review_verdict = 'accepted'),
  note text,
  not_in_points boolean NOT NULL DEFAULT false,
  -- 能記成守則：備註不是空白（比照 0007 的 reviews.can_be_guideline）
  can_be_guideline boolean NOT NULL GENERATED ALWAYS AS (coalesce(btrim(review_corrections.note), '') <> '') STORED,
  corrected_by text NOT NULL DEFAULT kk.current_identity_id() REFERENCES kk.identities (id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, review_verdict) REFERENCES crew.reviews (id, verdict),
  UNIQUE (id, review_id, can_be_guideline)
);

-- 逐條回饋（第 12～13 點）：對象是該次交件的重點或該次交件依照的守則，同一對象最多一筆
CREATE TABLE crew.review_feedback (
  review_id text NOT NULL,
  work_id text NOT NULL,
  target_kind text NOT NULL CHECK (review_feedback.target_kind IN ('point', 'guideline')),
  point_ordinal integer,
  guideline_id text,
  result text NOT NULL,
  CHECK ((review_feedback.target_kind = 'point') = (review_feedback.point_ordinal IS NOT NULL)),
  CHECK ((review_feedback.target_kind = 'guideline') = (review_feedback.guideline_id IS NOT NULL)),
  CHECK (CASE review_feedback.target_kind
    WHEN 'point' THEN review_feedback.result IN ('ok', 'problem')
    ELSE review_feedback.result IN ('done', 'not_done') END),
  FOREIGN KEY (review_id, work_id) REFERENCES crew.reviews (id, work_id),
  FOREIGN KEY (work_id, point_ordinal) REFERENCES crew.work_points (work_id, ordinal),
  FOREIGN KEY (work_id, guideline_id) REFERENCES crew.work_guidelines (work_id, guideline_id)
);
CREATE UNIQUE INDEX review_feedback_point_once ON crew.review_feedback (review_id, point_ordinal) WHERE target_kind = 'point';
CREATE UNIQUE INDEX review_feedback_guideline_once ON crew.review_feedback (review_id, guideline_id) WHERE target_kind = 'guideline';

-- 更正記成守則（第 6 點）：守則的來源可以是退回（0007）或事後更正。更正來源時 source_eligible 是 NULL，
-- 0007 的複合外鍵（MATCH SIMPLE）不檢查；改由更正的複合外鍵守住「備註不是空白」，另加外鍵保住驗收與交件的對應
ALTER TABLE crew.guidelines ALTER COLUMN source_eligible DROP NOT NULL;
ALTER TABLE crew.guidelines ADD COLUMN source_correction_id text;
ALTER TABLE crew.guidelines ADD COLUMN source_correction_eligible boolean
  GENERATED ALWAYS AS (CASE WHEN source_correction_id IS NOT NULL THEN true END) STORED;
ALTER TABLE crew.guidelines ADD CHECK ((guidelines.source_correction_id IS NULL) = (guidelines.source_eligible IS NOT NULL));
ALTER TABLE crew.guidelines ADD FOREIGN KEY (source_correction_id, source_review_id, source_correction_eligible)
  REFERENCES crew.review_corrections (id, review_id, can_be_guideline);
ALTER TABLE crew.guidelines ADD FOREIGN KEY (source_review_id, source_work_id) REFERENCES crew.reviews (id, work_id);

ALTER TABLE crew.review_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.review_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.review_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.review_feedback FORCE ROW LEVEL SECURITY;

-- 讀取：比照 crew.reviews，看得到該次驗收才看得到
CREATE POLICY can_see ON crew.review_corrections FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.id = review_corrections.review_id));
CREATE POLICY can_see ON crew.review_feedback FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.id = review_feedback.review_id));

-- 更正：目前身分有 can_review、不能冒名、看得到該次驗收、時間不早於驗收（kk_app 的時間一律是 now()）
CREATE POLICY correct ON crew.review_corrections FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND review_corrections.corrected_by = kk.current_identity_id()
    AND EXISTS (
      SELECT 1 FROM crew.reviews rv
      WHERE rv.id = review_corrections.review_id AND rv.decided_at <= review_corrections.corrected_at));
-- 逐條回饋：只能在驗收的同一交易寫入（驗收的 decided_at 是同一交易的 now()），驗收是自己寫的；之後不能補
CREATE POLICY give ON crew.review_feedback FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (
      SELECT 1 FROM crew.reviews rv
      WHERE rv.id = review_feedback.review_id AND rv.decided_by = kk.current_identity_id() AND rv.decided_at = now()));

-- 沒有 UPDATE、DELETE；INSERT 以欄位層級授予，不含時間欄位與生成欄位（指定時 permission denied）
GRANT SELECT ON crew.review_corrections, crew.review_feedback TO kk_app;
GRANT INSERT (id, review_id, note, not_in_points, corrected_by) ON crew.review_corrections TO kk_app;
GRANT INSERT (review_id, work_id, target_kind, point_ordinal, guideline_id, result) ON crew.review_feedback TO kk_app;
GRANT INSERT (not_in_points) ON crew.reviews TO kk_app;
-- 更正來源的守則：kk_app 只能給 source_eligible NULL（或 0007 的 true；false 被 CHECK 擋住）
GRANT INSERT (source_correction_id, source_eligible) ON crew.guidelines TO kk_app;
