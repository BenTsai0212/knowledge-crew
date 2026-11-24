-- 交辦的到期日與優先順序（#133）：專案管理「總覽」分頁的資料。既有 migration 不修改，只新增欄位。
-- RLS 不變（policy 不參照這兩欄）；kk_app 的 INSERT 欄位授權加入這兩欄，仍沒有 UPDATE、DELETE（只新增不修改）。

-- 到期日：只有日期，可以為空（沒有到期日）
ALTER TABLE crew.assignments ADD COLUMN due_at date;
-- 優先順序：三選一，沒有指定時是 normal；既有列由預設值填入
ALTER TABLE crew.assignments ADD COLUMN priority text NOT NULL DEFAULT 'normal'
  CHECK (assignments.priority IN ('high', 'normal', 'low'));

GRANT INSERT (due_at, priority) ON crew.assignments TO kk_app;
