-- 守則進知識庫（輕量版，crew ADR 0007 決定 7，#149 的計畫與 `## 決定`）：守則確認時寫成一份知識庫文件，收回時不刪、不改文件。
-- 文件與段落寫進 kk.documents／kk.passages，受 knowledge-kit 既有的上傳規則檢查；這裡只加來源的守則機密等級與「守則 → 文件」的紀錄。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式、不建觸發器），欄位一律加表名；已合併的 migration 不修改，只新增。

-- 守則文件的機密等級：NULL 表示這個來源的守則不寫進知識庫（比照回流的 NULL＝不回流）；任何類型的來源都可以填
ALTER TABLE crew.sources ADD COLUMN guideline_visibility_level_id text REFERENCES kk.visibility_levels (id);

-- 一條守則最多一份文件，一份文件只來自一條守則；confirm_id 是寫入時依據的那筆確認。
-- 「沒有確認不能寫文件」以複合外鍵守住（confirm_decision 一定是 'confirm'，與 0007 的收回寫法相同），superuser 匯入 demo 時也擋得住
CREATE TABLE crew.guideline_documents (
  guideline_id text PRIMARY KEY REFERENCES crew.guidelines (id),
  document_id text NOT NULL UNIQUE REFERENCES kk.documents (id),
  confirm_id text NOT NULL,
  confirm_decision text NOT NULL GENERATED ALWAYS AS ('confirm') STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (guideline_documents.document_id = 'crew-guideline-' || guideline_documents.guideline_id),
  FOREIGN KEY (confirm_id, guideline_id, confirm_decision) REFERENCES crew.guideline_decisions (id, guideline_id, decision)
);

ALTER TABLE crew.guideline_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew.guideline_documents FORCE ROW LEVEL SECURITY;

-- 讀取：守則看得到（crew 0007 的 RLS），且文件看得到（knowledge-kit 的 RLS）
CREATE POLICY can_see ON crew.guideline_documents FOR SELECT TO kk_app
  USING (
    EXISTS (SELECT 1 FROM crew.guidelines g WHERE g.id = guideline_documents.guideline_id)
    AND EXISTS (SELECT 1 FROM kk.documents d WHERE d.id = guideline_documents.document_id));

-- 新增：目前身分有 can_review；確認是自己寫的；文件是自己上傳的，專案等於來源交辦的工作來源的專案、
-- 機密等級等於該來源的守則等級（不能冒名、不能把別的文件記成守則的文件）
CREATE POLICY write_document ON crew.guideline_documents FOR INSERT TO kk_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM kk.identities i WHERE i.id = kk.current_identity_id() AND i.can_review)
    AND EXISTS (
      SELECT 1 FROM crew.guideline_decisions gd
      JOIN crew.guidelines g ON g.id = gd.guideline_id
      JOIN crew.assignments a ON a.id = g.source_assignment_id
      JOIN crew.sources s ON s.id = a.source_id
      JOIN kk.documents d ON d.id = guideline_documents.document_id
      WHERE gd.id = guideline_documents.confirm_id
        AND gd.guideline_id = guideline_documents.guideline_id
        AND gd.decision = 'confirm'
        AND gd.decided_by = kk.current_identity_id()
        AND d.uploaded_by = kk.current_identity_id()
        AND d.project_id = s.project_id
        AND d.visibility_level_id = s.guideline_visibility_level_id));

-- 沒有 UPDATE、DELETE（收回不刪、不改文件）；INSERT 不含時間欄位（指定時 permission denied）
GRANT SELECT ON crew.guideline_documents TO kk_app;
GRANT INSERT (guideline_id, document_id, confirm_id) ON crew.guideline_documents TO kk_app;
