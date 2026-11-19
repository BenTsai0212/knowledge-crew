# ADR 0002：以 knowledge-kit 為上游

- 狀態：Accepted
- 日期：2026-11-19
- 決定者：@BenTsai0212
- 相關：#5、RFC 0001「修訂」、取代 ADR 0001、knowledge-kit 的 `docs/workflow/fork.md`

## 背景

ADR 0001 決定只沿用 knowledge-kit 的技術組合，從空骨架開始。決定者隨後確定產品方向：knowledge-crew 建立在 knowledge-kit 之上，保留它的全部功能（RFC 0001「修訂」）。

knowledge-kit 是公開 repo，本身支援 fork（`docs/workflow/fork.md`）。它約有 756 個檔案，開發流程沿用 template 憲法 v0.20；knowledge-crew 是 v0.39。兩邊有 59 個同路徑的檔案，大多是開發流程的工具與文件。

## 選項

1. **持續同步上游**：把 knowledge-kit 連同 git 歷史合併進來，之後定期合併它的 `main`。
2. 一次複製某個 commit 的檔案，之後各自發展：knowledge-kit 之後的修正都要手動搬。
3. 直接在 knowledge-kit 的 repo 內開發：兩個產品、合作夥伴與授權難以分開。

## 決定

選項 1。

### 匯入與同步

- 上游是 `BenTsai0212/knowledge-kit` 的 `main`。第一次匯入以 commit `b4fb075` 為準，用 `git merge --allow-unrelated-histories`，保留 git 歷史。
- 匯入與之後每次同步都經 Issue → PR。這類 PR 以 **merge commit** 合併，不用 squash：squash 會失去共同祖先，下次同步會全部衝突。其他 PR 照舊 squash。
- 同步時機：開始新階段前，或 knowledge-kit 有需要的修正時，由決定者決定。

### 同路徑檔案的處理

| 類別 | 路徑 | 以哪邊為準 |
| --- | --- | --- |
| 產品程式與設定 | `app/`、`worker/`、`client/`、`clients/`、`e2e/`、`scripts/`、`package.json`、`package-lock.json`、Vite／Vitest／Playwright 設定、`wrangler.jsonc`、`.github/workflows/` 的 `ci.yml`、`e2e.yml`、`sensitive.yml` | knowledge-kit |
| 開發流程 | `AGENTS.md`、`CLAUDE.md`、`docs/workflow/`、`tools/workflow/`、`.claude/`、`templates/`、`.github/` 的 Issue／PR 範本、`labels.yml`、`workflows/pr-body.yml` | knowledge-crew（憲法 v0.39） |
| README | `README.md` | knowledge-crew 自己的版本，第一句講清楚定位，並註明建立在 knowledge-kit 之上 |
| 兩邊合併 | `.gitignore` | 取聯集 |
| 授權 | `LICENSE` | 沿用 knowledge-kit 的 MIT，保留原著作權聲明，另加一行 knowledge-crew 的聲明（`fork.md`） |

- knowledge-kit 獨有的檔案原樣保留。
- `AGENTS.md` 以 knowledge-crew 的版本為底，第 2、3 節（指令、結構）改寫成匯入後的實際內容，並吸收 knowledge-kit `AGENTS.md` 中與產品相關的規則。

### 決策紀錄的位置

- knowledge-kit 的 `docs/adr/`、`docs/rfcs/` 原樣保留並隨同步更新。其中的決定（核准套件、偵測工具、部署等）對 knowledge-crew 同樣有效，除非 knowledge-crew 的 ADR 另有決定。
- knowledge-crew 自己的 RFC、ADR 放在 `docs/crew/rfcs/`、`docs/crew/adr/`，另外編號。

### 新程式的位置

- knowledge-crew 新增的程式放在自己的目錄（例如 `app/src/crew/` 與對應的測試）。
- 需要改 knowledge-kit 的檔案時，改動要小，並在 PR 描述列出（同步時要處理）。
- 通用的改進先在 knowledge-kit 做，再同步過來。

### 取代 ADR 0001 的部分

- 技術組合、核准套件、偵測工具、部署：改以 knowledge-kit 的 ADR 為準。
- ADR 0001「與 knowledge-kit 不同之處」不再適用：Worker、模型呼叫、邀請碼與費用上限都隨匯入保留；是否部署能呼叫模型的 knowledge-crew demo，另行決定。
- ADR 0001「一併記錄的專案設定」（repo 公開、coding agent 以雲端執行模組運作）維持不變。

## 後果

- 好處：一開始就有 knowledge-kit 的全部功能、CI 與設計系統；knowledge-kit 的改進可以持續流入；fork 的步驟已有文件。
- 代價：
  - 每次同步都可能衝突，特別是 knowledge-kit 升級 template 時的開發流程檔。
  - 約一半的程式與 AI 員工無關，agent 修改前要分清範圍（寫進 `AGENTS.md`）。
  - 匯入 PR 遠超過 400 行；審查改以程式比對「knowledge-kit 獨有的檔案未被修改」。
  - knowledge-kit 的必要檢查（`checks`、`clients`、`sensitive-names`、`gitleaks`、`pr-body`）要在本 repo 的 ruleset 補上（人工）。
- 後續工作：匯入（`plan-first`）；照 `fork.md` 補設定（LICENSE、README、SECURITY、`SENSITIVE_NAMES`、ruleset 的必要檢查、Actions 外部貢獻者核准）；重排第一批 Issue。
