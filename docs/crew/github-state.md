# GitHub 狀態對照

> 本文件是參考用：連 GitHub 與連線後的畫面不在本 repo 實作，由另外的專案負責（[RFC 0001](rfcs/0001-project-charter.md) 2026-11-23 修訂）。

平台從 GitHub 讀回一張交辦（一張 Issue）的狀態時，用的資料格式與對照規則（#110；決定見 #108 的第 5、8 點與 D6、D11）。程式是 `app/src/crew/github/state.ts` 的 `deriveGithubState()`，本文件與它的單元測試（`state.test.ts`）一致；改其中一方時另一方一起改。

- **GitHub 為準**：平台不自己記狀態的變化，每次讀回都從 GitHub 的現況與時間軸**重新推出**（不累加差異，D6）。
- **同一個函式**也用在門檻的比對報表（D11）：報表以 GitHub API 重新推一次轉換序列，與平台的事件紀錄逐筆比對。
- 純函式：不呼叫 API、不讀資料庫、不產生介面文字；畫面上的文字由呼叫端依結果決定。

## 輸入

一次讀回的結果 `ReadResult`：

- 成功：`{ ok: true, snapshot, readAt }`。`snapshot` 的欄位照 GitHub REST API 的形狀（`app/src/crew/github/types.ts`，只列用到的欄位）：

  | 欄位 | 來源 |
  | --- | --- |
  | `issue` | `GET /repos/{owner}/{repo}/issues/{n}`：`state`、`state_reason`、`labels`、`created_at` |
  | `timeline` | `GET /repos/{owner}/{repo}/issues/{n}/timeline`：只用 `labeled`、`unlabeled`、`closed`、`reopened` |
  | `comments` | `GET /repos/{owner}/{repo}/issues/{n}/comments`：只用 `author_association` 是 `OWNER`、`MEMBER`、`COLLABORATOR` 的 |
  | `pulls[].pull` | `GET /repos/{owner}/{repo}/pulls` 的一筆：本文寫 `Closes`／`Fixes`／`Resolves`／`Refs #n` 的才算連到這張 Issue |
  | `pulls[].timeline` | PR 的時間軸（同 `issues/{pr}/timeline`），推出 PR 標籤的變化 |
  | `pulls[].checkRuns` | `GET /repos/{owner}/{repo}/commits/{head.sha}/check-runs` 的 `check_runs` |

- 失敗：`{ ok: false, reason, attemptedAt, previous }`。`reason` 是 `timeout`、`rate-limited`、`unauthorized`、`other`；`previous` 是上一次的結果（沒有時是 `null`）。

**順序與重複**：時間軸、留言、PR、檢查的順序不影響結果，重複的項目只算一次（時間軸以 `id`、事件、時間、標籤判斷，留言以 `id`，PR 以編號；同名的檢查取 `id` 最大的一次）。

## 輸出

| 欄位 | 內容 |
| --- | --- |
| `state` | 現在的平台狀態（下表），由 GitHub 的現況欄位推出；從沒讀到過時是 `null` |
| `transitions` | 狀態轉換序列 `{ state, at }`：在時間軸上每個有事情發生的時間點重新推一次，與上一個不同才記 |
| `works` | 每個連到 Issue 的 PR 一筆：`pull`、`link`（`closes`／`refs`）、`state`（`delivered`／`returned`／`accepted`／`void`）、`checks` |
| `flags` | 已知狀況（後述） |
| `readAt` | 最後一次成功讀回的時間 |

## 對照表

| GitHub 上的事實 | 平台狀態 |
| --- | --- |
| Issue 已建立、沒有 `agent:ready` | `created`：已建立、未派工 |
| 有 `agent:ready` | `ready`：等待接手 |
| 有 `agent:working`（應有開工留言） | `working`：進行中 |
| 有 `plan-first`＋`blocked`，最後一則 `## 計畫`／`## 決定` 是 `## 計畫` | `plan-review`：計畫待審 |
| Issue 或開啟中的 PR 有 `blocked`（不是上一列） | `blocked`：員工停下、等決定 |
| 有連到 Issue 的開啟中 PR | `delivered`：已交件 |
| PR 的檢查 | `works[].checks`：`{ name, result }`，未完成是 `pending`，`success`／`neutral`／`skipped` 是 `pass`，其他是 `fail` |
| 開啟中的 PR 有 `changes-requested` | `returned`：已退回、修正中 |
| 最後開的 PR 已合併（Issue 仍開著，例如 `Refs` 的 PR） | `accepted`：驗收通過 |
| 最後開的 PR 未合併就關閉 | `void`：作廢（不計入信任） |
| Issue 關閉（`completed`，或沒有 `state_reason`） | `done`：完成 |
| Issue 關閉（`not_planned`） | `cancelled`：取消 |

**判斷順序**（多列同時成立時取第一個）：關閉 → `blocked` → 開啟中的 PR → `agent:working` → `agent:ready` → 最後開的 PR 的結果 → `created`。

- 計畫待審不看「加上 `blocked` 之後」：agent 先留 `## 計畫` 再加 `blocked`（agent-workflow.md 第 2 步），所以改看計畫之後有沒有 `## 決定`。
- `Closes` 的 PR 合併時 Issue 同時關閉，序列直接到 `done`；關閉晚於合併時是 `accepted` → `done`。
- 標題中文與英文（`## 開工（#N）`／`## Started (#N)`、`## 計畫`／`## Plan`、`## 決定`／`## Decision`）都認得（`docs/workflow/headings.md`）。

## 已知狀況

| `flags[].kind` | 條件 | 平台的處理 |
| --- | --- | --- |
| `possibly-stuck` | 現在有 `agent:working`、沒有開啟中的 PR，最後一次加上 `agent:working` 超過 2 小時（`since` 是加上的時間） | 標「可能卡住」，處理由人決定（與 `decision-center.md` 第 11 節第 2 項同一條件） |
| `duplicate-start` | 最後一次加上 `agent:ready` 之後，有 2 則以上這張 Issue 的開工留言（`comments` 是留言 id）；之前的派工留下的不算 | 標「重複開工」 |
| `duplicate-pulls` | 2 個以上連到 Issue 的開啟中 PR（`pulls` 全部列出） | 標「可能重複」，不自動選一個 |
| `split` | 有 `Refs` 的 PR：一張 Issue 拆成多個 PR（`closes`、`refs` 各列編號） | 每個 PR 是一筆工作；最後的 `Closes` PR 合併、Issue 關閉才算完成 |
| `pending-todo` | 完成，但 `needs-human` 還在 | 顯示「有合併後待辦」 |
| `read-failed` | 讀回失敗（`reason`、`at` 是嘗試的時間） | 沿用上一次的 `state`、`transitions`、`works`、`readAt`，只換上這個標記；不改狀態 |
| `needs-human` | 對不上（`codes`）：`working-without-start`（有 `agent:working`，這次派工之後卻沒有開工留言）、`timeline-differs`（時間軸推出的最後狀態與現況不同） | 標「需要人看」，列出看到的事實；**不自動修正 GitHub** |

不可信身分（`author_association` 不是 `OWNER`、`MEMBER`、`COLLABORATOR`）的留言一律不看：不算開工留言、計畫或決定。
