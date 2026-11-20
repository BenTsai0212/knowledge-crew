# ADR 0004：crew 的資料層與擴充點

- 狀態：Accepted
- 日期：2026-11-20
- 決定者：@BenTsai0212
- 相關：#18、#15 的計畫與 `## 決定`、ADR 0002、ADR 0003

## 背景

第 0 階段要在 knowledge-kit 之上加 AI 員工的資料與畫面（RFC 0001「修訂」）。ADR 0002 要求 knowledge-crew 的新程式放在自己的目錄、盡量少改 knowledge-kit 的檔案；ADR 0003 啟用高風險模組。#15 的計畫提出資料層與擴充點的做法，決定者在 `## 決定` 同意並調整。

## 選項

- **資料表的位置**：1. 新的 schema `crew`；2. 放在 knowledge-kit 的 `kk` schema（要改它的資料表清單測試，第 1 階段搬到私人 repo 時也要拆開）。
- **migration**：1. 放在 `app/src/crew/db/migrations/`、自己編號，版本加上 `crew/` 前綴，與 knowledge-kit 共用 `kk_meta.schema_migrations` 與 checksum；2. 放在 knowledge-kit 的 `app/src/db/migrations/` 接續編號（同步上游時會撞號）。
- **介面文字的讀取**：A. 在 knowledge-kit 的 `app/src/client/i18n.ts` 加讀取函式，最好先在 knowledge-kit 做成通用機制；B. 讀取放在 `app/src/crew/i18n.ts`，knowledge-kit 的 `app/src/client/i18n.test.ts` 允許清單加一行。

## 決定

- **資料表**：選項 1，schema `crew`。
  - 資料表：`repos`、`employees`、`work_types`、`assignments`、`works`、`work_points`、`work_changes`、`work_checks`、`reviews`、`level_decisions`（欄位見 #15 計畫第 1 節；`work_changes` 為 `## 決定` 補充的變更清單）。
  - 全部屬於 `kk_owner`，ENABLE＋FORCE RLS；`kk_app` 只有 SELECT／INSERT，只新增不修改，目前狀態由最新一筆推得。
  - RLS 以呼叫者權限執行，不使用 SECURITY DEFINER。讀取經 repo 所屬的 `kk.projects` 與 `kk.identity_projects` 判斷；寫入要求 `kk.identities.can_review`、看得到該 repo，且 `assigned_by`／`decided_by` 等於目前身分。
  - `employees.executor_type` 保留給第 4 階段的外部執行者，目前只允許 `platform`。
- **migration**：選項 1。在 knowledge-kit 的 migration 之後套用；只依賴 knowledge-kit 的基本資料表（`kk.identities`、`kk.identity_projects`、`kk.projects`、`kk.current_identity_id()`）。已合併的 crew migration 同樣不可修改（ADR 0003）。
- **介面文字**：選項 B。翻譯檔放 `client/i18n/crew/<畫面>.<語言>.json`，一個畫面一份；knowledge-kit 的 `client/i18n/<語言>.json` 不改。
- **虛構資料**：`client/crew/demo.json`，經 `@client` 讀取；畫面標示為虛構資料。
- **信任規則**：純函式放在 `app/src/crew/trust/`；`demo-params.ts` 只放示範用的虛構數值，實際參數放私人 repo（RFC 0001）。
- **畫面入口**：在 knowledge-kit 的頁籤加「AI 員工」（view `crew`），內有自己的子導覽（今天、員工、交辦、工作與驗收、信任，以及工作帳本）。展示模式不顯示；沒有 `client/crew/demo.json` 的客戶不顯示。這是產品頁籤，不是營運開關。
- **會改的 knowledge-kit 檔案**限於：`app/src/db/database.ts`（`crew` schema 與 `migrations` 選項）、`app/src/App.tsx`、`app/src/ui/online-demo.ts`、`app/src/ui/Sidebar.tsx`、`app/src/ui/layout.ts`、`vitest.config.ts`、`app/src/client/i18n.test.ts`（允許清單一行）、`docs/structure.md`（新增 crew 的小節）。其他 knowledge-kit 檔案需要修改時先問人；相關 Issue 加 `area:upstream`。

## 後果

- 好處：crew 的資料與 knowledge-kit 分開，同步上游不會撞號；第 1 階段可以整包搬到私人 repo；越權規則與 knowledge-kit 一致。
- 代價：knowledge-kit 改到上述檔案時，同步要處理衝突；crew 讀翻譯檔的方式與 knowledge-kit 不同，knowledge-kit 之後若做出通用機制，要再調整。
- 後續工作：#15 計畫第 8 節的 Issue（B～L）。
