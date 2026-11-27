// 頁首與分頁元件（#179，設計規格 v4 第 4 節「頁首」）：AI 員工的每個子頁、待審與上傳在桌機 1280 與手機 390 都剛好一個 h1，
// 切換畫面後焦點在 h1；AI 員工是小字「AI 員工」＋子頁主標題＋分頁（nav），待審、上傳的分頁是 tablist（左右鍵切換）。
// 首頁、問答、圖譜、時間軸、評測台（#179 的第 2 個 PR）同樣用共用頁首：一個 h1（照 v5 的 HTML 是頁面名稱，首頁是問候）與一句說明。
import { expect, test, type Page } from "@playwright/test";
import { EVALS_PATH, gotoView, openApp, s, switchIdentity } from "./support/app";
import { reviewer, reviewingUploader } from "./support/client";
import { ct, crewSections, gotoCrewSection, hasCrewDemo, openCrew } from "./support/crew";

const SECTIONS = ["sectionOverview", "sectionEmployees", "sectionAssignments", "sectionWorks", "sectionTrust", "sectionLedger"] as const;
const h1 = (page: Page) => page.locator("h1");
const greetings = new RegExp(`^(${[s.home.morning, s.home.afternoon, s.home.evening].join("|")})$`);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function expectOnlyH1(page: Page, name: string | RegExp): Promise<void> {
  await expect(h1(page)).toHaveCount(1);
  await expect(h1(page)).toHaveText(name);
  await expect(h1(page)).toBeFocused();
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("AI 員工：每個子頁一個 h1（子頁名稱），切換後焦點在 h1；小字「AI 員工」在頁首，「虛構資料」只在外框", async ({ page }) => {
      test.skip(!hasCrewDemo, "客戶沒有 crew 的示範資料");
      await openApp(page);
      await switchIdentity(page, "manager");
      await openCrew(page);
      const header = page.locator(".crew-page > .ui-page-head");
      await expect(header.locator(".ui-page-head__eyebrow")).toHaveText(ct.common.title);
      // 「虛構資料」只在外框（#182），頁首沒有
      await expect(header).not.toContainText(s.fictionalData);
      // 分頁在頁首內，是 nav（不是 tablist）
      await expect(header.getByRole("navigation", { name: ct.common.sectionsLabel })).toBeVisible();
      await expect(header.getByRole("tablist")).toHaveCount(0);
      await expectOnlyH1(page, ct.common.sectionOverview);
      for (const key of SECTIONS.slice(1)) {
        await gotoCrewSection(page, ct.common[key]);
        await expectOnlyH1(page, ct.common[key]);
        expect(await noHorizontalScroll(page)).toBe(true);
      }
      // 手機：目前的分頁（最後一個）捲進分頁列，看得見
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionLedger, exact: true })).toBeInViewport();
    });

    test("待審與上傳：一個 h1、說明與分頁（tablist，左右鍵切換）；切換畫面後焦點在 h1", async ({ page }) => {
      test.skip(reviewingUploader === undefined, "access.json 沒有能上傳又能審核的身分");
      await openApp(page);
      await switchIdentity(page, reviewingUploader!.id);

      expect(await gotoView(page, "review")).toBe(true);
      await expectOnlyH1(page, s.tabReview);
      await expect(page.getByText(s.reviewLead, { exact: true })).toBeVisible();
      const reviewTabs = page.getByRole("tablist", { name: s.reviewStatusTabs });
      const first = reviewTabs.getByRole("tab").first();
      await expect(first).toHaveAttribute("aria-selected", "true");
      await first.focus();
      await page.keyboard.press("ArrowRight");
      const second = reviewTabs.getByRole("tab").nth(1);
      await expect(second).toHaveAttribute("aria-selected", "true");
      await expect(second).toBeFocused();
      await page.keyboard.press("End");
      await expect(reviewTabs.getByRole("tab").last()).toBeFocused();
      await expect(reviewTabs.getByRole("tab").last()).toBeInViewport();
      expect(await noHorizontalScroll(page)).toBe(true);

      expect(await gotoView(page, "upload")).toBe(true);
      await expectOnlyH1(page, s.tabUpload);
      await expect(page.getByText(s.uploadLead, { exact: true })).toBeVisible();
      const uploadTabs = page.getByRole("tablist", { name: s.myUploads.sections });
      const newTab = uploadTabs.getByRole("tab", { name: s.myUploads.tabNew });
      await expect(newTab).toHaveAttribute("aria-selected", "true");
      await newTab.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(uploadTabs.getByRole("tab", { name: new RegExp(`^${s.myUploads.tabMine}`) })).toBeFocused();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test("首頁、問答、圖譜、時間軸、評測台：每頁一個 h1，切換畫面後焦點在 h1；說明照 HTML", async ({ page }) => {
      // 評測台只在 ?tools=evals 時有頁籤
      await openApp(page, EVALS_PATH);
      if (reviewer !== undefined) await switchIdentity(page, reviewer.id);
      // 依序切換：每次切換後只有新頁面的 h1，且焦點在它上面
      const pages: Array<{ view: string; name: string | RegExp; lead?: string }> = [
        { view: "home", name: greetings },
        { view: "qa", name: s.tabQa, lead: s.qaHeaderNote },
        { view: "graph", name: s.tabGraph },
        { view: "timeline", name: s.tabTimeline },
        { view: "evals", name: s.tabEvals },
      ];
      let visited = 0;
      for (const target of pages) {
        if (!(await gotoView(page, target.view))) continue;
        visited += 1;
        await expectOnlyH1(page, target.name);
        const header = page.locator(".ui-page-head").filter({ has: h1(page) });
        await expect(header).toHaveCount(1);
        if (target.lead !== undefined) await expect(header.locator(".ui-page-head__lead")).toHaveText(target.lead);
        expect(await noHorizontalScroll(page)).toBe(true);
      }
      // 首頁、問答、圖譜、時間軸一定看得到；評測台要能審核的身分
      expect(visited).toBeGreaterThanOrEqual(reviewer === undefined ? 4 : 5);
    });
  });
}
