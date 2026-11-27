// 事後更正的畫面（#164，crew ADR 0008 第 1～6、15 點）：已更正的 k01-2 在驗收面板與原文面板的呈現；
// 對 Linden 看重點期間通過的 k12 記下更正（沒被標成重點）→ 面板顯示更正、改回逐項看 → 帳本的兩筆 → 信任頁那一格中空。
// 1280 與 390 各跑一次更正的流程，截圖附在測試報告。只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { DemoFile } from "../app/src/crew/demo/types";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { assignmentTitle, crewContent, crewFill, ct, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel, shortDay, trustRow, workTypeName } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const assignments = hasCrewDemo ? readClientJson<DemoFile>("crew/demo.json").assignments : [];
const k01Review = assignments.find((a) => a.id === "k01")?.works[1]?.review;
const k01Correction = k01Review?.verdict === "accepted" ? k01Review.correction : undefined;

const table = (page: Page) => page.getByRole("table", { name: ct.ledger.listLabel });
const rows = (page: Page) => table(page).locator("tbody").getByRole("row");
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 帶 {date} 的文字：日期是 MM/DD（今天的更正不比對日期） */
const withDate = (template: string) => new RegExp(`^${escape(template).replace("\\{date\\}", "\\d{2}/\\d{2}")}$`);
// 原文面板（桌機是 aside、手機是 dialog）的「這條知識經過的把關」
const originRegion = (page: Page) => page.getByRole("region", { name: ct.knowledge.originTitle, exact: true });

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`correction-${name}-${page.viewportSize()!.width}px.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function openWork(page: Page, id: string): Promise<Locator> {
  await gotoCrewSection(page, ct.common.sectionWorks);
  const title = assignmentTitle(id);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  return panel;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
});

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("k01-2（已更正）：帳本的「事後更正」連到那次驗收；面板只有更正的日期與備註；原文面板多一行「通過後發現有錯」", async ({ page }, testInfo) => {
    test.skip(!k01Correction, "demo 的 k01-2 沒有事後更正");
    const date = shortDay(k01Correction!.correctedAt);
    const note = k01Correction!.note![language];
    await gotoCrewSection(page, ct.common.sectionLedger);
    await crewContent(page).getByRole("combobox", { name: new RegExp(`^${ct.ledger.filterEvent}`) }).selectOption({ label: ct.ledger.eventReturned });
    const row = rows(page).filter({ hasText: ct.ledger.kindCorrected });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(note);
    await row.getByRole("button", { name: assignmentTitle("k01"), exact: true }).click();

    const panel = reviewPanel(page, assignmentTitle("k01"));
    await expect(panel).toBeVisible();
    await expect(panel.getByText(crewFill(ct.review.correctionDone, { date }), { exact: true })).toBeVisible();
    await expect(panel.getByText(crewFill(ct.review.correctionNoteShown, { note }), { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: ct.review.correctionOpen, exact: true })).toHaveCount(0);
    await shot(page, testInfo, "done-panel");

    await panel.getByRole("button", { name: ct.review.knowledgeOpen, exact: true }).click();
    await expect(originRegion(page).getByText(crewFill(ct.knowledge.originCorrected, { date }), { exact: true })).toBeVisible();
    await shot(page, testInfo, "origin-k01");
  });
});

for (const width of [1280, 390]) {
  test(`主管（${width}）：對看重點期間通過的 k12 記下更正 → 改回逐項看、帳本兩筆、信任頁那一格中空`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const linden = () => trustRow(page, "linden", "knowledge");
    await gotoCrewSection(page, ct.common.sectionTrust);
    await expect(linden().locator(".crew-level-badge")).toHaveText(crewFill(ct.trust.levelBadge, { level: ct.trust.levelLight }));
    await expect(linden().locator(".crew-trust__dot[data-corrected]")).toHaveCount(0);

    const panel = await openWork(page, "k12");
    const open = panel.getByRole("button", { name: ct.review.correctionOpen, exact: true });
    const note = panel.getByRole("textbox", { name: ct.review.correctionNote, exact: true });
    // 鍵盤：打開時焦點在輸入框，取消後回到按鈕
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(note).toBeFocused();
    await panel.getByRole("button", { name: ct.review.cancel, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();

    await open.click();
    await expect(panel.getByText(crewFill(ct.review.correctionConsequenceLight, { workType: workTypeName("knowledge") }), { exact: true })).toBeVisible();
    await note.fill("Cutoff is 15:00, not 17:00");
    await panel.getByRole("checkbox", { name: ct.review.correctionNotInPoints, exact: true }).check();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, testInfo, "form");
    await panel.getByRole("button", { name: ct.review.correctionSubmit, exact: true }).click();

    await expect(panel.getByText(withDate(ct.review.correctionDone))).toBeVisible();
    await expect(panel.getByText(crewFill(ct.review.correctionNoteShown, { note: "Cutoff is 15:00, not 17:00" }), { exact: true })).toBeVisible();
    await expect(open).toHaveCount(0);
    await expect(panel.locator(".crew-level-badge")).toHaveText(crewFill(ct.review.levelBadge, { level: ct.review.levelItem }));
    await expect(panel.getByRole("heading", { name: ct.review.lightTitle, exact: true })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, testInfo, "done");

    // 原文面板（k12 已回流）：多一行「通過後發現有錯」
    await panel.getByRole("button", { name: ct.review.knowledgeOpen, exact: true }).click();
    await expect(originRegion(page).getByText(withDate(ct.knowledge.originCorrected))).toBeVisible();
    await shot(page, testInfo, "origin");
    // 手機的原文是 dialog，關閉後才切子頁；桌機的原文欄不擋操作
    await page.keyboard.press("Escape");

    // 帳本：最新兩筆是「因事後更正改回逐項看」與「事後更正」（備註在工作欄）
    await gotoCrewSection(page, ct.common.sectionLedger);
    await expect(rows(page).nth(0)).toContainText(ct.ledger.kindAutoResetCorrection);
    await expect(rows(page).nth(1)).toContainText(ct.ledger.kindCorrected);
    await expect(rows(page).nth(1)).toContainText("Cutoff is 15:00, not 17:00");
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, testInfo, "ledger");

    // 信任頁：改回逐項看，k12 那一格中空，名稱是「通過，MM/DD 事後更正為做錯了」，有圖例
    await gotoCrewSection(page, ct.common.sectionTrust);
    await expect(linden().locator(".crew-level-badge")).toHaveText(crewFill(ct.trust.levelBadge, { level: ct.trust.levelItem }));
    await expect(linden().locator(".crew-trust__dot[data-corrected]")).toHaveCount(1);
    const prefix = ct.trust.dotCorrected.split("{date}")[0];
    await expect(linden().locator(".crew-trust__cell").filter({ has: page.locator(".crew-trust__dot[data-corrected]") })).toHaveAttribute("aria-label", new RegExp(`^${escape(prefix)}`));
    await expect(linden().getByText(ct.trust.dotLegendCorrected, { exact: true })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, testInfo, "trust");
  });
}
