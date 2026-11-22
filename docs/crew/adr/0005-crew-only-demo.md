# ADR 0005：只展示 AI 員工的線上 demo

- 狀態：Accepted
- 日期：2026-11-22
- 決定者：@BenTsai0212
- 相關：#84 的 `## 計畫` 與 `## 決定`、ADR 0002、ADR 0004、knowledge-kit 的 `docs/adr/0005-online-demo.md`

## 背景

決定者要先部署一個只展示 AI 員工的線上 demo，含問答的完整版等下一版。AI 員工全部在瀏覽器內執行（PGlite＋`client/crew/demo.json`），不呼叫 `/api/*`；但 knowledge-kit 的線上 demo（`VITE_ONLINE_DEMO=1`）有問答與上傳萃取，需要 Worker、Durable Object 與 secret，登入頁也要求邀請碼。`wrangler.jsonc` 繼承自 knowledge-kit，名稱不改就部署會覆蓋 knowledge-kit 的線上 demo。

## 選項

- **部署方式**：A. Workers 的 assets-only（另一個設定檔，沒有 `main` 與 Durable Object）；B. 沿用 `env.demo` 的 Worker＋DO、不設 secret；C. Cloudflare Pages。
- **開關**：擴充 `VITE_ONLINE_DEMO`；或新的 `VITE_CREW_ONLY`。
- **知識庫的其他頁**：全部不顯示；或保留時間軸、圖譜。

## 決定

1. **部署：A，assets-only**。新檔 `wrangler.crew-demo.jsonc`，Worker 名稱 `knowledge-crew-demo`，免費方案、`workers.dev`、沒有 secret；`wrangler.jsonc` 頂層改為 `knowledge-crew`，`env.demo` 改為 `knowledge-crew-qa-demo`。部署與 Cloudflare 的設定由人執行。放棄 B：沒用的 Worker 與 DO 補上 secret 就開始產生費用，界線不清楚；放棄 C：回退與監控要另寫一套。`env.*` 無法取消頂層的 `main`，所以另開設定檔而不是新增 env。
2. **開關：新的 `VITE_CREW_ONLY=1`**（營運開關，預設關閉；只有 `"1"` 開啟），與 `VITE_ONLINE_DEMO` 分開，含問答的線上 demo 行為不變。讀取處是 `app/src/ui/online-demo.ts` 的 `readCrewOnly()`；開啟時身分對照、展示模式與評測台一律關閉。客戶沒有 `demo.json` 時不生效（`app/src/crew/ui/entry.ts` 的 `crewOnlyMode`）。
3. **只留 AI 員工**：開啟時頁籤只有 AI 員工，登入後直接進入（預設是「今天」）；首頁、問答、圖譜、時間軸、上傳、待審、評測台都不顯示（首頁與圖譜有切到問答的入口，保留會擴大對 knowledge-kit 元件的改動）。「虛構資料」「展示用權限」的標示與身分切換保留。
4. **登入不要求邀請碼**：帳號登入不顯示邀請碼欄；「使用邀請碼體驗」換成「直接體驗」，直接進入且可以切換身分；「更換邀請碼」不顯示，不新增「登出」。App 仍以「邀請碼不是 null」代表已登入，crew-only 時存固定值 `CREW_ONLY_ACCESS_CODE`（不是 secret，沒有頁面會送出）。

## 後果

- **新增的接入點**（修訂 ADR 0004 的清單）：`app/src/ui/SignInPanel.tsx`（`direct` 屬性）、`app/src/ui/sign-in.ts`（`needsAccessCode`、`accountAccessCode` 的固定值參數）；部署的 PR 另外加 `wrangler.jsonc`、`docs/deploy.md`、`playwright.config.ts`、`.github/workflows/e2e.yml`。判斷集中在 crew 的 `entry.ts`，knowledge-kit 檔案只是呼叫處與短條件，同步上游時在這幾處留意衝突。
- 「直接體驗」的文字放在 crew 的翻譯檔（`client/i18n/crew/common.<語言>.json` 的 `directEntry`），不加 knowledge-kit 的必填鍵，示範客戶的翻譯檔不必改。
- **後續工作**（#84 的 PR 2）：wrangler 改名與新設定檔、以這個開關 build 的 E2E 與 CI job（先不設為必要檢查）、`docs/deploy.md` 的新章節、README；網址由人部署後補。
