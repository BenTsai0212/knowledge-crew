# ADR 0001：技術選型（第 0 階段）

- 狀態：Accepted
- 日期：2026-11-19
- 決定者：@BenTsai0212
- 相關：#3、RFC 0001、[knowledge-kit](https://github.com/BenTsai0212/knowledge-kit) 的 ADR 0001、0004、0005、0008、0010

## 背景

RFC 0001 的第 0 階段是公開 demo：五個畫面（今天、員工、交辦、工作與驗收、信任）與工作帳本，只用虛構資料。第 1 階段開私人 repo `knowledge-crew-ops` 時，資料結構與 SQL 要能直接沿用到真正的 Postgres。

knowledge-crew 從 knowledge-kit 延伸出來，兩者由同一位決定者維護，視覺（「墨與螢光」）、資料庫做法（Postgres、RLS、migration）與將來的資料（第 2 階段補匯入的 258 筆 PR）都相關。knowledge-kit 已經以 ADR 走過一輪同樣的選型並實際運作。

## 選項

1. **沿用 knowledge-kit 的技術組合**（Vite＋React＋TypeScript＋PGlite、Cloudflare Worker 靜態檔、同一套檢查工具），只記錄不同之處。
2. Vite＋React＋PGlite，另加 React Router、ESLint，部署到 Cloudflare Pages（每個 PR 有預覽網址）。
3. Next.js 靜態輸出，資料寫死在 JSON。
4. 直接用設計稿的 HTML 加 JSON，不用框架。

## 決定

選項 1。原則：技術組合預設與 knowledge-kit 一致；只有第 0 階段的需求不同時才分開，並寫在本 ADR。

| 項目 | 決定 |
| --- | --- |
| 前端 | Vite＋TypeScript＋React，放在 `app/`，build 輸出到 `dist/`；不使用路由套件 |
| 瀏覽器內資料庫 | `@electric-sql/pglite`；資料結構以 Postgres DDL 撰寫，第 1 階段原樣搬到私人 repo |
| 資料 | 只有虛構資料，由程式在瀏覽器內建立；畫面上標示為虛構資料 |
| 部署 | Cloudflare Worker 只提供靜態檔（`wrangler.jsonc` 的 assets，`not_found_handling` 為 `single-page-application`），網址用 workers.dev 子網域；部署與回退由人以 `wrangler deploy` 手動執行，CI 不放部署用的 secret（同 knowledge-kit ADR 0005 的選項 1） |
| 套件管理 | npm，Node 22，提交 lockfile；版本與 knowledge-kit 的 `package.json` 對齊 |
| 設計 token | 從 knowledge-kit 的 `docs/design.md` 複製「顏色 token」等定義，註明來源 commit；第 0 階段先做 Light（墨與螢光）。兩邊的 token 需要持續同步時，再評估抽成共用套件 |

### 核准的套件

- 執行：`react`、`react-dom`、`@electric-sql/pglite`
- 開發與建置：`vite`、`@vitejs/plugin-react`、`typescript`、`@types/react`、`@types/react-dom`、`wrangler`
- 測試：`vitest`、`@playwright/test`

新增此清單以外的套件，依 `AGENTS.md` 第 6 節先問人。

### 偵測工具（全部進 CI）

- `tsc --noEmit` 型別檢查。
- Vitest：資料結構與 SQL（在 Node 中以 PGlite 執行）、虛構資料的產生、信任規則等純函式。
- Playwright 冒煙測試：五個畫面與工作帳本都能載入，以及「交辦 → 驗收 → 退回 → 信任變化」一次走完。只裝 Chromium；在 PR（目標 `main`）與 push 到 `main` 時執行，不列為必要檢查（同 knowledge-kit ADR 0010）。截圖以 HTML 報告上傳，供審查畫面。只在 CI 執行，不寫成 coding agent 的驗收條件。
- 敏感資料檢查：`tools/workflow/check-sensitive.mjs`。禁用名稱在 CI 從 repo secret `SENSITIVE_NAMES` 讀取（寫到暫存檔，以 `WORKFLOW_DENIED_NAMES_FILE` 指定），讀不到時 CI 失敗；本機仍讀不進版本控制的 `tools/workflow/denied-names.local.txt`。
- gitleaks：版本、下載網址與 SHA-256 沿用 knowledge-kit ADR 0004 的查證結果，在 workflow 中以 `sha256sum -c` 驗證後執行。
- 既有的 workflow 工具測試（`npm test --prefix tools/workflow`）。

### 與 knowledge-kit 不同之處

- 不使用 Worker API、模型呼叫、邀請碼與費用上限：第 0 階段沒有伺服器端功能。
- 不使用 `cytoscape`、文件解析與語意檢索套件：第 0 階段用不到。
- 禁用名稱的 CI secret 另有一個用途：coding agent 在雲端執行時沒有本機清單，CI 補上這項檢查。

### 一併記錄的專案設定

- **repo 公開**：只放畫面、虛構資料的 demo、概念與設計文件；真實資料庫、串接、規則參數與真實紀錄放私人 repo（RFC 0001「兩個 repo 的邊界」）。
- **coding agent 以雲端執行模組運作**（`docs/workflow/modules.md`「雲端執行」）：GitHub 的標籤事件觸發雲端排程任務，不需要開著本機電腦。

## 後果

- 好處：兩個專案用同一套技術與檢查，決定者與 coding agent 不用切換；資料結構在第 1 階段可以直接沿用；knowledge-kit 已查證過的工具（gitleaks、Playwright）不必重做。
- 代價：
  - 沒有每個 PR 的預覽網址；審查畫面靠 CI 的 Playwright 截圖，或由人部署後查看。
  - PGlite 的 WASM 約 3MB，首次載入較慢；虛構資料量小，影響有限。
  - 設計 token 是複製的，knowledge-kit 改了不會自動同步。
  - 每個 PR 都要下載 Chromium，CI 時間變長。
- 後續工作（各自開 Issue）：建立 `package.json` 與 `app/` 骨架；`ci.yml` 填入上述檢查（含人工待辦：設定 `SENSITIVE_NAMES` secret）；`wrangler.jsonc` 與部署步驟文件；複製設計 token。
- 重新檢討的條件：需要每個 PR 的預覽網址、改成自動部署，或第 1 階段需要伺服器端功能時。
