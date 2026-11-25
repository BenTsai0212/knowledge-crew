// 守則進知識庫（#149，crew ADR 0007 決定 7）：主管在員工頁確認 g02 → 知識庫出現這份文件 → 打開原文看到「這條守則的來歷」與生效中 →
// 「到員工頁」捲到 Rowan；打開 demo 中已收回的 g04 的文件看到「已收回」→「看那次退回」回到 k01。1280 與 390 各跑一次。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import type { DemoFile } from "../app/src/crew/demo/types";
import { expandTimelineEntry, gotoView, openApp, s, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { assignmentTitle, crewSections, ct, employeeName, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel, shortDay } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const guidelines = hasCrewDemo ? readClientJson<DemoFile>("crew/demo.json").guidelines : [];
const text = (id: string) => guidelines.find((g) => g.id === id)!.text[language];
// 帶參數的文字：第一個參數之前的固定部分（en 的單複數寫法也適用）
const lead = (template: string) => template.split("{")[0].trim();
// 守則文件的 id（app/src/crew/knowledge/guideline-document.ts 的 guidelineDocumentId()；該模組讀 crew 的翻譯檔，E2E 不 import）
const guidelineDocumentId = (id: string) => `crew-guideline-${id}`;

const card = (page: Page, id: string) => page.getByRole("region", { name: employeeName(id) }).filter({ has: page.locator(".crew-employees__top") });
const origin = (page: Page) => page.getByRole("region", { name: ct.knowledge.guidelineTitle, exact: true });

async function openDocument(page: Page, guidelineId: string): Promise<void> {
  expect(await gotoView(page, "timeline")).toBe(true);
  const entry = page.locator(`ol.timeline > li[data-document-id="${guidelineDocumentId(guidelineId)}"]`);
  await expandTimelineEntry(entry);
  await entry.getByRole("button", { name: s.openSource }).first().click();
}

for (const width of [1280, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test.beforeEach(async ({ page }) => {
      await openApp(page);
      await switchIdentity(page, "manager");
    });

    test("確認 g02 → 知識庫出現守則的文件，原文有「這條守則的來歷」與生效中 →「到員工頁」捲到 Rowan", async ({ page }) => {
      await openCrew(page);
      await gotoCrewSection(page, ct.common.sectionEmployees);
      const pending = card(page, "rowan").getByRole("listitem").filter({ hasText: text("g02") });
      await pending.getByRole("button", { name: ct.employees.guidelineConfirm, exact: true }).click();
      await expect(pending.getByRole("button", { name: ct.employees.guidelineRetire, exact: true })).toBeVisible();

      await openDocument(page, "g02");
      const block = origin(page);
      await expect(block).toBeVisible();
      await expect(block).toContainText(employeeName("rowan"));
      // #151：員工提出的守則，第一、二行的名字都有 AI 標記
      await expect(block.locator(".crew-employee-name")).toHaveCount(2);
      await expect(block).toContainText(lead(ct.knowledge.guidelineFromEmployee));
      await expect(block).toContainText(lead(ct.knowledge.guidelineActive));
      await expect(block).not.toContainText(lead(ct.knowledge.guidelineRevoked));
      // 守則的文件不是回流的文件：沒有「這條知識經過的把關」
      await expect(page.getByRole("region", { name: ct.knowledge.originTitle, exact: true })).toHaveCount(0);

      await block.getByRole("button", { name: ct.knowledge.guidelineOpenEmployee, exact: true }).click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionEmployees, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(card(page, "rowan")).toBeInViewport();
      await expect(block).toHaveCount(0);
    });

    test("demo 中已收回的 g04：原文標出已收回 →「看那次退回」回到 k01", async ({ page }) => {
      await openDocument(page, "g04");
      const block = origin(page);
      await expect(block).toBeVisible();
      await expect(block).toContainText(employeeName("linden"));
      // #151：員工名字有 AI 標記；確認與收回的日期是短格式（MM/DD）
      await expect(block.locator(".crew-employee-name").first()).toContainText(employeeName("linden"));
      const [confirmed, revoked] = guidelines.find((g) => g.id === "g04")!.decisions;
      for (const d of [confirmed, revoked]) await expect(block).toContainText(shortDay(d.decidedAt));
      await expect(block).not.toContainText("2026");
      await expect(block).toContainText(lead(ct.knowledge.guidelineRevoked));
      await expect(block).toHaveClass(/crew-source-origin--revoked/);

      await block.getByRole("button", { name: ct.knowledge.guidelineOpenReturn, exact: true }).click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(reviewPanel(page, assignmentTitle("k01"))).toBeVisible();
    });
  });
}

test.describe("一般員工", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("看得到青翼專案的 g01 的文件與來歷，知識庫沒有長堤專案的 g04", async ({ page }) => {
    await openApp(page);
    await switchIdentity(page, "staff");
    await openDocument(page, "g01");
    await expect(origin(page)).toBeVisible();
    await expect(origin(page)).toContainText(lead(ct.knowledge.guidelineFromHuman));
    await expect(page.locator(`ol.timeline > li[data-document-id="${guidelineDocumentId("g04")}"]`)).toHaveCount(0);
  });
});
