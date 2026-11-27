// AI 員工的 README 截圖（knowledge-crew #106）：桌機 1440×900 的首頁今天的工作、總覽（#134）、驗收面板（Rowan 的回信）、信任時間軸、
// 員工頁 Rowan 的卡（守則：一條等確認、一條生效）與守則文件的原文面板（這條守則的來歷）（#151）、k17 的「這次抽查」與 k01 的事後更正（#171），與手機 390×844 的驗收面板（固定的決定列）與總覽（#134），寫到 docs/crew/images/<名稱>.png。
// 不是測試，預設不執行：KC_README_SHOTS=1 時 playwright.config.ts 只執行這個檔案（重新產生的方式見 docs/testing.md「AI 員工的 README 截圖」）。
// 參考情境（client/）的虛構資料、預設語言、主管身分、Light 模式、減少動態效果；/api/ask 是 openApp() 的假回應（不呼叫模型）；
// openApp() 以邀請碼登入後才截圖，截圖中沒有登入頁與邀請碼。
import { expect, test, type Page } from "@playwright/test";
import { expandTimelineEntry, gotoView, openApp, s, switchIdentity } from "./support/app";
import { access, language, readClientJson } from "./support/client";
import { crewContent, ct, employeeName, gotoCrewSection, gotoWorksBoard, hasCrewDemo, homeToday, openCrew, reviewPanel, trustRow, worksViewSwitch } from "./support/crew";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const shotPath = (name: string) => `docs/crew/images/${name}.png`;
const manager = access.roles.find((r) => r.canReview && r.canUpload);

// Rowan 待驗收的回信（虛構資料的 s14）
const demoTitle = (id: string) =>
  hasCrewDemo ? readClientJson<{ assignments: { id: string; title: Record<string, string> }[] }>("crew/demo.json").assignments.find((a) => a.id === id)!.title[language] : "";
const rowanReply = demoTitle("s14");

test.use({ colorScheme: "light", reducedMotion: "reduce" });

test.beforeEach(() => {
  test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 AI 員工）");
  test.skip(manager === undefined, "access.json 沒有同時 canUpload 與 canReview 的身分");
});

async function start(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, manager!.id);
}

// 「工作與驗收」以標題在清單選取虛構資料的一件交辦（待驗收或最近驗收過的）
async function openWork(page: Page, id: string): Promise<void> {
  const title = demoTitle(id);
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  await expect(reviewPanel(page, title)).toBeVisible();
}

async function openRowanReply(page: Page): Promise<void> {
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: rowanReply }).click();
  await expect(reviewPanel(page, rowanReply)).toBeVisible();
}

test.describe("桌機", () => {
  test.use({ viewport: DESKTOP });

  test("首頁今天的工作、總覽、驗收面板、信任時間軸", async ({ page }) => {
    await start(page);
    expect(await gotoView(page, "home")).toBe(true);
    await expect(homeToday(page)).toBeVisible();
    await page.screenshot({ path: shotPath("home-today") });

    // 看板（原本的總覽，#134）：#191 起在「工作」的「清單｜看板」切換
    await openCrew(page);
    await gotoWorksBoard(page);
    await expect(page.getByRole("region", { name: ct.overview.boardLabel })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("overview") });
    // 切回清單（#191：再按「工作」的分頁不會改變清單｜看板）
    await worksViewSwitch(page).getByRole("button", { name: ct.common.viewList, exact: true }).click();
    await expect(worksViewSwitch(page).getByRole("button", { name: ct.common.viewList, exact: true })).toHaveAttribute("aria-pressed", "true");

    await openRowanReply(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("review") });

    await gotoCrewSection(page, ct.common.sectionEmployees);
    await expect(trustRow(page, "rowan", "support")).toBeVisible();
    await page.screenshot({ path: shotPath("trust") });
  });

  test("抽查（k17 的「這次抽查」卡）、事後更正（k01 的「通過後發現有錯」）（#171）", async ({ page }) => {
    await start(page);
    await openWork(page, "k17");
    await expect(page.locator(".crew-review__spot")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("spot-check") });

    // k01 較早驗收、不在最近驗收過的清單：從工作帳本的「事後更正」點進去
    await gotoCrewSection(page, ct.common.sectionRecords);
    await crewContent(page).getByRole("combobox", { name: new RegExp(`^${ct.ledger.filterEvent}`) }).selectOption({ label: ct.ledger.eventReturned });
    const row = page.getByRole("table", { name: ct.ledger.listLabel }).locator("tbody").getByRole("row").filter({ hasText: ct.ledger.kindCorrected });
    await row.getByRole("button", { name: demoTitle("k01"), exact: true }).click();
    await expect(reviewPanel(page, demoTitle("k01"))).toBeVisible();
    const correction = page.locator(".crew-review__correction");
    await expect(correction).toBeVisible();
    await correction.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shotPath("correction") });
  });

  test("員工頁 Rowan 的守則、守則文件的原文面板（#151）", async ({ page }) => {
    await start(page);
    await openCrew(page);
    await gotoCrewSection(page, ct.common.sectionEmployees);
    // Rowan 的卡：g02 等確認、g01 生效（虛構資料）
    const rowan = page.getByRole("region", { name: employeeName("rowan") }).filter({ has: page.locator(".crew-employees__top") });
    await expect(rowan.locator(".crew-employees__guideline[data-status=pending]")).toHaveCount(1);
    await expect(rowan.locator(".crew-employees__guideline[data-status=active]")).toHaveCount(1);
    await rowan.screenshot({ path: shotPath("guidelines") });

    // g01（Rowan 的「先回答再說明」守則）的文件：時間軸展開 → 打開原文 → 這條守則的來歷
    expect(await gotoView(page, "timeline")).toBe(true);
    const entry = page.locator('ol.timeline > li[data-document-id="crew-guideline-g01"]');
    await expandTimelineEntry(entry);
    await entry.getByRole("button", { name: s.openSource }).first().click();
    const origin = page.getByRole("region", { name: ct.knowledge.guidelineTitle, exact: true });
    await expect(origin).toBeVisible();
    // 只截原文面板（時間軸的其他文件不入鏡）
    await page.locator("aside.source").filter({ has: origin }).screenshot({ path: shotPath("provenance") });
  });
});

test.describe("手機", () => {
  test.use({ viewport: MOBILE });

  test("驗收面板（固定的決定列）", async ({ page }) => {
    await start(page);
    await openRowanReply(page);
    // 捲到面板的全文，決定列固定在底部分頁列之上
    await reviewPanel(page, rowanReply).locator(".crew-review__decision").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("mobile-review") });
  });

  test("總覽（#134：專案卡片直向排列，看板是依狀態切換的清單）", async ({ page }) => {
    await start(page);
    await openCrew(page);
    // #191：看板在「工作」的「清單｜看板」切換
    await gotoWorksBoard(page);
    await expect(page.getByRole("region", { name: ct.overview.boardLabel })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("mobile-overview"), fullPage: true });
  });
});
