# 結構

每個路徑的職責，以及結構測試守的界線（例如只經 `retrieve()` 取段落、客戶資料只用 `@client/…`、顏色只用 CSS 變數、語言規則只放 `app/src/language/`）。改 `app/`、`worker/`、`client/` 前先讀本文件；指令與硬規則見 [AGENTS.md](../AGENTS.md)。〔#142 從 `AGENTS.md` 第 3 節移來〕

## 寫法

平行的 PR 改到同一行就會衝突（git 以行為單位合併，有衝突的 PR 不會觸發 CI），所以本文件一個檔案一行（#314）：

- 每個路徑一個 `###` 小節：標題是路徑，下面一段簡短說明（整個路徑共同的職責與界線），再以清單列出檔案。
- 清單**一個檔案（或一組成對的檔案）一行**，格式是 `` - `檔名`：說明 ``；檔名寫相對於小節路徑的路徑（例如 `src/ask.ts`）。只列需要說明的檔案。
- 清單依每行第一個行內程式碼（檔名）排序：不分大小寫，依字元碼比較（`-`、`.`、`/` 排在數字與英文字母前）。
- 新增檔案時只在正確的位置**插入一行**，不修改既有的行；刪除或改名時只動那一行。
- 每行不超過 300 字；放不下時把細節寫到 `docs/` 的對應文件，這裡只留連結。
- 結構測試在 `scripts/structure-doc.test.mjs`（行長與排序）。

## 路徑

### `app/`

前端（Vite＋React＋TypeScript）。客戶資料一律以 `@client/…` 別名讀取，不以相對路徑指到 `client/`（`client/schema/` 除外；結構測試在 `src/client/client-dir.test.ts`）。

- `dev/`：只在 `npm run dev` 提供的開發用頁面（語意向量的量測頁，不進 `dist/`，見 `docs/retrieval.md`「瀏覽器量測」）
- `index.html`：入口 HTML
- `src/`：原始碼，各模組的資料夾見以下各節
- `src/App.tsx`：畫面的入口（見 `app/src/ui/`）；也在背景執行上傳後的萃取與說法不同的比對
- `src/client/`：`client/` 設定的型別與讀取（改 Schema 時同步修改，見 `docs/client-config.md`）
- `src/client/client-dir.test.ts`：結構測試：客戶資料只以 `@client/…` 別名讀取
- `src/client/i18n.ts`：介面文字唯一的讀取模組（`strings()`、`fill()`、`errorMessage()`；結構測試在 `i18n.test.ts`）
- `src/client/source-scan.ts`：結構測試共用的原始碼掃描

### `app/src/dataset/`

資料集（`client/data/`）的型別、鍵清單、讀取、跨檔檢查與匯入。

- `load.ts`：讀取
- `seed.ts`：匯入
- `validate.ts`：跨檔檢查

### `app/src/retrieval/`

檢索；說明見 `docs/retrieval.md`。

- `keyword-hash.ts`：預設實作 `keyword-hash`（切詞在 `tokenize.ts`）
- `providers.ts`：使用哪個實作只在這裡決定（`providers.test.ts` 檢查）
- `retrieve.ts`：經 `withIdentity()` 取段落再計分
- `scenario-cases.ts`：預設問題的檢索測試的案例與涵蓋規則
- `scenarios.target.test.ts`：預設問題的檢索測試（target 測試，案例在 `scenario-cases.ts`，一律以 `keyword-hash` 檢索）
- `semantic/`：語意向量實作（可選）
- `semantic/runtime.ts`：`@huggingface/transformers` 只在這裡以動態 import 載入
- `tokenize.ts`：預設實作 `keyword-hash` 的切詞
- `types.ts`：`VectorProvider` 接口

### `app/src/language/`

語言模組（#83）：語言或文字類別的規則；檢索的 `tokenize.ts` 與上傳的 `chunk.ts` 經由它處理，其他地方不得放這類規則（`structure.test.ts` 檢查）；說明見 `docs/retrieval.md`「語言模組」。

- `scripts.ts`：文字類別與切詞方式
- `stopwords.ts`：停用詞
- `text.ts`：對外函式

### `app/src/qa/`

問答；只透過 `retrieve()` 取得段落（`structure.test.ts` 檢查）；說明見 `docs/qa.md`。

- `answer.ts`：`ask()`（`retrieve()` → 本機拒答 → `prompt.ts` 組 prompt → `/api/ask` → 拒答標記、`unwrap.ts` 移除外層標籤與 `citations.ts` 的引用解析）
- `api.ts`、`sse.ts`：`/api/ask` 傳輸接口真的實作
- `citations.ts`：引用解析
- `compare.ts`：`askEach()`，展示模式的身分對照（每個身分各呼叫一次 `ask()`）
- `prompt.ts`：組 prompt
- `testing.ts`：`/api/ask` 傳輸接口測試用的假實作（測試不呼叫真實 API）
- `types.ts`：`/api/ask` 的傳輸接口
- `unwrap.ts`：移除外層標籤

### `app/src/ui/`

畫面（入口是 `app/src/App.tsx`）。左側導覽的頁籤切換首頁（登入後的預設頁）、問答、圖譜、時間軸、上傳、待審與評測台；問答頁是左導覽、中間對話、右側面板（原文或回答提到的實體）的三欄，見 `docs/qa.md`「畫面」。元件是 `*.tsx`；介面文字一律以 `app/src/client/i18n.ts` 的 `strings()` 取得（翻譯檔在 `client/i18n/`）。

- `access-code.ts`：邀請碼只放 `sessionStorage`
- `AccessBadges.tsx`：可見等級與專案的標籤
- `AdminNotice.tsx`：需要管理者的說明（見 `docs/qa.md`「錯誤」）
- `answer-motion.ts`：問答的逐句動態（見 `docs/qa.md`「畫面」的「動態」）
- `app.css`：樣式（顏色與圓角只用 `theme.ts` 由 `client/theme.json` 設定的 CSS 變數，深色模式依 `prefers-color-scheme` 標上 `data-scheme` 後改用 `darkColors`，不寫死顏色；結構測試在 `theme.test.ts`）
- `AskCard.tsx`：AI 在問你的卡片（提問、選項、「都不是，我來說明」與複述），待審的接縫與問答的接縫提問共用（見 `docs/design.md`「AI 發言的外觀」）
- `AutoApproved.tsx`：待審頁的「已直接收錄 N 項」區（隨機抽查、展開全部、撤回並選理由、「已撤回」標示；ADR 0011，見 `docs/extraction.md`「待審頁的接縫」）
- `BottomSheet.tsx`：共用的底部面板（原生 `<dialog>`，關閉按鈕、Esc、點背景、往下拖關閉，焦點回到觸發的元件）；`expandable` 是 56%／全高，`side="right"` 是平板的右側滑出面板（原文、實體、身分與語言），`side="popover"` 是桌機左側欄旁的身分與語言選單
- `ConflictStatus.tsx`：比對狀態
- `Conversation.tsx`：問答頁中間的對話
- `cross-fade.ts`：切換語言、Light／Dark 的交叉淡換
- `entity-icons.ts`：實體類型的圖示集
- `EntityIcon.tsx`：圖例的圖示
- `EntityPanel.tsx`：圖譜頁的實體面板；桌機（`wide`）是右側整高欄的列與卡片（#336），展示模式的桌機也用（#349，相關實體依實體合併成一列）；手機（`sheet`）是底部面板的版面（#357）
- `EntitySearch.tsx`：以名稱搜尋實體；`field` 是桌機圖譜頁首與手機圖譜上方的搜尋框（#336、#357）
- `entry-hero.ts`：入口頁主視覺版面的純函式
- `EntryBar.tsx`：桌機登入頁的頂端列（登入前沒有左側導覽，#334）
- `EntryHero.tsx`：入口頁的主視覺（見 `docs/design.md`「入口頁主視覺」）
- `eval-helpers.ts`：評測台的純函式
- `EvalPage.tsx`：評測台；桌機（`eval-page--desktop`）是 h1、按鈕列、總覽表與可點的每題結果列（#347）
- `ExtractionStatus.tsx`：萃取狀態
- `FilePicker.tsx`：檔案選擇（原生 input 視覺上隱藏，按鈕與檔名跟著主題與翻譯，見 `docs/design.md`「表單元件」）
- `gone-motion.ts`：切換身分時看不到的內容消失
- `graph-keyboard.ts`：圖譜的鍵盤操作與報讀的順序、按鍵與句型（純函式，見 `docs/graph.md`「鍵盤操作與報讀」）
- `graph-list.ts`：清單模式的分群與關係句的純函式、「圖譜｜清單」的選擇
- `graph-style.ts`：圖譜的配色（深色模式切換時重新套用）
- `graph-zoom.ts`：三層語意縮放的層級、細節層與圖上元素的純函式；`panToCenter()` 在手機實體面板開著時，把選取的節點平移到面板以上的中央；`focusViewport()` 是桌機選取時的視角（縮放上限，聚焦集合留在畫布內）
- `GraphList.tsx`：圖譜的清單模式
- `GraphPage.tsx`：圖譜頁；桌機是畫板 `Graph`、`G-Scale` 的版面（#336），展示模式的桌機是畫板 `H-Graph`（#349），手機是畫板 `G-Mobile-Graph`（#357）
- `GraphView.tsx`：圖譜（cytoscape，動態載入）；`areaOf()`、`centerIn()` 與 `GraphZoomView` 共用；`cover` prop
- `GraphZoomView.tsx`：大量節點時的三層語意縮放（見 `docs/graph.md`「三層語意縮放（畫面）」）；`cover` prop
- `home.ts`：首頁的純函式（問過的問題與相對時間、狀態點、實體形狀等）
- `HomePage.tsx`：首頁（登入後的預設頁）；桌機（`wide`）是畫板 `K-Home` 的版面（#331），手機（`phone`）是畫板 `K-Mobile` 的首頁（#356）
- `identity-compare.ts`：身分對照的純函式：欄的順序與目前身分、目前的題目、一欄一欄送出、`C`／`Esc`
- `IdentityCompare.tsx`：展示模式的身分對照，每個身分一欄，沿用 `AnswerView`（純函式在 `identity-compare.ts`；畫板 `H-QA`，#349），見 `docs/qa.md`「身分對照」
- `IdentitySheet.tsx`：身分與語言面板的內容（手機、平板與桌機使用者卡的選單共用；身分單選卡附 `roles[].scope`、語言分段切換、更換邀請碼；帳號登入時只顯示帳號與角色）
- `layout.ts`：斷點（`layoutFor()`、`useLayout()`）、手機分頁的分配（`phoneTabs()`）、底部面板的拖曳門檻與 `sheetSnap()`、底部面板以上的可見部分 `visibleArea()`（扣掉浮在畫布上方的一列）（純函式，測試在 `layout.test.ts`）
- `MentionPanel.tsx`：問答頁的右側面板：回答提到的實體（純函式在 `mentions.ts`）
- `mentions.ts`：`MentionPanel.tsx` 的純函式
- `MobileNav.tsx`：≤ 600px 時取代左側導覽的手機頂端列＋底部分頁列（含「更多」面板；登入前不顯示，#355），見 `docs/design.md`「手機與平板」
- `motion.ts`：動態的刻度與 CSS 變數 `--motion-*`、`--ease-*`；圖譜展開的動態與「減少動態效果」的判斷
- `NavRail.tsx`：平板（601–1024px）的左側圖示導覽列，與 `Sidebar`、`MobileNav` 共用 `NavProps`；App 依 `useLayout()` 只渲染其中一種
- `Notice.tsx`：共用的提示框（`className` 依位置調整樣式，例如桌機問答頁的額度與需要管理者的說明條）
- `online-demo.ts`：唯一讀取處：線上 demo 的 `VITE_ONLINE_DEMO`、`VITE_PUBLIC_ACCESS_CODE`（預設關閉；開啟時隱藏評測台），展示模式 `?mode=presentation`（只顯示問答與圖譜），評測台的 `?tools=evals`，身分對照的 `VITE_DEMO_COMPARE`（預設關閉、線上 demo 一律關閉），只展示 AI 員工的 `VITE_CREW_ONLY`（crew ADR 0005）；見 `docs/qa.md`「線上 demo」「展示模式」「身分對照」、`docs/evals.md`「開啟評測台」
- `PassageMarks.tsx`：時間軸與原文面板的標示
- `PathPanel.tsx`：圖譜頁的路徑面板；`panel` 是桌機「找路徑」打開的面板（#336）
- `PresentationBar.tsx`：展示模式登入後的頂端列（不論寬度都取代 `Sidebar`／`MobileNav`；畫板 `H-QA`、`H-Graph`，#349）；`VITE_DEMO_COMPARE` 開啟時有「身分對照」按鈕，見 `docs/qa.md`「展示模式」「身分對照」
- `ProductIcon.tsx`：頁首的產品 icon（favicon 在 `app/public/favicon.svg`，見 `docs/design.md`「產品 icon（K 晶格）」）
- `qa-errors.ts`：問答錯誤的五類（見 `docs/qa.md`「錯誤」）
- `refusal-next-steps.ts`：拒答下方的下一步與先確認要找的是哪一種（見 `docs/qa.md`「拒答」）
- `report-helpers.ts`：問答的「回報有錯」組成回報
- `ReportList.tsx`：待審頁的「回報」分頁
- `ReportResult.tsx`：回答下方與首頁的回報結果
- `RequestAsk.tsx`：上傳者首頁「有更新」的請上傳者確認（提問、選項與回答；ADR 0011，見 `docs/extraction.md`「待審頁的接縫」）
- `requests.ts`：切換身分或語言時捨棄進行中的提問
- `review-helpers.ts`：待審頁的核准計畫
- `ReviewPage.tsx`：待審頁（含「說法不同」的並列與處理；桌機照畫板 `F-Review`、`F-Empty`，#345）
- `same-name.ts`：問答的同名反問：問題提到的同類型、同顯示名稱的實體與選項（ADR 0012 決定 1，見 `docs/qa.md`「同名」）
- `script.ts`：劇本的純函式（分組與順序、第 N／M 題、已問過、是否切換身分）
- `ScriptPanel.tsx`：展示模式問答頁左欄的劇本（畫板 `H-QA`，#349），見 `docs/qa.md`「展示模式」
- `seam-records.ts`：人的理解的顯示：一組兩段的鍵、同一組的理解、先作答或略過才看得到同事的理解（ADR 0012 決定 6）
- `seam-review.ts`：待審頁的接縫：哪些項目是接縫、提問與選項、選了之後要核准的內容、「已直接收錄」區的項目與隨機抽查、請上傳者確認的請求與上傳者看到的提問（ADR 0011，見 `docs/extraction.md`「待審頁的接縫」）
- `seam-text.ts`：接縫的提問、選項與上傳者回答的文字（待審頁與首頁共用）
- `SeamDialogue.tsx`：回答卡片內的說法不同提問、補充與另一種讀法（ADR 0012，見 `docs/qa.md`「說法不同的提問」）
- `SeamItem.tsx`：接縫卡片的項目本身（類型膠囊、名稱、其他語言名稱、「出處（N）」文字連結），待審頁的接縫卡與 `RequestAsk.tsx` 共用（畫板 `S-Review` ①，見 `docs/design.md`）
- `SeamRecords.tsx`：「記錄」：自己的與同事的理解（角色與日期），回答卡片與原文欄共用（ADR 0012，見 `docs/qa.md`「人的理解的顯示」）
- `SessionQuestions.tsx`：手機與平板的「這次的問題（N）」按鈕，手機打開底部面板、平板打開滑出面板（#256、#333）
- `Sidebar.tsx`：桌機的左側欄（客戶名稱、頁面項目、「虛構資料 · 展示用權限」、使用者卡與身分和語言選單，#330）
- `source-steps.ts`：「出處 N／M」與「在圖譜中查看」目標的純函式
- `SourceConfirmation.tsx`：原文欄每一段下方的來源確認：「確認這段」「撤銷確認」、「〈角色〉於〈日期〉確認」與失效的說明（ADR 0013，見 `docs/design.md`「來源確認」）
- `SourcePanel.tsx`：桌機的原文欄（段落編號、「這次回答的出處」，#335）；展示模式是浮動的原文卡片（#349）
- `SourceSheet.tsx`：手機的原文面板（底部面板，標題「原文 · 出處 N／M」，#354）與平板的滑出面板
- `SourceText.tsx`：原文紙面，桌機與手機共用
- `theme.ts`：由 `client/theme.json` 設定 CSS 變數（深色模式用 `darkColors`）
- `timeline-view.ts`：時間軸的區段與篩選、桌機與手機的年份分組、範圍與說法不同的純函式
- `TimelinePage.tsx`：時間軸（見 `docs/graph.md`；桌機與手機是精簡卡片，#346、#358）

### `app/src/graph/`

知識圖譜；說明見 `docs/graph.md`，權限測試在 `app/tests/graph/`。

- `clusters.ts`：大量節點時的門檻、分群與聚合線（純函式，只用可見圖，#254）
- `expansion.ts`：圖譜頁逐步展開的狀態（純函式，只用可見圖）
- `path.ts`：`shortestPath()` 在可見圖上找最短路徑
- `read.ts`：`readGraph()` 經 `withIdentity()` 一次讀出看得到的實體、關係與出處段落
- `recent.ts`：首頁的「最近新增的文件」與「最近看過」的實體
- `search.ts`：圖譜頁的搜尋、類型篩選與「關聯最多」（純函式，只用可見圖）
- `timeline.ts`：`readTimeline()` 依日期列出看得到的文件與段落

### `app/src/upload/`

上傳；說明見 `docs/upload.md`。畫面是 `app/src/ui/UploadPage.tsx`（桌機的頁首、分段切換與右側的上傳詳情欄，#344；手機的頁首、分段切換與底部面板的上傳詳情，#358），其中「我的上傳」的清單、上傳詳情與「看原文」是 `app/src/ui/MyUploads.tsx`，狀態、四步進度、處理中的數量、上傳詳情的萃取階段、原文中標出的實體與手機「上傳」分頁小點的純函式在 `app/src/ui/my-uploads.ts`。

- `chunk.ts`：切段
- `docx.ts`：以動態 import 載入 `mammoth`（見 ADR 0002）
- `markdown.ts`：Markdown 的擷取
- `parse.ts`：擷取純文字（上限是這裡的常數）
- `pdf.ts`：以動態 import 載入 `pdfjs-dist`（見 ADR 0002）
- `write.ts`：`uploadDocument()` 經 `withIdentity()` 寫入文件與段落（`kk_app` 唯一的寫入；權限由 RLS 執行，見 `docs/data-model.md`「寫入規則」，測試在 `app/tests/upload/`）

### `app/src/extraction/`

上傳文件的萃取；說明見 `docs/extraction.md`。

- `batch.ts`：分批
- `merge.ts`：合併比對
- `output.ts`：解析與驗證
- `prompt.ts`：prompt
- `requests.ts`：經 `withIdentity()` 寫入與讀取「請上傳者確認」的請求與回答（ADR 0011；只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「請上傳者確認」，測試在 `app/tests/extraction/requests.test.ts`）
- `run.ts`：分批呼叫 `/api/ask`
- `store.ts`：經 `withIdentity()` 寫入待審、讀取待審區與我的上傳（`readMyUploads()`，附文件日期與第一個看得到的段落）、核准與退回（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「待審與核准」，測試在 `app/tests/extraction/`）

### `app/src/conflicts/`

上傳文件與既有段落的說法不同（#51）；說明見 `docs/conflicts.md`。

- `dialogue.ts`：問答的說法不同提問：固定範本的選項、文件的新舊與相差月數、選了之後的回應（純函式，ADR 0012，見 `docs/qa.md`「說法不同的提問」）
- `interpretations.ts`：經 `withIdentity()` 寫入與讀取人的理解（ADR 0012；只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「人的理解」，測試在 `app/tests/conflicts/interpretations.test.ts`）
- `marks.ts`：時間軸與原文面板的標示（在 `readTimeline()`、`readSource()` 的交易中讀取）；桌機回答卡片的說法不同提示（`citedConflicts()`：兩段都被引用的並存組合）
- `output.ts`：解析與驗證
- `prompt.ts`：prompt
- `run.ts`：在萃取後以上傳者的身分挑選段落、呼叫一次 `/api/ask`、解析與驗證
- `select.ts`：挑選段落
- `store.ts`：經 `withIdentity()` 寫入偵測結果、讀取與處理（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「說法不同」，測試在 `app/tests/conflicts/`）

### `app/src/reports/`

回答錯誤回報（ADR 0007 決定 7）。畫面是問答的「回報有錯」（`app/src/ui/AnswerView.tsx`）與待審頁的「回報」分頁（`app/src/ui/ReportList.tsx`），見 `docs/qa.md`「回報有錯」。

- `store.ts`：經 `withIdentity()` 寫入回報、讀取與處理（只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「回答錯誤回報」，測試在 `app/tests/reports/`）

### `app/src/evals/`

評測台（#62）；說明見 `docs/evals.md`，畫面是 `app/src/ui/EvalPage.tsx`；測試只用假的 `/api/ask`。

- `grade.ts`：模型評分的 prompt 與解析（全文在 `docs/evals.md`，`docs.test.ts` 檢查）
- `keys.ts`：題庫（`client/evals/`）的鍵清單
- `load.ts`：題庫的讀取
- `oracle.ts`：權限讀取規則的獨立實作（`expectedVisible()`，`app/tests/db/oracle.ts` 重新匯出）
- `report-html.ts`：把 `report.ts` 的內容轉成自成一頁的 HTML（A4 每頁一個 `section.page`，附錄的分頁 `appendixPages()`，#347）
- `report.ts`：給客戶的品質報告的內容（純函式，只放序號、類別、身分、數字與判定）
- `run.ts`：執行（評測專用的記憶體資料庫 `openEvalDatabase()`、預計呼叫次數、逐題執行、停止與錯誤處理、兩組檢索設定）
- `score.ts`：評分的純函式（引用、關鍵重點、拒答、禁止內容、滲漏、指標彙總；滲漏的反向驗證在 `app/tests/evals/`）
- `types.ts`：題庫的型別
- `validate.ts`：需要資料集的檢查

### `app/src/sources/`

引用跳回原文。

- `confirmations.ts`：經 `withIdentity()` 確認、撤銷確認與讀取段落的目前狀態；失效判斷的純函式 `confirmationStatus()`；引用標號的小標記 `validConfirmed()` 與品質報告的確認比例 `readConfirmationCoverage()`（ADR 0013；只用 INSERT；規則由 RLS 執行，見 `docs/data-model.md`「來源確認」，測試在 `app/tests/sources/confirmations.test.ts`）
- `source.ts`：`readSource()` 經 `withIdentity()` 讀取段落所屬文件中看得到的段落（含說法不同的標示與目前已確認的段落）；`readCitedSources()` 讀取一題回答引用到的段落的文件標題與段落編號

### `app/src/crew/`

knowledge-crew 的程式（ADR 0002「新程式的位置」、ADR 0004）；crew 的功能只放這裡。介面文字只經 `i18n.ts` 讀 `client/i18n/crew/`；knowledge-kit 檔案的接入點只限 ADR 0004 的清單（`App.tsx`、`ui/online-demo.ts`、`ui/Sidebar.tsx`、`ui/layout.ts`、`vitest.config.ts`、本文件，以及 ADR 0004 修訂加入的 `e2e/mobile.spec.ts`、`e2e/mobile-pages.spec.ts`、`e2e/tablet.spec.ts`，與 crew ADR 0005 加入的 `ui/SignInPanel.tsx`、`ui/sign-in.ts`，以及 ADR 0004 的 2026-11-22 修訂加入的原文元件 `ui/SourcePanel.tsx`、`ui/SourceSheet.tsx`，與 #96 加入的 `ui/HomePage.tsx`、`ui/app.css`（`.crew-tab-count`），與 #122 加入的 `ui/access-code.test.ts`（`localStorage` 的例外加上 `crew/ui/tour-steps.ts`））。

- `db/constraints.test.ts`：crew migration 的 CHECK 與 UNIQUE
- `db/migrate.ts`：crew 的 migration 清單（版本加 `crew/` 前綴，由 `openDatabase()` 的 `migrations` 選項套用；測試在 `migrate.test.ts`）
- `db/migrations/*.sql`：crew 的 migration（已合併的不可修改）
- `db/store.ts`：crew 的資料存取，一律經 `withIdentity()`，可見範圍由 RLS 決定；`createReview()` 在「通過」時於同一個交易中把知識庫條目回流成 knowledge-kit 的文件與段落，`#owner` 欄位經待審與人做的核准成為部門實體（`writeFlowback()`，demo 的 seed 共用；#92，crew ADR 0004 的 2026-11-22 修訂）
- `demo/load.ts`：選定客戶的 `crew/demo.json`（沒有時是 `null`）
- `demo/seed.ts`：`demo.json` 驗證後匯入資料庫（交給 `openDatabase()` 的 seed）；已通過的知識庫條目以 `writeFlowback()` 回流
- `demo/simulate.ts`：「模擬交件」：以目前身分寫入下一輪的工作
- `demo/texts.ts`：`demoText()`：虛構資料的文字換成目前語言
- `demo/types.ts`：`demo.json` 的結構
- `demo/validate.ts`：`demo.json` 的驗證
- `github/fixtures/`：測試用的假 GitHub 回應（形狀同 REST API，內容全部虛構；`lifecycle.json` 是完整的一輪，`build.ts` 組出其他情況）
- `github/issue.ts`：交辦 → GitHub Issue 的轉換純函式（#111）：`assignmentToIssue()`（`{ title, body, labels }`，本文沿用 `.github/ISSUE_TEMPLATE/feature.md` 的標題，標籤不含 `agent:ready`）、`planFirstOption()`（高風險一律先提計畫、不能取消）、`dispatchSteps()`（建立 → 讀回比對 → 單獨加 `agent:ready`）、`assignmentIdOf()`；工作類型的對照表由呼叫的一方傳入
- `github/post-check.ts`：平台寫進 GitHub 前的檢查純函式（#111）：email、個人路徑、禁用名稱（規則與 `tools/workflow/check-sensitive.mjs` 一致，清單由呼叫的一方傳入，沒有時拒絕），留言不得以 `## 決定`、`## 修正要求` 開頭；只回報欄位、行號與種類（測試在 `post-check.test.ts`，與 `tools/workflow/` 共用案例）
- `github/pr.ts`：PR 描述 → 交件（#112）：`parseManualTodos()`（「人工待辦」→ 要看的重點，讀不到與沒有重點分開）、`prToWork()`（交件全文、重點與變更；格式見 `docs/crew/work-body-format.md`「PR 描述轉成的交件」；測試在 `pr.test.ts`）
- `github/state.ts`：GitHub 的現況與時間軸 → 平台狀態、轉換序列與已知狀況（`deriveGithubState()`、`linkOf()`；格式見 `docs/crew/github-state.md`，測試在 `state.test.ts`，#110）
- `github/types.ts`：平台與 GitHub 之間共用的型別（GitHub REST API 回應的形狀，只列用到的欄位，例如 `GitHubPrFile`、狀態讀回的 `GhIssue`、`GhTimelineEvent`；貼出前檢查的結果等）
- `i18n.ts`：crew 介面文字唯一的讀取模組（`crewStrings()`；一個畫面一份翻譯檔，`CrewScreenKeys` 一行一個畫面）
- `knowledge/flowback.ts`：知識庫條目的回流：`toFlowbackDocument()`（交件全文 → 文件標題、段落與 `#owner` 的部門名稱，不是一個知識庫條目時是 null）、`flowbackDocumentId()`、`flowbackOwnerPendingId()`（測試在 `flowback.test.ts`）
- `knowledge/origin.ts`：回流文件的來源：`readFlowbackOrigin()`（文件 → 哪位 AI 員工、哪一次驗收）、`readFlowbackPassage()`（工作 → 回流文件的第一段）；看不到回流紀錄時是 null（測試在 `app/tests/crew/flowback-access.test.ts`）
- `trust/demo-params.ts`：第 0 階段 demo 的虛構示範參數
- `trust/rules.ts`：信任規則的純函式（不讀資料庫、不產生介面文字）
- `trust/types.ts`：信任規則用的型別
- `ui/assign.ts`：「交辦」的資料整理（`readAssign()`：交辦清單與表單的選項，員工平常的來源與工作類型由 `usualOf()` 從交辦紀錄推得；`initialChoice()`：員工卡「交辦給 ○○」預選的員工與來源；`resultKey()`、`visibleAssignments()`：結果說明的文字鍵與清單的最近 4 件；`submitAssignment()`、`simulateAssignment()`：交辦與模擬交件；測試在 `assign.test.ts`）
- `ui/AssignView.css`：「交辦」畫面的表單（員工單選卡、來源與工作類型、結果說明）與交辦清單
- `ui/AssignView.tsx`：「交辦」畫面：交辦表單（依員工帶入來源與工作類型、結果說明）、交辦清單（最近 4 件，可看全部）與「模擬交件」（只呈現 `assign.ts` 的結果；表單與按鈕只給能驗收的身分）
- `ui/components.tsx`：AI 員工畫面共用的元件（AI 標記、層級徽章、圓點 `DotMark`／`DotRow`／`dotsSummary()`（信任頁與員工卡共用）、結論列、自動檢查列、收起的區塊；樣式在 `components.css`，測試在 `components.test.ts`）
- `ui/CrewPage.css`：crew 頁的頁首與子導覽（每個畫面一個 CSS 檔，只用 theme 的 CSS 變數；手機是可橫向滑動的按鈕列，#103）
- `ui/CrewPage.tsx`：crew 頁：頁首、子導覽六個位置（總覽、員工、交辦、工作與驗收、信任、工作帳本；#100 拿掉「今天」，#134 加上總覽）；畫面在 `SCREENS` 一行登錄，沒有的位置顯示「準備中」；畫面以 `navigate` 切換位置（交辦頁可預選員工）；「工作與驗收」「信任」帶數字（`section-counts.ts`，只給能驗收的身分），目前的子頁捲進按鈕列（#103）
- `ui/css.test.ts`：結構測試：`ui/*.css` 不寫死顏色、只用 theme.json 有的變數
- `ui/employees.ts`：「員工」的資料整理（`readEmployees()`：看得到的員工與每類工作的層級、驗收次數、待驗收件數、平常的工作來源、最近的圓點與一句說明；測試在 `employees.test.ts`）
- `ui/EmployeesView.css`：「員工」畫面的員工卡（桌機兩欄、窄螢幕一欄；職務圖示的方框）
- `ui/EmployeesView.tsx`：「員工」畫面（設計規格 v3 第 6.5 節）：呈現 `employees.ts` 的員工卡（職務圖示、交件與來源、圓點、說明）；「看信任紀錄」切到信任頁，「交辦給 ○○」只給能驗收的身分，切到交辦頁並預選員工
- `ui/entry.ts`：knowledge-kit 畫面的接入點：`withCrew()`（頁籤顯示的條件）、`crewSeed()`、`crewTabLabel()`；只展示 AI 員工的 build（crew ADR 0005）：`crewOnlyMode`、`crewDefaultView()`、`crewStartIdentity()`、`CREW_ONLY_ACCESS_CODE`、`crewDirectEntryLabel()`
- `ui/home-today.ts`：首頁的「今天的工作」的資料整理（#96，設計規格 v3 第 6.1 節）：`homeToday()`（分組：先處理・有檢查沒通過、待驗收、等你決定、進行中）、`homeSummary()`（問候下方的一句總結）、`rowStatus()`、`rowTarget()`（點了到哪裡）、`awaitingCount()`（側欄的待驗收件數）；測試在 `home-today.test.ts`
- `ui/HomeToday.css`：首頁的「今天的工作」：分組、總結與主要按鈕（列與卡片沿用首頁的 `home__*`）
- `ui/HomeToday.tsx`：首頁的接入點（#96）：`useCrewToday()`（App 讀一次，首頁與側欄共用）、`HomeTodaySummary`、`HomeTodayCard`（不能驗收的身分沒有可看的事時不顯示）、`CrewTabCount`（側欄與手機導覽「AI 員工」的待驗收件數）
- `ui/labels.ts`：各畫面共用的名稱（`workTypeLabel()`：工作類型名稱，沒有翻譯時顯示 id）
- `ui/ledger.ts`：「工作帳本」的資料整理（`readLedger()`：交辦、交件、驗收、層級決定與改回逐項看，依時間新到舊；`filterLedger()`：依員工、工作類型與事件篩選；`ledgerTone()`：層級改變與退回（做錯了）的樣式；測試在 `ledger.test.ts`）
- `ui/LedgerView.css`：「工作帳本」畫面的篩選、目前的篩選與表格（窄螢幕時表格在框內橫向捲動）
- `ui/LedgerView.tsx`：「工作帳本」畫面：只負責呈現 `ledger.ts` 的結果（載入中、讀取失敗、空狀態、依員工與事件篩選的表格、「載入更早的紀錄」；只讀）；一開始的篩選來自信任頁的總覽報表（`ledgerFilter`），頂端顯示目前的篩選並可清除（#121）
- `ui/overview.ts`：「總覽」的資料整理（#134）：`readOverview()`（看得到的專案卡片與工作，狀態與需注意的標記由 `work/status.ts` 推算）、`filterItems()`、`boardColumns()`（四欄與各欄的排序）；測試在 `overview.test.ts`
- `ui/OverviewView.css`：「總覽」畫面的專案卡片、篩選列與看板（手機是依狀態切換的清單）
- `ui/OverviewView.tsx`：「總覽」畫面（#134，AI 員工頁的預設分頁）：專案卡片（點卡片篩選）、篩選列（專案、員工、工作類型、只看需注意；可清除）、四欄的工作看板（點工作到「工作與驗收」，待交件到「交辦」）；只讀，不呈現績效
- `ui/refs.ts`：工作來源與外部編號的顯示（`assignmentRef()`、`workRef()`：repo 類是 `<repo>#<Issue>`、`PR #<編號>`，其他類型是來源名稱與編號，沒有編號時只有來源名稱；文字在 `common` 的 `ref*`）
- `ui/review.ts`：「工作與驗收」的資料整理（`readWorkList()`：待驗收與最近驗收過；`readReviewPanel()`：依 `reviewFocus()` 的驗收面板與前幾輪，另有全文的解析結果與交件的種類；`initialSelection()`；測試在 `review.test.ts`）
- `ui/review/BodyView.tsx`：驗收面板 v3 的重點卡與交件本身：依區塊列出內容，左側欄放名稱與「已修改」，重點畫底線＋上標編號；不能標出重點時退回純文字（測試在 `BodyView.test.ts`）
- `ui/review/conclusion.ts`：驗收面板 v3 的文案規則（`deliverableOf()`：工作類型 → 交件的種類；`conclusionOf()`：結論列；`decisionQuestion()`：決定列的問句；`pointPlaces()`：重點在內容中的位置；測試在 `conclusion.test.ts`）
- `ui/review/Deliverables.tsx`：驗收面板 v3 的四種交件（回信、貼文、知識庫條目、程式修改）依原本的樣子呈現（測試在 `Deliverables.test.ts`）
- `ui/review/light.ts`：驗收面板的看重點（#102，規格 6.3）：「為什麼是看重點」的日期與次數（`lightReason()`，取自既有的驗收紀錄與層級決定）與收起的規則（`keptInLight()`、`splitFields()`：有重點與空白的欄位照樣顯示，其他欄位收起；測試在 `light.test.ts`）
- `ui/review/marked.ts`：驗收面板 v3 的重點標記（`segments()`：依標記切片段；`canMark()`：能不能在內容中標出重點；測試在 `marked.test.ts`）
- `ui/review/parts.tsx`：驗收面板 v3 的交件內容共用的小元件（上標的重點編號、依標記切開的內容、區塊的名稱欄與內容；四種交件與一般的寫法共用）
- `ui/review/ReviewPanel.tsx`：驗收面板 v3：標題卡與結論列、重點＋自動檢查（並排，窄螢幕堆疊）、交件本身、前幾輪、決定列（依交件種類的問句、三張退回原因卡；手機展開退回原因時取消固定並捲進畫面，#103）；看重點時另有「為什麼是看重點」說明卡（#102）
- `ui/ReviewView.css`：「工作與驗收」畫面的清單與驗收面板（寬螢幕兩欄，窄螢幕清單在上；手機的決定列固定在底部分頁列之上，#103）
- `ui/ReviewView.tsx`：「工作與驗收」畫面：呈現 `review.ts` 的清單，面板交給 `review/ReviewPanel.tsx`；進入時選取待驗收的第一筆（從原文的來源或首頁的今天的工作切過來時選那一件，#92、#96）；已回流的工作顯示「已收進知識庫」與「打開原文」，沒有上傳權限而沒有回流時註明原因；「通過」「退回」只給能驗收的身分，寫入後重新讀取（並通知 App 更新首頁與側欄的待驗收件數，#96）
- `ui/section-counts.ts`：子導覽的數字（`sectionCounts()`：待驗收件數與待決定的看重點的建議數，只給能驗收的身分）與目前子頁的橫向捲動量（`scrollDelta()`；測試在 `section-counts.test.ts`，#103）
- `ui/sections.ts`：子導覽的位置與名稱的鍵（總覽、員工、交辦、工作與驗收、信任、工作帳本）、點進 AI 員工時的預設位置（`DEFAULT_CREW_SECTION`：總覽，#134；#100 時是工作與驗收）、畫面元件的 props（`ledgerFilter`：切到工作帳本時的篩選，#121）
- `ui/SourceOrigin.tsx`：原文的接入點：回流的文件在原文面板（`ui/SourcePanel.tsx`、`ui/SourceSheet.tsx` 的 `origin`）顯示「來自 AI 員工 ○○・驗收「○○」（日期）」，點了切到「工作與驗收」的那一件（`App.tsx` 經 `CrewPage` 的 `request`；測試在 `SourceOrigin.test.ts`）
- `ui/today.ts`：今天的工作的資料整理（`readToday()`：待驗收、進行中、建議改看重點；首頁的「今天的工作」使用，AI 員工頁籤內沒有「今天」子頁（#100）；測試在 `today.test.ts`）
- `ui/tour-steps.ts`：第一次來的導覽（#122）的步驟與目標區塊、看過的紀錄（`localStorage`，讀寫包在 try/catch，讀不到時當成沒看過）、對話框的位置、回流那一步的工作（`readTourFlowback()`；測試在 `tour-steps.test.ts`）
- `ui/Tour.css`：第一次來的導覽的入口小卡、「重新看導覽」、導覽對話框與標出區塊的外框（只用 theme 的 CSS 變數）
- `ui/Tour.tsx`：第一次來的導覽：首頁 `todayCard` 插槽的入口小卡（`CrewTourCard`，不自動彈出）與逐步切到首頁或 crew 頁、標出區塊的對話框（`CrewTour`，`App.tsx` 提供切換畫面；`Esc` 結束）
- `ui/trust-report.ts`：信任頁的總覽報表（#121）：`trustReport()` 以 `readTrust()` 的列與工作帳本的事件整理每個「員工 × 工作類型」的驗收次數、第一次就通過、三種退回原因、目前層級與層級變化（純函式；測試在 `trust-report.test.ts`）
- `ui/trust.ts`：「員工」「信任」共用的資料整理（`readTrust()`：每個「員工 × 工作類型」的圓點、層級、建議改看重點；`trustTimeline()`／`trustNote()`：信任頁的時間軸（每次驗收當時的層級與層級事件）與說明；`agreeRelax()`／`revokeRelax()` 寫入看重點的決定；測試在 `trust.test.ts`）
- `ui/TrustReport.tsx`：信任頁最上方的總覽報表：點一列切到工作帳本並篩選成該員工＋該工作類型，點退回的數字再篩選成退回（#121）
- `ui/TrustView.css`：「信任」畫面的頁首、總覽報表（手機時每列一張卡片）、卡片與時間軸（事件、圓點與日期、層級帶三列共用欄數；三種結果以符號與文字區分）
- `ui/TrustView.tsx`：「信任」畫面（時間軸，設計規格 v3 第 6.4 節）：最上方是總覽報表（`TrustReport.tsx`），下方呈現 `trust.ts` 的結果；「同意改看重點」「收回，改回逐項看」只給能驗收的身分，寫入後重新讀取（並通知 crew 頁與 App 更新子導覽的數字與首頁，#103）
- `work/body.ts`：交件全文的結構與「要看的重點」標記：`parseWorkBody()`、`toPlainText()`（格式見 `docs/crew/work-body-format.md`；測試在 `body.test.ts`）
- `work/due.ts`：交辦的到期狀態（#133）：`dueStatus()`（逾期／3 天內到期／還早／沒有到期日）、`shownDueStatus()`（已通過的不標逾期）、`crewToday()`（demo 的 `today` 固定，沒有時用目前的日期；測試在 `due.test.ts`）
- `work/status.ts`：工作狀態與需注意的標記（#134）：`workStatus()`（待交件／等驗收／修正中／已完成）、`stayDays()`、`attentionFlags()`（逾期、3 天內到期、停滯：停留超過 3 天）；測試在 `status.test.ts`

### `app/src/db/`

資料層（PGlite＋RLS）；說明見 `docs/data-model.md`。

- `database.ts`：唯一入口
- `migrations/*.sql`：migration

### `app/tests/`

需要放在 `app/src/` 之外的測試（例如會用到被禁止 SQL 的越權測試）。

- `crew/`：crew 的越權與匯入流程測試（會用到被禁止的 SQL）
- `fixtures/large-graph.ts`：圖譜分群用的虛構大型資料（固定種子、240 個實體，不放進 `client/`，#254）

### `worker/`

Cloudflare Worker（TypeScript）：`GET /api/health`、`POST /api/ask`；其他請求交給 `dist/` 靜態檔。API 格式、錯誤類型、secret 與已知限制見 `worker/README.md`。

- `src/ask.ts`：`POST /api/ask` 的同站、邀請碼、body、每日次數的檢查
- `src/models.ts`：模型白名單
- `src/sse.ts`：轉成精簡的 SSE
- `src/testing.ts`：測試用的假實作
- `src/upstream.ts`：轉發到 Claude Messages API
- `src/usage.ts`：計數用的 Durable Object

### `client/`

客戶設定；參考情境與測試基準，`KK_CLIENT` 可改用 `clients/<名稱>/`；說明見 `docs/client-config.md`、`docs/dataset.md`。

- `*.json`：客戶設定
- `crew/demo.json`：crew 的虛構資料（沒有這個檔的客戶不顯示 crew 頁籤）
- `data/`：虛構資料集
- `evals/questions.json`：評測題庫（見 `docs/evals.md`）
- `i18n/<語言>.json`：介面翻譯檔（含拒答文字與各錯誤訊息）
- `i18n/crew/<畫面>.<語言>.json`：crew 的介面翻譯檔（一個畫面一份；`common` 是頁籤、子導覽等共用文字）
- `schema/`：JSON Schema

### `clients/`

各客戶的設定（`clients/<名稱>/`，結構同 `client/` 但不含 `schema/`）；本 repo 只放虛構的示範客戶，真實客戶放在各自的 fork（#77 決定 7、`clients/README.md`）。

### `e2e/`

Playwright 的端對端測試（`*.spec.ts`）；設定在根目錄的 `playwright.config.ts`，說明見 `docs/testing.md`。

- `access.spec.ts`：越權
- `compare.spec.ts`：展示模式的身分對照，只在 `VITE_DEMO_COMPARE=1` 的 build 執行畫面的測試（比對文字只出現在一個答案段落的檢查不需要開關）
- `crew-overview.spec.ts`：AI 員工頁的總覽（#134）：預設分頁、專案卡片與篩選、追到「工作與驗收」、員工與訪客的呈現（1280 與 390）；只在有 `crew/demo.json` 的客戶執行
- `crew-tour.spec.ts`：第一次來的導覽（#122）：入口小卡、5 步、鍵盤與 `Esc`（1280 與 390）；只在有 `crew/demo.json` 的客戶執行
- `demo.spec.ts`：線上 demo 的設定，只在 `VITE_ONLINE_DEMO=1` 的 build 執行
- `entry-touch.spec.ts`：入口（手機與平板）與觸控目標（#255 PR 4）
- `evals-desktop.spec.ts`：桌機的評測台與品質報告（1440×900，#347）
- `fixtures/`：上傳用的虛構檔案
- `graph-desktop.spec.ts`：桌機的圖譜（1440×900）的版面、實體欄與縮放按鈕
- `graph-mobile.spec.ts`：手機的圖譜（390×844）的版面、「篩選與找路徑」與實體面板
- `home-mobile.spec.ts`：手機的首頁（390×844，#356）
- `home.spec.ts`：首頁
- `interactions.spec.ts`：互動邊角
- `layout.spec.ts`：三欄版面
- `mentions.spec.ts`：回答提到
- `mobile-pages.spec.ts`：手機的時間軸、上傳、待審、評測台與更多（375×812）
- `mobile-qa.spec.ts`：手機的問答與原文面板（390×844）
- `mobile-timeline-uploads.spec.ts`：手機的時間軸、上傳頁首與我的上傳（390×844，#358）
- `mobile.spec.ts`：手機的共同結構（390×844）
- `presentation.spec.ts`：展示模式
- `qa-desktop.spec.ts`：桌機的問答頁與原文欄（1440×900，#335）
- `reports.spec.ts`：回答錯誤回報
- `retract.spec.ts`：撤回
- `review-desktop.spec.ts`：桌機的待審頁（1440×900，#345）
- `review.spec.ts`：待審頁
- `smoke.spec.ts`：冒煙
- `support/app.ts`：共用操作（介面文字從選定客戶的 `i18n/` 讀取）
- `support/citing-answer.ts`：引用每一段的假回答，找到檢索到至少 2 段的預設問題（手機與桌機的原文面板共用）
- `support/client.ts`：讀取 `KK_CLIENT` 選定客戶的 JSON 並推算測試用的身分（不寫死角色、等級、專案）
- `support/crew.ts`：選定的客戶有沒有 `crew/demo.json`（knowledge-crew，#34；手機與平板導覽的斷言以此判斷）
- `support/dataset.ts`：以 `app/src/evals/oracle.ts` 算出各身分看不到的段落；身分對照用的「只有一個身分看得到的題目」與只出現在答案段落的比對文字（`onlyOneSees()`）
- `support/fake-ask.ts`：假的 `/api/ask`（含串流到一半的假回應）
- `support/skip-reporter.ts`：列出略過的測試與原因（參考情境有略過時失敗）
- `timeline-desktop.spec.ts`：桌機的時間軸（1440×900，#346）與平板不變

### `scripts/`

專案腳本（Node ESM，不在 `typecheck` 範圍內）。

- `check-client.mjs`：客戶檢查
- `check-clients.mjs`：客戶檢查（所有客戶）
- `check-sensitive.mjs`：敏感資料檢查
- `client-dir.mjs`：`KK_CLIENT` 對應的客戶資料夾（`vite.config.ts`、`vitest.config.ts`、`vitest.clients.config.ts` 與 `check-client.mjs` 共用）
- `doc-commands.test.mjs`：Markdown 的 shell 指令區塊不加 `#` 註解，說明寫在區塊外
- `fixtures/invalid-client/`：故意寫錯的測試資料
- `i18n-merge.mjs`：客戶翻譯檔缺少的鍵退回參考情境 `client/i18n/`（#406）；Vite 外掛（`vite.config.ts`、`vitest.clients.config.ts`）、`e2e/support/client.ts` 與 `check-client.mjs` 共用
- `ort-wasm.mjs`：語意向量 provider 的 ONNX Runtime WASM：build 時依客戶設定複製到 `dist/ort/` 並檢查單檔上限（`vite.config.ts` 使用）
- `path-case.test.mjs`：git 追蹤的檔案與資料夾沒有只差大小寫的路徑（去掉最後一個副檔名、轉成小寫後比較；不分大小寫的檔案系統上會互相蓋掉，knowledge-crew #127）
- `playbook.test.mjs`：`docs/playbook/` 繁中與英文的檔名、`##` 標題數量與相對連結
- `structure-doc.test.mjs`：本文件的寫法（清單每行不超過 300 字、每個小節的清單依檔名排序）

### 根目錄

根目錄的指令與設定（單一 `package.json`，不用 workspaces）。

- `package.json`：指令與相依套件
- `playwright.config.ts`：Playwright 的設定
- `tsconfig.node.json`：根目錄設定檔的 tsconfig
- `vite.config.ts`：Vite 的設定
- `vitest.clients.config.ts`：客戶檢查的 target 測試
- `vitest.config.ts`：Vitest 的設定
- `wrangler.crew-demo.jsonc`：只展示 AI 員工的線上 demo（assets-only，沒有 Worker 程式；crew ADR 0005、`docs/deploy.md`）
- `wrangler.jsonc`：頂層供本機 `wrangler dev`，`env.demo` 是含問答的線上 demo（`knowledge-crew-qa-demo`）

### `docs/`

文件。

- `adr/`：決策紀錄
- `deploy.md`：線上 demo 的部署步驟、驗收清單、回退與費用上限（部署由人執行；ADR 0005）
- `design/v1/boards/`：設計畫布「畫面流程圖」引用的畫板原始碼與接縫與討論版的畫板（#392）（`*.dc.html`，原樣保存、以 sha256 核對）；視覺以畫板為準，只供參考，不被 `app/` import、不進 build（#329）
- `design/v1/boards/README.md`：畫板與頁面的對照、顏色名稱與 token 的對照、不實作的內容與已知衝突
- `playbook/`：方法與文件套件（需求確認清單、資料盤點表、資料安全說明、評測題庫建立步驟、驗收指標、落地新客戶步驟 `new-client-setup.md`）；入口是 [docs/playbook/README.md](playbook/README.md)，英文版在 `docs/playbook/en/`，兩份一起改
- `references.md`：設計引用的文獻與業界準則（引用標記、書目、連結、主張、用在哪裡；ADR 與 `docs/design.md` 連到這裡）
- `rfcs/`：專案章程
- `workflow/`：憲法與 workflow 手冊

### `tools/workflow/`

workflow 工具（Node，自帶 `package.json`；各工具的參數見 `tools/workflow/README.md`）；`bootstrap-github.mjs`、`config.json` 不適用（見 `AGENTS.md` 第 2 節）。

- `check-post-body.mjs`：agent 貼出 PR 描述與留言前的檢查（#104）
- `check-pr-body.mjs`：檢查 PR 描述有 `Closes`／`Refs #N`（`fast-lane` 除外）
- `doc-rules.test.mjs`：檢查規則文件（一份正本、相對連結、`AGENTS.md` 的行數上限）
- `hooks/confirm-main.mjs`：合併與 push 到 main 前的確認 hook
- `personal-paths.test.mjs`：檢查開發流程工具的檔案沒有 `/Users/<名稱>`、`/home/<名稱>` 形式的個人路徑（#96，fork 後要改的地方見 `docs/workflow/fork.md`）
- `read-trusted.mjs`：讀取 Issue 與 PR，只輸出可信身分的內容（#127）
- `runner/`：自動化模組的 runner（ADR 0003，指令見 `AGENTS.md` 第 2 節）
- `testdata/post-check-cases.json`：貼出前檢查的共用測試案例，`post-check-cases.test.mjs` 與 `app/src/crew/github/post-check.test.ts` 都讀（#111）

### `.claude/`

Claude Code 設定。

- `settings.json`：在 `PreToolUse`（Bash）註冊確認 hook

### `templates/`

Claude Project 範本與預設不啟用的模組檔案。

### `.github/`

Issue／PR 範本、標籤定義與 CI；沒有部署 workflow。

- `workflows/ci.yml`：`checks` 與 `clients` job
- `workflows/e2e.yml`：Playwright，參考情境與每個客戶各一格
- `workflows/pr-body.yml`：PR 描述檢查
- `workflows/sensitive.yml`：敏感資料檢查
