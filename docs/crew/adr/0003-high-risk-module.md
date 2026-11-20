# ADR 0003：啟用高風險模組

- 狀態：Accepted
- 日期：2026-11-20
- 決定者：@BenTsai0212
- 相關：#14、#7 的 `## 決定`（D）、ADR 0002、`docs/workflow/modules.md`「高風險」

## 背景

匯入 knowledge-kit（#7、PR #8）後，本 repo 有 PGlite 的 migration（`app/src/db/`）、RLS 與資料庫角色切換。knowledge-kit 啟用了高風險模組，相關規則已在匯入時寫進 `AGENTS.md` 第 5 節。`docs/workflow/modules.md` 規定啟用模組要寫 ADR，本 ADR 補上這份紀錄。

## 選項

1. 啟用高風險模組，與 knowledge-kit 一致。
2. 不啟用：migration 與 RLS 的規則只靠 `AGENTS.md`，資料庫相關的 Issue 不強制 `plan-first`。

## 決定

選項 1（決定者在 #7 的 `## 決定` D 同意）。

- 資料庫 schema、migration、RLS 與權限相關的 Issue 一律加 `plan-first`。
- 規則沿用 `AGENTS.md` 第 5 節：不修改已合併的 migration；migration 不隨部署自動套用到持久化的資料庫；營運開關預設關閉；切換資料庫角色或關閉 RLS 的語句只寫在 `app/src/db/database.ts`。
- 防護沿用 knowledge-kit 的做法：`migrate.ts` 比對 migration 的 checksum；Vitest 以 PGlite（真正的 Postgres）測試資料層與權限。
- knowledge-crew 新增的資料表與 migration 同樣適用；編號方式在第 0 階段的實作計畫（#15）中決定。

## 後果

- 好處：與 knowledge-kit 一致；AI 員工的資料表從一開始就有 RLS 與越權測試。
- 代價：資料庫相關的 Issue 多一輪計畫審查。
- 後續工作：確認 CI 是否另外比對「已合併的 migration 未被修改」（`modules.md` 高風險模組的防護項目）；沒有時另開 Issue。
