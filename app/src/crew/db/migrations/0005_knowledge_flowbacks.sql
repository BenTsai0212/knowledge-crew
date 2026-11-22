-- 知識庫條目驗收通過後回流知識庫（#92 的計畫與 `## 決定`、ADR 0004 的 2026-11-22 修訂）。
-- 回流的文件與段落寫進 kk.documents／kk.passages，受 knowledge-kit 既有的上傳規則（0005_upload_write.sql）檢查；
-- 這裡只加來源的機密等級與「哪一次驗收回流成哪一份文件」的紀錄。以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式），欄位一律加表名。

-- 回流文件的機密等級：NULL 表示這個來源不回流；只有知識庫類的來源可以填
ALTER TABLE crew.sources ADD COLUMN knowledge_visibility_level_id text REFERENCES kk.visibility_levels (id);
ALTER TABLE crew.sources ADD CHECK (sources.knowledge_visibility_level_id IS NULL OR sources.kind = 'knowledge_base');

-- 一次驗收最多回流一份文件，一份文件只來自一次驗收；由驗收可推到工作、交辦與員工，不重複存
CREATE TABLE crew.knowledge_flowbacks (
  review_id text PRIMARY KEY REFERENCES crew.reviews (id),
  document_id text NOT NULL UNIQUE REFERENCES kk.documents (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crew.knowledge_flowbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.knowledge_flowbacks FORCE ROW LEVEL SECURITY;

-- 讀取：驗收看得到（crew 的 RLS），且文件看得到（knowledge-kit 的 RLS）
CREATE POLICY can_see ON crew.knowledge_flowbacks FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM crew.reviews rv WHERE rv.id = knowledge_flowbacks.review_id)
    AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = knowledge_flowbacks.document_id));

-- 新增：目前身分有 can_review；驗收是自己寫的「通過」；文件是自己上傳的、id 是 crew-<工作 id>，
-- 專案與機密等級等於工作來源的專案與回流等級（不能冒名、不能把別的文件記成回流）
CREATE POLICY flow_back ON crew.knowledge_flowbacks FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (
      SELECT 1 FROM crew.reviews rv
      JOIN crew.works w ON w.id = rv.work_id
      JOIN crew.assignments a ON a.id = w.assignment_id
      JOIN crew.sources s ON s.id = a.source_id
      JOIN kk.documents d ON d.id = knowledge_flowbacks.document_id
      WHERE rv.id = knowledge_flowbacks.review_id
        AND rv.verdict = 'accepted'
        AND rv.decided_by = kk.current_identity_id()
        AND d.id = 'crew-' || w.id
        AND d.uploaded_by = kk.current_identity_id()
        AND d.project_id = s.project_id
        AND d.visibility_level_id = s.knowledge_visibility_level_id));

-- 沒有 UPDATE、DELETE；INSERT 不含時間欄位（指定時 permission denied）
GRANT SELECT ON crew.knowledge_flowbacks TO kk_app;
GRANT INSERT (review_id, document_id) ON crew.knowledge_flowbacks TO kk_app;
