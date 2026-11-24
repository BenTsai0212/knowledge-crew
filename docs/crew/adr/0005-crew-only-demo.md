# ADR 0005：只展示 AI 員工的線上 demo

> 用詞：2026-11-24 起，「少看」改稱「看重點」（#128）；本文保留當時的寫法。

- 狀態：Accepted
- 日期：2026-11-22
- 決定者：@BenTsai0212
- 相關：#84 的 `## 計畫` 與 `## 決定`、#91（RFC 0001 的 2026-11-22 修訂）、ADR 0002、ADR 0004、knowledge-kit 的 `docs/adr/0005-online-demo.md`

## 背景

決定者要先部署一個只展示 AI 員工的線上 demo，含問答的完整版等下一版。AI 員工全部在瀏覽器內執行（PGlite＋`client/crew/demo.json`），不呼叫 `/api/*`；但 knowledge-kit 的線上 demo（`VITE_ONLINE_DEMO=1`）有問答與上傳萃取，需要 Worker、Durable Object 與 secret，登入頁也要求邀請碼。`wrangler.jsonc` 繼承自 knowledge-kit，名稱不改就部署會覆蓋 knowledge-kit 的線上 demo。

## 選項

- **部署方式**：A. Workers 的 assets-only（另一個設定檔，沒有 `main` 與 Durable Object）；B. 沿用 `env.demo` 的 Worker＋DO、不設 secret；C. Cloudflare Pages。
- **開關**：擴充 `VITE_ONLINE_DEMO`；或新的 `VITE_CREW_ONLY`。
- **知識庫的其他頁**：全部不顯示；或保留時間軸、圖譜。

## 決定

1. **部署：A，assets-only**。新檔 `wrangler.crew-demo.jsonc`，Worker 名稱 `knowledge-crew-demo`，免費方案、`workers.dev`、沒有 secret；`wrangler.jsonc` 頂層改為 `knowledge-crew`，`env.demo` 改為 `knowledge-crew-qa-demo`。部署與 Cloudflare 的設定由人執行。放棄 B：沒用的 Worker 與 DO 補上 secret 就開始產生費用，界線不清楚；放棄 C：回退與監控要另寫一套。`env.*` 無法取消頂層的 `main`，所以另開設定檔而不是新增 env。
2. **開關：新的 `VITE_CREW_ONLY=1`**（營運開關，預設關閉；只有 `"1"` 開啟），與 `VITE_ONLINE_DEMO` 分開，含問答的線上 demo 行為不變。讀取處是 `app/src/ui/online-demo.ts` 的 `readCrewOnly()`；開啟時身分對照、展示模式與評測台一律關閉。客戶沒有 `demo.json` 時不生效（`app/src/crew/ui/entry.ts` 的 `crewOnlyMode`）。
3. **只留 AI 員工**（2026-11-22 由決定 6 調整）：開啟時頁籤只有 AI 員工，登入後直接進入（當時預設是「今天」；現在是首頁，見決定 6 與 #96、#100）；首頁、問答、圖譜、時間軸、上傳、待審、評測台都不顯示（首頁與圖譜有切到問答的入口，保留會擴大對 knowledge-kit 元件的改動）。「虛構資料」「展示用權限」的標示與身分切換保留。
4. **登入不要求邀請碼**：帳號登入不顯示邀請碼欄；「使用邀請碼體驗」換成「直接體驗」，直接進入且可以切換身分；「更換邀請碼」不顯示，不新增「登出」。App 仍以「邀請碼不是 null」代表已登入，crew-only 時存固定值 `CREW_ONLY_ACCESS_CODE`（不是 secret，沒有頁面會送出）。
5. **以主管身分進入**（2026-11-22，PR #86 的修正要求，選項 A）：crew-only 時一開始的身分是第一個能驗收的身分（`client/access.json` 的 `canReview`，示範客戶是「主管」），讓「直接體驗」後的今天的工作（原本是 AI 員工的「今天」，#96 起在首頁）就有待驗收的工作與少看建議；以訪客進入時只顯示「今天沒有需要你處理的事」，展示效果不佳。左下角的身分仍可切換；沒有能驗收的身分時是第一個身分。判斷在 `entry.ts` 的 `crewStartIdentity()`；開關關閉時（含 `VITE_ONLINE_DEMO=1`）仍是第一個身分。
6. **加回首頁、圖譜、時間軸**（2026-11-22，#91，RFC 0001 的 2026-11-22 修訂（#89），調整決定 3）：頁籤是 knowledge-kit 的首頁、圖譜、時間軸（順序沿用 knowledge-kit），AI 員工接在後面；問答、上傳、待審、評測台仍不顯示，仍不呼叫模型。原本擔心的「切到問答的入口」以一個規則處理：**目標頁籤不顯示的入口一律不顯示**（`entry.ts` 的 `entryPoints()`，以 `withCrew()` 的頁籤判斷），一般 build 與含問答的線上 demo 的頁籤都有問答與上傳，行為不變。逐頁的處理：
   - 首頁：提問框與預設問題、「以前答不出來」的提示、「問過的問題」（再問一次）不顯示，提問框的位置換成一行說明（crew 翻譯檔的 `noAsk`）；「等你處理」（切到待審）與「有更新」（切到上傳）不顯示；「最近新增的文件」（開時間軸）與「最近看過」（開圖譜）保留。
   - 圖譜：實體面板的「在問答中問」、A 鍵與按鍵表的 A 不顯示（`onAskAbout` 省略）；撤回核准只寫瀏覽器內的資料庫，保留。
   - 時間軸：沒有切到問答或呼叫 `/api/*` 的入口，不改。
   預設頁當時仍是 AI 員工的「今天」；#96 起「直接體驗」後進首頁的今天的工作，#100 拿掉 AI 員工頁籤內的「今天」子頁（點進 AI 員工預設是「工作與驗收」）。以主管進入、可切換身分不變。

## 後果

- **新增的接入點**（修訂 ADR 0004 的清單）：`app/src/ui/SignInPanel.tsx`（`direct` 屬性）、`app/src/ui/sign-in.ts`（`needsAccessCode`、`accountAccessCode` 的固定值參數）；部署的 PR 另外加 `wrangler.jsonc`、`docs/deploy.md`、`playwright.config.ts`、`.github/workflows/e2e.yml`。判斷集中在 crew 的 `entry.ts`，knowledge-kit 檔案只是呼叫處與短條件，同步上游時在這幾處留意衝突。
- #91 改到的 knowledge-kit 檔案：`app/src/App.tsx`（以 `entryPoints()` 決定首頁與圖譜的入口）、`app/src/ui/HomePage.tsx`（`onAsk` 可省略、`askNote`）、`app/src/ui/GraphPage.tsx` 與 `app/src/ui/EntityPanel.tsx`（`onAskAbout` 可省略）。
- 「直接體驗」的文字放在 crew 的翻譯檔（`client/i18n/crew/common.<語言>.json` 的 `directEntry`），不加 knowledge-kit 的必填鍵，示範客戶的翻譯檔不必改。
- **後續工作**（#84 的 PR 2）：wrangler 改名與新設定檔、以這個開關 build 的 E2E 與 CI job（先不設為必要檢查）、`docs/deploy.md` 的新章節、README；網址由人部署後補。

## 修訂（2026-11-22，#96）

- 決定 6 的「預設頁仍是 AI 員工的『今天』」改為**首頁**：首頁加入了今天的工作（#96），「直接體驗」後以主管進入首頁就看到待驗收與少看建議（`entry.ts` 的 `crewDefaultView()`）。切換身分後目前頁籤看不到時同樣回到首頁。其他決定不變；`crew-only.spec.ts` 仍斷言整個流程沒有 `/api/*` 請求。
