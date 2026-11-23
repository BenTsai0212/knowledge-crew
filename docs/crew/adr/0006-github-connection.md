# ADR 0006：平台連 GitHub 的方式與權限（第 1 階段）

> 本決定適用於實際運作的專案；本 repo 只保留設計與不連線的參考實作（[RFC 0001](../rfcs/0001-project-charter.md) 2026-11-23 修訂）。文中的「私人 repo」指負責真實運作的另外專案。

- 狀態：Accepted
- 日期：2026-11-23
- 決定者：@BenTsai0212
- 相關：[#108](https://github.com/BenTsai0212/knowledge-crew/issues/108) 的 `## 計畫` 第 3 點與 `## 決定` 第 3 項（D3）、#109、Epic #10、RFC 0001「待決問題」、[github-writes.md](../../workflow/github-writes.md) 第 1 節（三級確認）

## 背景

第 1 階段「員工與派工」要讓平台交辦等於在 repo 開 Issue、加上派工標籤，並從 GitHub 讀回工作狀態（#108 的 `## 目標`）。平台因此第一次要以程式寫入 repo，RFC 0001 的待決問題「平台寫入 repo（開 Issue、加標籤）的權限設計，如何套用三級確認」必須先決定。

限制條件：

- 執行仍由既有的 coding agent 負責。agent 以 `read-trusted.mjs` 只採信 `OWNER`、`MEMBER`、`COLLABORATOR` 寫的 Issue 與留言（`docs/workflow/agent-workflow.md` 第 0 步），平台建立的 Issue 必須被視為可信才會被接手。
- 雲端排程任務以 `issues.labeled` 觸發，平台加的 `agent:ready` 要能照常觸發。
- 連線、寫入與權杖只在私人 repo 實作與部署；公開 repo 只放概念、資料格式與不連線也能測的部分（#108 `## 決定` 第 1 項，D1）。

## 選項

（沿用 #108 `## 計畫` 第 3 點的比較表）

| | fine-grained PAT（決定者本人） | GitHub App |
| --- | --- | --- |
| 建立 | 決定者在設定頁建立，選 repo 與權限 | 建 App、安裝到 repo、私鑰換短期 installation token |
| Issue 的作者 | 決定者本人，`authorAssociation` 是 `OWNER` | `<app>[bot]`，`authorAssociation` 預計不是 `OWNER`／`MEMBER`／`COLLABORATOR` |
| 對既有派工規則的影響 | 無：`read-trusted.mjs` 視為可信，agent 照常接手 | agent 會依「外部 Issue」停止；要改 `read-trusted.mjs` 的可信身分（修憲等級的變更） |
| 期限與撤銷 | 有到期日，到期要換；撤銷即時 | 私鑰不過期，token 1 小時；撤銷要移除安裝或私鑰 |
| 程式量 | 少（一個 header） | 多（JWT 簽章、換 token） |
| 多人與多 repo | 綁一個人 | 適合（第 4 階段、多客戶） |

另外，PAT 加的 `agent:ready` 與人在網頁上加的是同一個帳號，預期照常觸發雲端排程任務；App 加的標籤是否觸發，目前沒有證據。

## 決定

1. **方式：fine-grained PAT**。權杖是決定者本人的，Repository access 只選本 repo（Only select repositories）。放棄 GitHub App：第 1 階段只有一個使用者、一個 repo，App 的好處用不到，卻要改可信身分的規則與觸發條件的實測。
2. **權限**：Repository permissions 只開下列幾項，其他（Contents、Administration、Workflows、Actions 等）都不開：

   | 權限 | 等級 | 用途 |
   | --- | --- | --- |
   | Issues | Read and write | 建立 Issue、加標籤、留言、讀回狀態 |
   | Pull requests | Read-only | 讀 PR 與 `Closes`／`Refs` 的連結 |
   | Checks | Read-only | 讀 CI |
   | Commit statuses | Read-only | 讀 CI |
   | Metadata | Read-only | 必選 |

   這組權限做不到合併（合併需要 Contents 寫入），在權限層就排除了合併。
3. **期限**：90 天。到期前 14 天在平台首頁提醒，由決定者換新。
4. **權杖放哪裡**：只放在私人 repo 部署的 Worker secret，由人以 `wrangler secret put` 設定；agent 不讀、不設定（`AGENTS.md` 第 2 節）。不放瀏覽器、不放資料庫、不進 log，Worker 的回應不帶權杖。本 repo 不寫權杖、帳號或私人 repo 的設定內容。

### 平台寫入的限制

Issues 的寫入權限同時能留言、關閉 Issue、改任何標籤，所以權限之外再以程式限制：

- **只有三種寫入**：建立 Issue、加標籤、一般留言。其他寫入（關閉、重開、移除標籤、修改本文、刪除等）一律不實作。
- **留言的開頭**：平台留言不得以 `## 決定`、`## 修正要求` 開頭（流程語言為 en 時是 `## Decision`、`## Change request`，對照見 [headings.md](../../workflow/headings.md)），避免平台寫出的內容被 agent 當成人的決定或修正要求。
- **`agent:ready` 最後單獨加**：建立 Issue 時不帶 `agent:ready`；讀回確認 Issue 已建立後，以單獨一次寫入加上，而且是這張 Issue 派工的最後一次寫入（與 [github-writes.md](../../workflow/github-writes.md) 第 1 節「派工時單獨加 `agent:ready`」相同）。
- **以測試固定**：寫入的 API 路徑只有上述三種、留言開頭的檢查、`agent:ready` 是最後且單獨的寫入，三者都由測試固定。

### 三級確認的對照表

依 [github-writes.md](../../workflow/github-writes.md) 第 1 節的等級：

| 平台上的操作 | 等級 | 畫面上的確認 |
| --- | --- | --- |
| 交辦（建立 Issue＋派工標籤） | ② 整批同意 | 送出前顯示「將建立的 Issue」完整預覽（標題、本文、標籤、目標 repo），按「確認交辦」才寫入；不提供「不預覽直接送出」 |
| 加 `agent:ready` | 隨交辦同一批 ② | 不另外問；讀回確認 Issue 已建立後單獨加上，且是最後一次寫入 |
| 退回原因（只寫平台資料庫） | ① | 直接記錄，可修改 |
| 合併、關閉 Issue、移除 `plan-first`、`## 決定` | ③ | 第 1 階段平台不做，畫面只提供「到 GitHub 處理」的連結 |
| 少看的同意與收回 | 平台內 | 沿用第 0 階段的確認對話框 |

### 重新檢討的條件

符合任一條件時重新檢討（例如改用 GitHub App），以新的 ADR 取代本決定：

- 平台有第 2 個使用者。
- 第 4 階段加入外部執行者。

## 後果

- **好處**：不必改 `read-trusted.mjs` 的可信身分，平台建立的 Issue 由 agent 照常接手；程式量少；合併在權限層就做不到。
- **代價：寫出的身分是 `OWNER`**。PAT 寫出的 Issue 與留言，`authorAssociation` 與決定者親手寫的相同，agent 無法從身分分辨。因此留言開頭的限制不能靠 agent 判斷，必須在平台程式擋，並以測試固定。
- **代價：權杖綁一個人**。權杖外洩時由決定者立即撤銷並建立新的權杖、重新設定 Worker secret；外洩期間以權杖寫進公開 repo 的 Issue 與留言會留在公開紀錄，撤銷收不回（#108 `## 計畫` 的 D3「不可逆」）。到期未換時平台無法寫入，交辦會失敗，但不影響既有的 Issue 與 agent。
- **後續工作**（#108 `## 決定` 的「接下來」）：私人 repo 實作連線與三種寫入並附測試；決定者建立 PAT（含到期日）並設成 Worker secret。
