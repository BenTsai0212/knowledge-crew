// AI 員工的 4 個子頁（#191，ADR 0009 第二節、設計規格 v5 第 3 節）：工作的「清單｜看板」、員工頁的審查方式（同意與收回）、
// 紀錄的「事件｜統計」，以及從首頁「等你決定」、驗收面板、統計表的數字點過去到對的位置。
// 每個子頁一個 h1 在 page-header.spec.ts（1280 與 390）。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { gotoView, openApp, switchIdentity } from "./support/app";
import {
  assignmentTitle,
  crewContent,
  crewSections,
  ct,
  employeeName,
  gotoCrewSection,
  gotoRecordsStats,
  hasCrewDemo,
  homeToday,
  openCrew,
  reviewPanel,
  trustRow,
  workTypeName,
  worksViewSwitch,
} from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const sectionButton = (page: Page, label: string) => crewSections(page).getByRole("button", { name: label, exact: true });
const employeeCard = (page: Page, id: string) => page.getByRole("region", { name: employeeName(id) }).filter({ has: page.locator(".crew-employees__top") });
const workList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
const activeFilter = (page: Page) => crewContent(page).locator(".crew-ledger__active");

async function openAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });

    test("子頁是工作、員工、交辦、紀錄；工作的「清單｜看板」切換，焦點留在按鈕上，點看板的工作切回清單並選取", async ({ page }) => {
      await openAs(page, "manager");
      await expect(crewSections(page).getByRole("button")).toHaveText([
        // 工作、員工帶數字（待驗收、等你決定）
        new RegExp(`^${ct.common.sectionWorks}`),
        new RegExp(`^${ct.common.sectionEmployees}`),
        ct.common.sectionAssignments,
        ct.common.sectionRecords,
      ]);
      await expect(sectionButton(page, ct.common.sectionWorks)).toHaveAttribute("aria-current", "page");
      const list = worksViewSwitch(page).getByRole("button", { name: ct.common.viewList, exact: true });
      const board = worksViewSwitch(page).getByRole("button", { name: ct.common.viewBoard, exact: true });
      // 預設是清單（原本的「工作與驗收」）
      await expect(list).toHaveAttribute("aria-pressed", "true");
      await expect(board).toHaveAttribute("aria-pressed", "false");
      await expect(workList(page)).toBeVisible();

      await board.click();
      await expect(board).toHaveAttribute("aria-pressed", "true");
      await expect(board).toBeFocused();
      await expect(page.getByRole("region", { name: ct.overview.boardLabel, exact: true })).toBeVisible();
      await expect(workList(page)).toHaveCount(0);

      await list.click();
      await expect(list).toBeFocused();
      await expect(workList(page)).toBeVisible();

      // 看板上點一件工作：切回清單並選取那件
      await board.click();
      const awaiting = page.getByRole("region", { name: ct.overview.boardLabel, exact: true });
      const picker = awaiting.getByRole("group", { name: ct.overview.statusPicker });
      if (await picker.isVisible()) await picker.getByRole("button", { name: new RegExp(`^${ct.overview.statusAwaiting}`) }).click();
      await awaiting.getByRole("button").filter({ hasText: assignmentTitle("c12") }).click();
      await expect(list).toHaveAttribute("aria-pressed", "true");
      await expect(reviewPanel(page, assignmentTitle("c12"))).toBeVisible();
      await expect(workList(page).getByRole("button").filter({ hasText: assignmentTitle("c12") })).toHaveAttribute("aria-current", "true");
    });

    test("員工頁有審查方式：Sorrel 的卡內可同意改為只看標記處，再收回", async ({ page }) => {
      await openAs(page, "manager");
      await gotoCrewSection(page, ct.common.sectionEmployees);
      const row = trustRow(page, "sorrel", "content");
      // 審查方式在 Sorrel 的員工卡內
      await expect(employeeCard(page, "sorrel").locator(".crew-trust__row")).toHaveCount(1);
      await row.getByRole("button", { name: ct.trust.agreeRelax, exact: true }).click();
      await expect(row.locator(".crew-level-badge")).toHaveText(ct.trust.levelLight);
      await expect(employeeCard(page, "sorrel").locator(".crew-employees__top .crew-level-badge")).toHaveText(ct.employees.levelLight);
      await row.getByRole("button", { name: ct.trust.revoke, exact: true }).click();
      await expect(row.locator(".crew-level-badge")).toHaveText(ct.trust.levelItem);
      await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toHaveCount(0);
    });

    test("紀錄的「事件｜統計」切換；統計表的數字切回事件並套用篩選", async ({ page }) => {
      await openAs(page, "manager");
      await gotoCrewSection(page, ct.common.sectionRecords);
      await expect(page.getByRole("table", { name: ct.ledger.listLabel })).toBeVisible();
      await gotoRecordsStats(page);
      await expect(page.getByRole("table", { name: ct.trust.reportLabel })).toBeVisible();
      await expect(page.getByRole("table", { name: ct.ledger.listLabel })).toHaveCount(0);
      const back = crewContent(page).getByRole("button", { name: ct.common.viewEvents, exact: true });
      await back.click();
      await expect(page.getByRole("table", { name: ct.ledger.listLabel })).toBeVisible();
      await expect(crewContent(page).getByRole("button", { name: ct.common.viewStats, exact: true })).toBeFocused();

      // 統計表的一列：切到事件並篩選成該員工＋工作類型
      await gotoRecordsStats(page);
      await page.locator('.crew-trust-report tbody tr[data-employee="rowan"][data-work-type="support"]').getByRole("cell").first().click();
      await expect(sectionButton(page, ct.common.sectionRecords)).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("table", { name: ct.ledger.listLabel })).toBeVisible();
      await expect(activeFilter(page)).toContainText(employeeName("rowan"));
      await expect(activeFilter(page)).toContainText(workTypeName("support"));
    });

    test("首頁「等你決定」與驗收面板的「看審查方式的紀錄」都到員工頁，捲到該員工", async ({ page }) => {
      await openApp(page);
      await switchIdentity(page, "manager");
      expect(await gotoView(page, "home")).toBe(true);
      await homeToday(page).getByRole("region", { name: ct.home.groupDecide, exact: true }).getByRole("button", { name: new RegExp(employeeName("sorrel")) }).click();
      await expect(sectionButton(page, ct.common.sectionEmployees)).toHaveAttribute("aria-current", "page");
      await expect(trustRow(page, "sorrel", "content").getByRole("button", { name: ct.trust.agreeRelax, exact: true })).toBeVisible();
      await expect(employeeCard(page, "sorrel").getByRole("heading", { level: 2 })).toBeInViewport();

      // k17 是 Linden 的抽查：面板的「看審查方式的紀錄」到 Linden 的員工卡
      await gotoCrewSection(page, ct.common.sectionWorks);
      await workList(page).getByRole("button").filter({ hasText: assignmentTitle("k17") }).click();
      await reviewPanel(page, assignmentTitle("k17")).getByRole("button", { name: ct.review.lightTrust, exact: true }).click();
      await expect(sectionButton(page, ct.common.sectionEmployees)).toHaveAttribute("aria-current", "page");
      await expect(trustRow(page, "linden", "knowledge")).toBeVisible();
      await expect(employeeCard(page, "linden").getByRole("heading", { level: 2 })).toBeInViewport();
    });
  });
}
