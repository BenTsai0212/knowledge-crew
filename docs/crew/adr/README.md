# ADR：架構決策紀錄

ADR（Architecture Decision Record）記錄「決定了什麼、為什麼、放棄了什麼」。一個決策一份，一頁以內。

## 什麼時候寫

符合任一條件就寫：

- 難以反悔（資料庫、框架、資料模型、部署平台）。
- coding agent 可能想「改正」它。
- 曾在幾個選項之間猶豫。

其他決定寫在 Issue 或 PR 即可。

## 規則

- 檔名：`NNNN-<kebab-case-title>.md`，編號遞增不重用。ADR 0001 是技術選型。
- 狀態：`Proposed` → `Accepted`／`Rejected`；被取代時改為 `Superseded by ADR NNNN`，不刪除舊檔。
- 已 `Accepted` 的 ADR 不改寫決策內容；改方向就新增一份 ADR 取代它。
- 單人專案可先以 `Proposed` 合併，隔天重看再改 `Accepted`（選用的冷卻期）。
- 以 PR 提交，不能走快速通道。

## 範本

```markdown
# ADR NNNN：標題

- 狀態：Proposed
- 日期：YYYY-MM-DD
- 相關：Issue／PR／RFC

## 背景
## 選項
## 決定
## 後果（好處、代價、後續工作）
```

## 索引

| 編號 | 決策 | 狀態 |
| --- | --- | --- |
| 0001 | [技術選型（第 0 階段）](0001-tech-stack.md) | Superseded by ADR 0002 |
| 0002 | [以 knowledge-kit 為上游](0002-knowledge-kit-upstream.md) | Accepted |
| 0003 | [啟用高風險模組](0003-high-risk-module.md) | Accepted |
| 0004 | [crew 的資料層與擴充點](0004-crew-data-and-extension-points.md) | Accepted |
| 0005 | [只展示 AI 員工的線上 demo](0005-crew-only-demo.md) | Accepted |
| 0006 | [平台連 GitHub 的方式與權限（第 1 階段）](0006-github-connection.md) | Accepted |
| 0007 | [守則與知識的來歷（第 4 階段）](0007-guidelines.md) | Accepted |
| 0008 | [讓放手站得住（第 5 階段）](0008-letting-go.md) | Accepted |
| 0009 | [用詞、AI 員工的子頁與視覺統一](0009-wording-and-sections.md) | Accepted |
