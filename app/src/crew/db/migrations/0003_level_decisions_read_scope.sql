-- 收緊少看的決定的讀取（#49）：與 decide（INSERT）的條件一致，看得到同一員工 × 同一工作類型的交辦才可見。
-- 以呼叫者權限執行（不使用 SECURITY DEFINER、不建函式），欄位一律加表名；子查詢的 crew.assignments 套用呼叫者的 policy。
-- 兩句在 applyMigrations() 的同一交易中套用，不會出現沒有 SELECT policy 的中間狀態。GRANT 與 FORCE RLS 沿用 0002。
DROP POLICY can_see ON crew.level_decisions;
CREATE POLICY can_see ON crew.level_decisions FOR SELECT TO kk_app
  USING (EXISTS (
    SELECT 1 FROM crew.assignments a
    WHERE a.employee_id = level_decisions.employee_id AND a.work_type_id = level_decisions.work_type_id));
