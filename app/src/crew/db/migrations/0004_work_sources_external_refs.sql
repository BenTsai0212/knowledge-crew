-- 工作來源與外部編號（#57、RFC 0001 的 2026-11-21 修訂）：crew.repos → crew.sources（有類型），Issue／PR 編號 → 外部編號（文字、可以為空）。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式），欄位一律加表名；在 applyMigrations() 的同一交易中套用。
-- policy 不重建：policy 存的是解析後的表與欄位參照，改名後照常生效；改型別的欄位沒有被 policy 參照，規則不變。
-- 欄位層級 GRANT 記在欄位上，改名與改型別後沿用（kk_app 的 INSERT 含 source_id、external_ref）；FORCE RLS 沿用。
-- 既有資料：既有的 repo 成為 kind = 'repo'；Issue／PR 編號轉成十進位文字（116 → '116'），值與唯一性不變。

-- 工作來源
ALTER TABLE crew.repos RENAME TO sources;
ALTER TABLE crew.sources RENAME COLUMN full_name TO name;
ALTER TABLE crew.sources RENAME CONSTRAINT repos_full_name_key TO sources_name_key;
-- 預設值只用於轉換既有列，之後新增的來源一定要指定類型
ALTER TABLE crew.sources ADD COLUMN kind text NOT NULL DEFAULT 'repo'
  CHECK (sources.kind IN ('repo', 'mailbox', 'social', 'knowledge_base'));
ALTER TABLE crew.sources ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE crew.sources ADD CHECK (sources.name <> '');

-- 交辦的外部編號（repo 類是 Issue 編號）；沒有編號一律是 NULL，UNIQUE 把 NULL 視為互不相同
ALTER TABLE crew.assignments RENAME COLUMN repo_id TO source_id;
ALTER TABLE crew.assignments DROP CONSTRAINT assignments_issue_number_check;
ALTER TABLE crew.assignments RENAME COLUMN issue_number TO external_ref;
ALTER TABLE crew.assignments ALTER COLUMN external_ref TYPE text USING assignments.external_ref::text;
ALTER TABLE crew.assignments ALTER COLUMN external_ref DROP NOT NULL;
ALTER TABLE crew.assignments ADD CHECK (assignments.external_ref <> '');
ALTER TABLE crew.assignments RENAME CONSTRAINT assignments_repo_id_issue_number_key TO assignments_source_id_external_ref_key;

-- 工作的外部編號（repo 類是 PR 編號）；同一來源內不重複由程式與 validate.ts 保證（#57 的 `## 決定` 1）
ALTER TABLE crew.works DROP CONSTRAINT works_pr_number_check;
ALTER TABLE crew.works RENAME COLUMN pr_number TO external_ref;
ALTER TABLE crew.works ALTER COLUMN external_ref TYPE text USING works.external_ref::text;
ALTER TABLE crew.works ALTER COLUMN external_ref DROP NOT NULL;
ALTER TABLE crew.works ADD CHECK (works.external_ref <> '');
