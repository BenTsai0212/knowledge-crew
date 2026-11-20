-- crew 的基本資料表（ADR 0004、#24）。全部屬於 kk_owner、ENABLE＋FORCE RLS；kk_app 只有 SELECT。
-- 寫入由 seed（superuser）匯入虛構資料；kk_app 的寫入權限在交辦與驗收的 migration 再定。
-- policy 以呼叫者權限執行（不使用 SECURITY DEFINER），欄位一律加表名（同 knowledge-kit 0002_rls.sql）

CREATE TABLE crew.repos (
  id text PRIMARY KEY,
  full_name text NOT NULL UNIQUE,                              -- 例如 example-org/lantern-notes（虛構）
  project_id text NOT NULL REFERENCES kk.projects (id)         -- 誰看得到由專案決定
);

CREATE TABLE crew.employees (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  -- 保留給第 4 階段的外部執行者；目前只允許 platform
  executor_type text NOT NULL DEFAULT 'platform' CHECK (executor_type IN ('platform')),
  role_note text
);

-- 工作類型（例如 ui、docs）；名稱放在介面文字
CREATE TABLE crew.work_types (
  id text PRIMARY KEY
);

ALTER TABLE crew.repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.repos FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.employees FORCE ROW LEVEL SECURITY;
ALTER TABLE crew.work_types FORCE ROW LEVEL SECURITY;

-- repo：目前身分的專案名單含該 repo 的專案（identity_projects 本身只看得到自己的列）
CREATE POLICY can_see ON crew.repos FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM kk.identity_projects ip
    WHERE ip.identity_id = kk.current_identity_id() AND ip.project_id = repos.project_id
  ));

-- 員工與工作類型不是機密：有目前身分就看得到
CREATE POLICY has_identity ON crew.employees FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id()));

CREATE POLICY has_identity ON crew.work_types FOR SELECT TO kk_app
  USING (EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id()));

GRANT USAGE ON SCHEMA crew TO kk_app;
-- 逐表授予（不用 ALL TABLES），之後的 migration 各自決定權限
GRANT SELECT ON crew.repos, crew.employees, crew.work_types TO kk_app;
