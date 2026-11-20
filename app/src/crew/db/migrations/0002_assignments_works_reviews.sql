-- crew 的交辦、工作與驗收（ADR 0004、#26）。全部屬於 kk_owner、ENABLE＋FORCE RLS；kk_app 只有 SELECT、INSERT（只新增不修改）。
-- policy 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式），欄位一律加表名。
-- 讀取經 crew.repos 的 RLS 判斷：子查詢裡的 crew.repos／crew.assignments／crew.works 同樣套用呼叫者的 policy。
-- 時間欄位一律由預設值 now() 填入：kk_app 的 INSERT 以欄位層級授予、不含時間欄位（信任規則依時間排序，#26 的 `## 決定`）。

CREATE TABLE crew.assignments (
  id text PRIMARY KEY,
  repo_id text NOT NULL REFERENCES crew.repos (id),
  issue_number integer NOT NULL CHECK (issue_number > 0),
  title text NOT NULL CHECK (title <> ''),
  work_type_id text NOT NULL REFERENCES crew.work_types (id),
  employee_id text NOT NULL REFERENCES crew.employees (id),
  assigned_by text NOT NULL DEFAULT kk.current_identity_id() REFERENCES kk.identities (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_id, issue_number)
);

-- 工作（＝PR）；退回後的下一版是 round + 1
CREATE TABLE crew.works (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES crew.assignments (id),
  round integer NOT NULL CHECK (round > 0),
  pr_number integer NOT NULL CHECK (pr_number > 0),
  summary text NOT NULL,
  body text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, round)
);

-- 員工標出的「要看的重點」
CREATE TABLE crew.work_points (
  work_id text NOT NULL REFERENCES crew.works (id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  text text NOT NULL CHECK (text <> ''),
  PRIMARY KEY (work_id, ordinal)
);

-- 重點以外的變更（#15 的 `## 決定` 補充）
CREATE TABLE crew.work_changes (
  work_id text NOT NULL REFERENCES crew.works (id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  path text NOT NULL CHECK (path <> ''),
  summary text NOT NULL,
  PRIMARY KEY (work_id, ordinal)
);

-- 自動檢查（＝CI）：保留狀態歷程，同一檢查可有多筆，目前狀態取 checked_at 最新、同時間時 id 最大的一筆
-- id 自動編號：同一交易內的 now() 相同，(work_id, name, checked_at) 會讓「先 pending 再 pass」在同一交易中衝突
CREATE TABLE crew.work_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_id text NOT NULL REFERENCES crew.works (id),
  name text NOT NULL CHECK (name <> ''),
  status text NOT NULL CHECK (status IN ('pass', 'fail', 'pending')),
  checked_at timestamptz NOT NULL DEFAULT now()
);

-- 驗收：一個工作只有一筆；退回原因三選一，只在退回時填
CREATE TABLE crew.reviews (
  id text PRIMARY KEY,
  work_id text NOT NULL UNIQUE REFERENCES crew.works (id),
  verdict text NOT NULL CHECK (verdict IN ('accepted', 'returned')),
  reason text CHECK (reason IN ('wrong', 'different_approach', 'process')),
  note text,
  decided_by text NOT NULL DEFAULT kk.current_identity_id() REFERENCES kk.identities (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviews.verdict = 'returned') = (reviews.reason IS NOT NULL))
);

-- 人對「少看」的同意與收回；「做錯了就改回逐項看」由規則從 reviews 推得，不存
CREATE TABLE crew.level_decisions (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES crew.employees (id),
  work_type_id text NOT NULL REFERENCES crew.work_types (id),
  decision text NOT NULL CHECK (decision IN ('relax', 'revoke')),
  basis_review_id text REFERENCES crew.reviews (id),
  decided_by text NOT NULL DEFAULT kk.current_identity_id() REFERENCES kk.identities (id),
  decided_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crew.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.work_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.work_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.work_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.level_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.works FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.work_points FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.work_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.work_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.level_decisions FORCE ROW LEVEL SECURITY;

-- 讀取：看得到 repo（crew.repos 的 can_see）→ 看得到交辦 → 看得到工作與其下的資料
CREATE POLICY can_see ON crew.assignments FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.repos r WHERE r.id = assignments.repo_id));
CREATE POLICY can_see ON crew.works FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.assignments a WHERE a.id = works.assignment_id));
CREATE POLICY can_see ON crew.work_points FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_points.work_id));
CREATE POLICY can_see ON crew.work_changes FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_changes.work_id));
CREATE POLICY can_see ON crew.work_checks FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_checks.work_id));
CREATE POLICY can_see ON crew.reviews FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.works w WHERE w.id = reviews.work_id));
-- 少看的決定：看得到該員工的任何交辦時可見
CREATE POLICY can_see ON crew.level_decisions FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM crew.assignments a WHERE a.employee_id = level_decisions.employee_id));

-- 新增：目前身分有 can_review（kk.identities 只看得到自己的列）、看得到該 repo、不能冒名
CREATE POLICY assign ON crew.assignments FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND assignments.assigned_by = kk.current_identity_id()
    AND EXISTS (SELECT 1 FROM crew.repos r WHERE r.id = assignments.repo_id));
-- demo 的「模擬員工交件」以目前身分寫入；第 1 階段改由 GitHub 同步以另一個角色寫入（另開 Issue）
CREATE POLICY submit ON crew.works FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (SELECT 1 FROM crew.assignments a WHERE a.id = works.assignment_id));
CREATE POLICY submit ON crew.work_points FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_points.work_id));
CREATE POLICY submit ON crew.work_changes FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_changes.work_id));
CREATE POLICY submit ON crew.work_checks FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (SELECT 1 FROM crew.works w WHERE w.id = work_checks.work_id));
CREATE POLICY decide ON crew.reviews FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND reviews.decided_by = kk.current_identity_id()
    AND EXISTS (SELECT 1 FROM crew.works w WHERE w.id = reviews.work_id));
-- 少看的決定：看得到該員工 × 該類工作的交辦；依據的驗收（有填時）必須看得到且屬於同一員工 × 同一類工作
CREATE POLICY decide ON crew.level_decisions FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND level_decisions.decided_by = kk.current_identity_id()
    AND EXISTS (
      SELECT 1 FROM crew.assignments a
      WHERE a.employee_id = level_decisions.employee_id AND a.work_type_id = level_decisions.work_type_id)
    AND (level_decisions.basis_review_id IS NULL OR EXISTS (
      SELECT 1 FROM crew.reviews rv
      JOIN crew.works w ON w.id = rv.work_id
      JOIN crew.assignments a ON a.id = w.assignment_id
      WHERE rv.id = level_decisions.basis_review_id
        AND a.employee_id = level_decisions.employee_id AND a.work_type_id = level_decisions.work_type_id)));

-- 逐表授予；沒有 UPDATE、DELETE。INSERT 以欄位層級授予，不含時間欄位（與 work_checks.id）：指定時 permission denied
GRANT SELECT ON crew.assignments, crew.works, crew.work_points, crew.work_changes, crew.work_checks,
  crew.reviews, crew.level_decisions TO kk_app;
GRANT INSERT (id, repo_id, issue_number, title, work_type_id, employee_id, assigned_by) ON crew.assignments TO kk_app;
GRANT INSERT (id, assignment_id, round, pr_number, summary, body) ON crew.works TO kk_app;
GRANT INSERT (work_id, ordinal, text) ON crew.work_points TO kk_app;
GRANT INSERT (work_id, ordinal, path, summary) ON crew.work_changes TO kk_app;
GRANT INSERT (work_id, name, status) ON crew.work_checks TO kk_app;
GRANT INSERT (id, work_id, verdict, reason, note, decided_by) ON crew.reviews TO kk_app;
GRANT INSERT (id, employee_id, work_type_id, decision, basis_review_id, decided_by) ON crew.level_decisions TO kk_app;
