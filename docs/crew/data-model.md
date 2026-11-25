# crew 的資料表

knowledge-crew 的資料表都在 schema `crew`（crew ADR 0004），migration 在 `app/src/crew/db/migrations/`（已合併的不修改，只新增）。knowledge-kit 的資料表見 [docs/data-model.md](../data-model.md)。

共同的規則：

- 全部屬於 `kk_owner`，ENABLE＋FORCE RLS；`kk_app` 只有 SELECT 與欄位層級的 INSERT（不含時間欄位），沒有 UPDATE、DELETE：只新增不修改，目前狀態由紀錄推算。
- policy 以呼叫者權限執行，不使用 SECURITY DEFINER、不建函式與觸發器。寫入要求 `kk.identities.can_review`、看得到範圍，且身分欄位（`assigned_by`、`decided_by`、`proposed_by`）等於目前身分。
- 讀寫一律經 `app/src/crew/db/store.ts`（`withIdentity()`）；越權測試在 `app/tests/crew/`，約束測試在 `app/src/crew/db/constraints.test.ts`。

## 資料表

| 資料表 | 內容 | migration |
| --- | --- | --- |
| `sources` | 工作來源（repo、信箱、社群帳號、知識庫）與所屬專案；讀取依專案 | 0001、0004、0005 |
| `employees`、`work_types` | AI 員工與工作類型 | 0001 |
| `assignments` | 交辦：來源、員工、工作類型、到期日與優先順序 | 0002、0004、0006 |
| `works`、`work_points`、`work_changes`、`work_checks` | 交件（每輪一筆）、要看的重點、變更、自動檢查 | 0002、0004 |
| `reviews` | 驗收：通過或退回，退回的原因與意見；`can_be_guideline` 是能不能成為守則（產生欄位） | 0002、0007 |
| `level_decisions` | 人對「少看」的同意與收回；看得到同一員工 × 同一工作類型的交辦才看得到 | 0002、0003 |
| `knowledge_flowbacks` | 哪一次驗收回流成知識庫的哪一份文件 | 0005 |
| `guidelines`、`guideline_decisions`、`work_guidelines` | 守則、人的決定、一次交件依照的守則（下節） | 0007 |

## 守則（crew ADR 0007、#142）

守則以「員工 × 工作類型」為單位，來源一定是一次退回。狀態由決定推算（`app/src/crew/guidelines/status.ts`）：沒有決定是等確認，最近一筆是確認時生效（修改後確認以修改後的文字為準），不採用，收回後是已收回。

- **`guidelines`**：員工、工作類型、文字、來源退回、提出者的種類（`human`／`employee`）、提出者（人提時是那個人，員工提出時是 NULL）、提出時間。
  - 來源退回、它的交件與交辦重複存在 `source_review_id`、`source_work_id`、`source_assignment_id`，以複合外鍵保證：來源是能成為守則的退回（`reviews.can_be_guideline`：原因是 `wrong` 或 `different_approach`，而且有意見），守則的員工 × 工作類型等於來源交辦的。
  - 人提的守則由 `createReview()` 的 `saveAsGuideline` 在同一個交易寫入守則與一筆確認；員工提出的用 `proposeGuideline()`。
- **`guideline_decisions`**：守則、決定（`confirm`、`reject`、`revoke`）、確認時修改的文字、收回所指向的確認（`confirm_id`）、決定者、決定時間。
  - 修改的文字只能出現在確認；確認與不採用合計只有一次、收回只有一次（部分唯一索引），所以不採用或已收回後不能再確認。
  - 收回必須以 `confirm_id` 指向同一守則的確認（自我參照的外鍵）：沒有確認不能收回。policy 不能查詢自己的表，所以這條放在外鍵。
  - `decideGuideline()` 寫入前以 `canDecide()` 判斷，不能時拋出 `GuidelineError`（`invalid-transition`）。
- **`work_guidelines`**：交件與它依照的守則（員工自述）。交件、交辦與員工 × 工作類型重複存，以外鍵保證守則和交件是同一員工 × 工作類型。
  - 只能依照交件當時生效的守則（交件時間以前確認、以前沒有收回）：由寫入 policy 守住；`createWork()` 的 `guidelineIds` 在同一交易寫入。

讀取範圍與 `level_decisions` 相同：看得到同一員工 × 同一工作類型的交辦，才看得到守則與決定；依照的守則跟著交件。demo 以 superuser 匯入、不套用 RLS，時間條件（交件當時生效、決定晚於提出）由 demo 的驗證檢查。

### demo 資料（`client/crew/demo.json`）

- 退回的意見是 `assignments[].works[].review.note`（雙語）；守則是最上層的 `guidelines[]`（依提出時間），決定寫在各守則的 `decisions[]`（id 由 seed 產生：`<守則 id>-d<序號>`），交件依照的守則是 `works[].guidelines`。
- `app/src/crew/demo/validate.ts` 在匯入前檢查：來源是同一員工 × 工作類型、原因不是 `process`、有意見的退回；人提的守則提出時間與文字等於那次退回、第一筆決定是同時間的確認、確認者是那次的驗收者；員工提出晚於來源退回；決定的順序（`canDecide()`）與時間；修改的文字只出現在確認；依照的守則在交件時生效（`activeAt()`）。
- `app/src/crew/demo/seed.ts` 在驗收與看重點的決定之後依序寫入守則 → 決定 → 依照的守則；守則與意見不進信任的計算，層級、建議與報表數字不變。
