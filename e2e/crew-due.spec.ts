// 交辦的到期日與優先順序（#133）：交辦表單可以填到期日與優先順序，交辦清單與「工作與驗收」顯示到期日與「高」優先；
// demo 的今天固定（client/crew/demo.json 的 today），逾期與即將到期不隨真實日期改變。1280 與 390 都不橫向捲動。
// 只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { assignmentTitle, crewFill, ct, employeeName, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

// 交辦的一句話（使用者輸入的內容，不是介面文字）
const TITLE = "E2E：月底前回覆保固詢問";
const demoToday = hasCrewDemo ? readClientJson<{ today?: string }>("crew/demo.json").today : undefined;

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const reviewList = (page: Page) => page.getByRole("navigation", { name: ct.review.listLabel });
const listItem = (page: Page, title: string) => reviewList(page).getByRole("button").filter({ hasText: title });
// 到期日（YYYY-MM-DD）的月／日，與畫面相同的寫法
const monthDay = (date: string) => new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const dueText = (key: "dueOn" | "dueSoon" | "dueOverdue", date: string) => crewFill(ct.common[key], { date: monthDay(date) });

async function openAsManager(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });

    test("工作與驗收：待驗收的清單與面板顯示到期日（逾期、即將到期、還早）與「高」優先", async ({ page }) => {
      expect(demoToday).toBe("2026-11-20");
      await openAsManager(page);
      await gotoCrewSection(page, ct.common.sectionWorks);

      const s14 = listItem(page, assignmentTitle("s14"));
      await expect(s14.locator(".crew-due")).toHaveText(dueText("dueOverdue", "2026-11-18"));
      await expect(s14.locator(".crew-due")).toHaveAttribute("data-due", "overdue");
      await expect(s14.getByText(ct.common.priorityHigh, { exact: true })).toBeVisible();
      const c11 = listItem(page, assignmentTitle("c11"));
      await expect(c11.locator(".crew-due")).toHaveAttribute("data-due", "soon");
      await expect(c11.locator(".crew-due")).toHaveText(dueText("dueSoon", "2026-11-22"));
      await expect(c11.getByText(ct.common.priorityHigh, { exact: true })).toHaveCount(0);
      const k13 = listItem(page, assignmentTitle("k13"));
      await expect(k13.locator(".crew-due")).toHaveAttribute("data-due", "later");
      // 沒有到期日：不顯示日期，只標「高」
      const j06 = listItem(page, assignmentTitle("j06"));
      await expect(j06.locator(".crew-due")).toHaveCount(0);
      await expect(j06.getByText(ct.common.priorityHigh, { exact: true })).toBeVisible();

      // 逾期是紅色（danger），即將到期是黃色（warning），兩者不同色
      const color = (el: ReturnType<Page["locator"]>) => el.evaluate((node) => getComputedStyle(node).color);
      expect(await color(s14.locator(".crew-due"))).not.toBe(await color(c11.locator(".crew-due")));

      await s14.click();
      const panel = reviewPanel(page, assignmentTitle("s14"));
      await expect(panel.locator(".crew-review__head .crew-due")).toHaveText(dueText("dueOverdue", "2026-11-18"));
      await expect(panel.locator(".crew-review__head").getByText(ct.common.priorityHigh, { exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test("交辦一件有到期日、優先順序高的工作：清單顯示到期日與「高」；沒填的交辦不顯示", async ({ page }) => {
      await openAsManager(page);
      await gotoCrewSection(page, ct.common.sectionAssignments);
      const form = page.getByRole("form", { name: ct.assign.formTitle });
      const due = form.getByLabel(ct.assign.fieldDue, { exact: true });
      const priority = form.getByLabel(ct.assign.fieldPriority, { exact: true });
      // 預設：沒有到期日、一般
      await expect(due).toHaveValue("");
      await expect(priority).toHaveValue("normal");
      expect(await noHorizontalScroll(page)).toBe(true);

      await form.getByRole("textbox", { name: ct.assign.fieldTitle, exact: true }).fill(TITLE);
      await form.getByRole("group", { name: ct.assign.fieldEmployee }).getByRole("radio", { name: new RegExp(employeeName("rowan")) }).check();
      await due.fill("2026-11-21");
      await priority.selectOption("high");
      await form.getByRole("button", { name: ct.assign.submit, exact: true }).click();

      const list = page.getByRole("region", { name: ct.assign.listTitle });
      const item = list.getByRole("listitem").filter({ hasText: TITLE });
      await expect(item.getByText(ct.assign.statusNotSubmitted, { exact: true })).toBeVisible();
      await expect(item.locator(".crew-due")).toHaveText(dueText("dueSoon", "2026-11-21"));
      await expect(item.getByText(ct.common.priorityHigh, { exact: true })).toBeVisible();
      // 送出後表單回到預設
      await expect(due).toHaveValue("");
      await expect(priority).toHaveValue("normal");

      // 沒填到期日與優先順序：與之前相同，清單不顯示
      const plain = "E2E：沒有到期日的交辦";
      await form.getByRole("textbox", { name: ct.assign.fieldTitle, exact: true }).fill(plain);
      await form.getByRole("button", { name: ct.assign.submit, exact: true }).click();
      const plainItem = list.getByRole("listitem").filter({ hasText: plain });
      await expect(plainItem.getByText(ct.assign.statusNotSubmitted, { exact: true })).toBeVisible();
      await expect(plainItem.locator(".crew-due")).toHaveCount(0);
      await expect(plainItem.getByText(ct.common.priorityHigh, { exact: true })).toHaveCount(0);

      // 模擬交件後，「工作與驗收」的待驗收也顯示到期日
      await item.getByRole("button", { name: ct.assign.simulate, exact: true }).click();
      await expect(item.getByText(ct.assign.statusAwaitingReview, { exact: true })).toBeVisible();
      await gotoCrewSection(page, ct.common.sectionWorks);
      await expect(listItem(page, TITLE).locator(".crew-due")).toHaveText(dueText("dueSoon", "2026-11-21"));
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
