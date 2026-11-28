// 抽查的畫面（#166，crew ADR 0008 第 7～11 點）：k17（Linden 看重點期間的第 5 件）是「這次抽查」卡片、內容逐項列出、清單有標籤；
// k13（第 6 件）的「這次逐項看」只改這次怎麼看（不寫入、換一件後回到預設）；信任頁的抽查記號與說明、報表的抽查欄。
// 桌機 1280 與手機 390 各跑一次，截圖附在測試報告（`spot-*.png`）。只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { theme } from "./support/client";
import { assignmentTitle, crewFill, ct, gotoCrewSection, gotoRecordsStats, hasCrewDemo, openCrew, reviewPanel, trustRow } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const workList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
const listItem = (page: Page, id: string) => workList(page).getByRole("button").filter({ hasText: assignmentTitle(id) });
const ledgerRows = (page: Page) => page.getByRole("table", { name: ct.ledger.listLabel }).locator("tbody").getByRole("row");
const report = (page: Page) => page.getByRole("table", { name: ct.trust.reportLabel });
const reportSpotCell = (page: Page, employee: string, workType: string) =>
  report(page).locator(`tbody tr[data-employee="${employee}"][data-work-type="${workType}"]`).getByRole("cell").nth(5);
const spotSummary = (s: { accepted: number; wrong: number; other: number }) =>
  crewFill(ct.trust.spotSummary, { ...s, count: s.accepted + s.wrong + s.other });
// 抽查格的名稱：「（原本的結果）（抽查），MM/DD」
const spotLabel = (result: string) => new RegExp(`^${escape(crewFill(ct.trust.dotSpot, { result, date: "{date}" })).replace("\\{date\\}", ".+")}$`);

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function shot(page: Page, testInfo: TestInfo, name: string, target?: Locator): Promise<void> {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: true });
  await testInfo.attach(`spot-${name}-${page.viewportSize()!.width}px.png`, { body, contentType: "image/png" });
}

async function openWork(page: Page, id: string): Promise<Locator> {
  await listItem(page, id).click();
  const panel = reviewPanel(page, assignmentTitle(id));
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
});

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("k17：清單有「抽查」標籤；面板是「這次抽查」卡片（第 5 件）、層級仍是看重點、內容逐項列出", async ({ page }, testInfo) => {
      await expect(listItem(page, "k17").getByText(ct.review.spotTag, { exact: true })).toBeVisible();
      await expect(listItem(page, "k13").getByText(ct.review.spotTag, { exact: true })).toHaveCount(0);
      const panel = await openWork(page, "k17");
      const card = panel.getByRole("region", { name: ct.review.spotTitle });
      await expect(card).toBeVisible();
      await expect(card).toHaveCSS("border-top-color", rgb(theme.colors.warning));
      await expect(card.getByText(crewFill(ct.review.spotWhy, { every: 5, ordinal: 5 }), { exact: true })).toBeVisible();
      await expect(card.getByText(ct.review.spotRule, { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: ct.review.lightTrust, exact: true })).toBeVisible();
      await expect(panel.getByRole("region", { name: ct.review.lightTitle })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: ct.review.fullOnce })).toHaveCount(0);
      await expect(panel.locator(".crew-level-badge")).toHaveText(crewFill(ct.review.levelBadge, { level: ct.review.levelLight }));
      // 逐項看：沒有收起的欄位與收成一行的變更
      await expect(panel.locator(".crew-collapsed, .crew-review__changes-collapsed")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k17-panel");
    });

    test("k13：「這次逐項看」展開全部、再按回到看重點；換一件後回到預設；紀錄沒有新增事件", async ({ page }, testInfo) => {
      await gotoCrewSection(page, ct.common.sectionRecords);
      const newest = (await ledgerRows(page).first().textContent()) ?? "";
      await gotoCrewSection(page, ct.common.sectionWorks);

      const panel = await openWork(page, "k13");
      const card = panel.getByRole("region", { name: ct.review.lightTitle });
      await expect(card).toBeVisible();
      await expect(panel.getByRole("region", { name: ct.review.spotTitle })).toHaveCount(0);
      const button = card.getByRole("button", { name: ct.review.fullOnce, exact: true });
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(panel.locator(".crew-collapsed")).toHaveCount(1);
      await expect(panel.locator(".crew-review__changes-collapsed")).toHaveCount(1);
      await shot(page, testInfo, "k13-before");

      // 鍵盤操作
      await button.focus();
      await page.keyboard.press("Enter");
      const back = card.getByRole("button", { name: ct.review.fullOnceBack, exact: true });
      await expect(back).toHaveAttribute("aria-pressed", "true");
      await expect(back).toBeFocused();
      await expect(card.getByText(ct.review.fullOnceNote, { exact: true })).toBeVisible();
      await expect(panel.locator(".crew-collapsed, .crew-review__changes-collapsed")).toHaveCount(0);
      await expect(panel.locator(".crew-level-badge")).toHaveText(crewFill(ct.review.levelBadge, { level: ct.review.levelLight }));
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "k13-after");

      await page.keyboard.press("Space");
      await expect(card.getByRole("button", { name: ct.review.fullOnce, exact: true })).toHaveAttribute("aria-pressed", "false");
      await expect(card.getByText(ct.review.fullOnceNote, { exact: true })).toHaveCount(0);
      await expect(panel.locator(".crew-collapsed")).toHaveCount(1);

      // 按下後換到別的工作再回來：回到預設
      await card.getByRole("button", { name: ct.review.fullOnce, exact: true }).click();
      await openWork(page, "k17");
      const again = await openWork(page, "k13");
      await expect(again.getByRole("button", { name: ct.review.fullOnce, exact: true })).toHaveAttribute("aria-pressed", "false");
      await expect(again.locator(".crew-collapsed")).toHaveCount(1);

      await gotoCrewSection(page, ct.common.sectionRecords);
      await expect(ledgerRows(page).first()).toHaveText(newest);
    });

    test("員工頁的審查方式與紀錄的統計：Rowan、Juniper 那一格有抽查記號與說明；Linden 沒有；報表的抽查欄", async ({ page }, testInfo) => {
      await gotoCrewSection(page, ct.common.sectionEmployees);
      const rowan = trustRow(page, "rowan", "support");
      await expect(rowan.locator(".crew-trust__dot[data-spot]")).toHaveCount(1);
      await expect(rowan.locator(".crew-trust__cell").filter({ has: page.locator(".crew-trust__dot[data-spot]") })).toHaveAttribute("aria-label", spotLabel(ct.trust.dotWrong));
      await expect(rowan.getByText(spotSummary({ accepted: 0, wrong: 1, other: 0 }), { exact: true })).toBeVisible();
      await expect(rowan.getByText(ct.trust.dotLegendSpot, { exact: true })).toBeVisible();
      const juniper = trustRow(page, "juniper", "dev");
      await expect(juniper.locator(".crew-trust__cell").filter({ has: page.locator(".crew-trust__dot[data-spot]") })).toHaveAttribute("aria-label", spotLabel(ct.trust.dotOk));
      await expect(juniper.getByText(spotSummary({ accepted: 1, wrong: 0, other: 0 }), { exact: true })).toBeVisible();
      const linden = trustRow(page, "linden", "knowledge");
      await expect(linden.locator(".crew-trust__dot[data-spot]")).toHaveCount(0);
      await expect(linden.locator(".crew-trust__spot")).toHaveCount(0);
      await expect(linden.getByText(ct.trust.dotLegendSpot, { exact: true })).toHaveCount(0);
      // 抽查記號是外框，不只靠顏色（名稱寫出「抽查」）；外框是 primary
      await expect(rowan.locator(".crew-trust__dot[data-spot]")).toHaveCSS("outline-color", rgb(theme.colors.primary));
      await shot(page, testInfo, "trust-rowan", rowan);

      // #191：報表在「紀錄」的「看統計」
      await gotoRecordsStats(page);
      await expect(reportSpotCell(page, "rowan", "support")).toHaveText(crewFill(ct.trust.reportSpot, { count: 1, wrong: 1 }));
      await expect(reportSpotCell(page, "juniper", "dev")).toHaveText(crewFill(ct.trust.reportSpot, { count: 1, wrong: 0 }));
      await expect(reportSpotCell(page, "linden", "knowledge")).toHaveText(ct.trust.reportNone);
      await expect(reportSpotCell(page, "sorrel", "content")).toHaveText(ct.trust.reportNone);
      expect(await noHorizontalScroll(page)).toBe(true);
      await shot(page, testInfo, "report", report(page));
    });

    test("對 k17 按「通過」後：員工頁 Linden 出現抽查格與說明（通過 1）", async ({ page }) => {
      const panel = await openWork(page, "k17");
      await panel.getByRole("button", { name: ct.review.accept, exact: true }).click();
      await expect(listItem(page, "k17").getByText(ct.review.spotTag, { exact: true })).toHaveCount(0);
      await gotoCrewSection(page, ct.common.sectionEmployees);
      const linden = trustRow(page, "linden", "knowledge");
      await expect(linden.locator(".crew-trust__dot[data-spot]")).toHaveCount(1);
      await expect(linden.getByText(spotSummary({ accepted: 1, wrong: 0, other: 0 }), { exact: true })).toBeVisible();
      await gotoRecordsStats(page);
      await expect(reportSpotCell(page, "linden", "knowledge")).toHaveText(crewFill(ct.trust.reportSpot, { count: 1, wrong: 0 }));
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
