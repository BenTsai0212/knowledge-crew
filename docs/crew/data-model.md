# crew 的資料表

knowledge-crew 的資料表都在 schema `crew`（crew ADR 0004），migration 在 `app/src/crew/db/migrations/`（已合併的不修改，只新增）。knowledge-kit 的資料表見 [docs/data-model.md](../data-model.md)。

共同的規則：

- 全部屬於 `kk_owner`，ENABLE＋FORCE RLS；`kk_app` 只有 SELECT 與欄位層級的 INSERT（不含時間欄位），沒有 UPDATE、DELETE：只新增不修改，目前狀態由紀錄推算。
- policy 以呼叫者權限執行，不使用 SECURITY DEFINER、不建函式與觸發器。寫入要求 `kk.identities.can_review`、看得到範圍，且身分欄位（`assigned_by`、`decided_by`、`proposed_by`、`corrected_by`）等於目前身分。
- 讀寫一律經 `app/src/crew/db/store.ts`（`withIdentity()`）；越權測試在 `app/tests/crew/`，約束測試在 `app/src/crew/db/constraints.test.ts`。

## 資料表

| 資料表 | 內容 | migration |
| --- | --- | --- |
| `sources` | 工作來源（repo、信箱、社群帳號、知識庫）與所屬專案；回流與守則文件的機密等級；讀取依專案 | 0001、0004、0005、0008 |
| `employees`、`work_types` | AI 員工與工作類型 | 0001 |
| `assignments` | 交辦：來源、員工、工作類型、到期日與優先順序 | 0002、0004、0006 |
| `works`、`work_points`、`work_changes`、`work_checks` | 交件（每輪一筆）、要看的重點、變更、自動檢查 | 0002、0004 |
| `reviews` | 驗收：通過或退回，退回的原因與意見；`can_be_guideline` 是能不能成為守則（產生欄位）；`not_in_points` 是退回時「這個錯沒有被標成重點」 | 0002、0007、0009 |
| `level_decisions` | 人對「少看」的同意與收回；看得到同一員工 × 同一工作類型的交辦才看得到 | 0002、0003 |
| `knowledge_flowbacks` | 哪一次驗收回流成知識庫的哪一份文件 | 0005 |
| `guidelines`、`guideline_decisions`、`work_guidelines` | 守則、人的決定、一次交件依照的守則（下節） | 0007 |
| `guideline_documents` | 哪一條守則寫成知識庫的哪一份文件（下節「守則進知識庫」） | 0008 |
| `review_corrections`、`review_feedback` | 事後更正、驗收時的逐條回饋（「讓放手站得住」一節） | 0009 |

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

### 守則進知識庫（ADR 0007 決定 7、#149）

確認的守則寫成一份知識庫文件（`kk.documents`／`kk.passages`，受 knowledge-kit 的上傳規則檢查），收回時不刪、不改文件；原文面板以「這條守則的來歷」標出生效中或已收回。

- **`sources.guideline_visibility_level_id`**：這個來源的守則文件的機密等級，可為空（不寫文件），任何類型的來源都可以填（回流的 `knowledge_visibility_level_id` 只給知識庫類）。
- **`guideline_documents`**：守則（主鍵，一條最多一份）、文件（UNIQUE，id 一定是 `crew-guideline-<守則 id>`）、寫入時依據的確認（`confirm_id`）、寫入時間。
  - `confirm_id` 以複合外鍵指向同一守則的確認（`confirm_decision` 是產生欄位 `'confirm'`），superuser 匯入 demo 時也擋得住「沒有確認就寫文件」。
  - 寫入 policy：`can_review`、確認是自己寫的、文件是自己上傳的、文件的專案等於來源交辦的工作來源的專案、機密等級等於該來源的守則等級。沒有 UPDATE、DELETE。
  - 讀取：守則看得到（員工 × 工作類型）**且**文件看得到（`kk.can_see`）。文件的專案就是來源交辦的專案，所以看得到文件就看得到守則；反過來不一定（等級不夠，或經由另一個專案看到同員工 × 工作類型的守則），這時員工頁照常顯示守則，知識庫沒有這份文件。
- 寫入：`decideGuideline()` 的確認與 `createReview()` 的 `saveAsGuideline` 在同一個交易呼叫 `writeGuidelineDocument()`（demo 的 seed 共用），回傳 `guidelineDocument`：`written`、`not-applicable`（不是確認、來源沒有守則等級）或 `no-upload-permission`（確認者不能上傳；確認照常生效，比照回流）。
- 文件：標題「{員工}的「{工作類型}」守則：{守則文字前 24 字}」，兩段是守則目前的文字與來歷（退回日期與原因、員工提出時的「整理提出」、確認者與日期、確認時修改）；語言是 `defaultLanguage`，日期是確認日。固定文字在 `client/i18n/crew/knowledge.<語言>.json`。
- 限制：knowledge-kit 的文件沒有撤回機制，含問答的版本可能引用已收回的守則文件（之後的版本處理）。

### demo 資料（`client/crew/demo.json`）

- 退回的意見是 `assignments[].works[].review.note`（雙語）；守則是最上層的 `guidelines[]`（依提出時間），決定寫在各守則的 `decisions[]`（id 由 seed 產生：`<守則 id>-d<序號>`），交件依照的守則是 `works[].guidelines`。
- `app/src/crew/demo/validate.ts` 在匯入前檢查：來源是同一員工 × 工作類型、原因不是 `process`、有意見的退回；人提的守則提出時間與文字等於那次退回、第一筆決定是同時間的確認、確認者是那次的驗收者；員工提出晚於來源退回；決定的順序（`canDecide()`）與時間；修改的文字只出現在確認；依照的守則在交件時生效（`activeAt()`）。
- `app/src/crew/demo/seed.ts` 在驗收與看重點的決定之後依序寫入守則 → 決定 → 守則的文件 → 依照的守則；守則與意見不進信任的計算，層級、建議與報表數字不變。四個來源的 `guidelineVisibility` 都是 `internal`，所以 g01、g03、g04（之後收回）、g05 有文件，等確認的 g02、不採用的 g06 沒有。

## 讓放手站得住（crew ADR 0008、#161）

事後更正、逐條回饋與「沒被標成重點」存在資料表；**抽查不存**，由信任規則從交件、驗收、層級決定與更正推算（ADR 0008 第 7 點）。讀取比照 `reviews`：看得到該次驗收才看得到。

- **`review_corrections`**：被更正的驗收（UNIQUE：一次驗收最多一筆）、備註、`not_in_points`、更正者、更正時間。
  - 只能更正通過的驗收：`review_verdict` 固定是 `accepted`，與 `review_id` 組成複合外鍵指向 `reviews (id, verdict)`。
  - 時間不能早於該次驗收：由寫入 policy 守住（`kk_app` 的時間一律是 `now()`）；demo 以 superuser 匯入時由 `validate.ts` 檢查。
  - `can_be_guideline`（產生欄位）：備註不是空白，供「更正記成守則」的複合外鍵。
- **`review_feedback`**：驗收、交件、對象種類（`point`／`guideline`）、重點序號或守則、結果（重點：`ok`／`problem`；守則：`done`／`not_done`）。
  - 重點以外鍵指向 `work_points (work_id, ordinal)`，守則指向 `work_guidelines (work_id, guideline_id)`，驗收與交件指向 `reviews (id, work_id)`：對象一定屬於該次交件。同一對象最多一筆（兩個部分唯一索引）。
  - 只能和驗收在同一交易寫入：寫入 policy 要求驗收是自己寫的、`decided_at = now()`，之後不能補。
- **`reviews.not_in_points`**：退回時「這個錯沒有被標成重點」，CHECK 只在原因是 `wrong` 時可以為 true；既有的列是 false。
- **更正記成守則**（第 6 點）：`guidelines` 的來源可以是退回或事後更正。更正來源時 `source_correction_id` 有值、`source_eligible` 是 NULL（0007 的「來源是能成為守則的退回」外鍵不檢查），改以 `(source_correction_id, source_review_id, source_correction_eligible)` 指向 `review_corrections (id, review_id, can_be_guideline)`；另以外鍵保住 `(source_review_id, source_work_id)` 的對應。守則文件把更正當成一次做錯了，日期是更正的日期。
- 存取函式（`store.ts`）：`createCorrection()`（`saveAsGuideline` 在同一交易寫入守則、確認與文件）、`createReview()` 的 `feedback` 與 `notInPoints`、`getReviewDetails()`（更正與逐條回饋）；`getTrustInputs()` 另回傳 `corrections` 與 `works`（抽查的序號用），`listGuidelines()` 的每條守則附 `notDoneCount` 與 `sourceCorrectionId`。
- demo 資料：`works[].review.notInPoints`、`works[].review.feedback`（重點是 `points` 的序號、守則是該次交件 `guidelines` 的 id）、通過時的 `works[].review.correction`（id、更正者、時間、雙語備註、`notInPoints`）；seed 在依照的守則之後寫入。
