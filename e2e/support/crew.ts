// knowledge-crew 的 crew 頁籤（#34，ADR 0004 的修訂）：選定的客戶有 crew/demo.json 時，App 在 knowledge-kit 的頁籤之後接上 crew。
// 手機的分頁列與「更多」的斷言以此判斷；沒有 demo.json 的客戶（kestrova-demo、medsupply-demo）維持 knowledge-kit 原本的斷言。
import { existsSync } from "node:fs";
import { clientDir } from "./client";

export const hasCrewDemo = existsSync(`${clientDir}/crew/demo.json`);

// ---- crew 的 E2E 共用操作（#53）：crew-smoke.spec.ts、crew-flow.spec.ts ----
import { expect, type Locator, type Page } from "@playwright/test";
import { language, readClientJson } from "./client";
import { gotoView } from "./app";

// crew 的介面文字（client/i18n/crew/<畫面>.<語言>.json），只讀預設語言；沒有 crew 的客戶不讀（測試整個略過）
type CrewFiles = {
  common: typeof import("@client/i18n/crew/common.zh-TW.json");
  home: typeof import("@client/i18n/crew/home.zh-TW.json");
  employees: typeof import("@client/i18n/crew/employees.zh-TW.json");
  assign: typeof import("@client/i18n/crew/assign.zh-TW.json");
  review: typeof import("@client/i18n/crew/review.zh-TW.json");
  trust: typeof import("@client/i18n/crew/trust.zh-TW.json");
  ledger: typeof import("@client/i18n/crew/ledger.zh-TW.json");
  tour: typeof import("@client/i18n/crew/tour.zh-TW.json");
  overview: typeof import("@client/i18n/crew/overview.zh-TW.json");
  knowledge: typeof import("@client/i18n/crew/knowledge.zh-TW.json");
};
const crewJson = <S extends keyof CrewFiles>(screen: S): CrewFiles[S] =>
  hasCrewDemo ? readClientJson<CrewFiles[S]>(`i18n/crew/${screen}.${language}.json`) : ({} as CrewFiles[S]);
export const ct = {
  common: crewJson("common"),
  home: crewJson("home"),
  employees: crewJson("employees"),
  assign: crewJson("assign"),
  review: crewJson("review"),
  trust: crewJson("trust"),
  ledger: crewJson("ledger"),
  tour: crewJson("tour"),
  overview: crewJson("overview"),
  knowledge: crewJson("knowledge"),
};

// 代入 {key}（只用於沒有單複數寫法的文字）
export function crewFill(template: string, values: Record<string, string | number>): string {
  if (template.includes(", plural")) throw new Error(`crewFill 不處理單複數：${template}`);
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}

// 虛構資料（client/crew/demo.json）：員工、工作類型與工作來源以 id 指定，名稱從資料讀
interface DemoSource {
  id: string;
  kind: string;
  name: string;
  label?: Record<string, string>;
  project: string;
}
interface Demo {
  sources: DemoSource[];
  employees: { id: string; displayName: string }[];
  assignments: { id: string; employee: string; workType: string; source: string; title: Record<string, string> }[];
  simulations: { employee: string; workType: string; replies: { body: Record<string, string> }[] }[];
}
export const demo: Demo = hasCrewDemo
  ? readClientJson<Demo>("crew/demo.json")
  : { sources: [], employees: [], assignments: [], simulations: [] };
// 畫面的短日期 MM/DD（UTC；與 app/src/crew/ui/trust.ts 的 shortDate() 相同的格式，#151）
export function shortDay(iso: string): string {
  const parts = new Intl.DateTimeFormat(language, { month: "2-digit", day: "2-digit", timeZone: "UTC" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")}/${part("day")}`;
}
export const employeeName = (id: string) => demo.employees.find((e) => e.id === id)!.displayName;
export const workTypeName = (id: string) => (ct.common as Record<string, string>)[`workType${id.charAt(0).toUpperCase()}${id.slice(1)}`];
// 專案的工作來源；畫面上的名稱是目前語言的 label，沒有時是 name（#60 的 `## 決定` 2）
export const sourcesOf = (project: string) => demo.sources.filter((s) => s.project === project);
export const sourceLabel = (s: DemoSource) => s.label?.[language] ?? s.name;
// 員工 × 工作類型在虛構資料中交辦時用的來源
export const sourceOf = (employee: string, workType: string) => {
  const id = demo.assignments.find((a) => a.employee === employee && a.workType === workType)!.source;
  return demo.sources.find((s) => s.id === id)!;
};
// 交辦的標題（目前語言）
export const assignmentTitle = (id: string) => demo.assignments.find((a) => a.id === id)!.title[language];
// 模擬交件第一輪的全文
export const firstReplyBody = (employee: string, workType: string) =>
  demo.simulations.find((x) => x.employee === employee && x.workType === workType)!.replies[0].body[language];

// crew 頁：子導覽與目前子頁的內容（不含頁首與子導覽）
export const crewSections = (page: Page) => page.getByRole("navigation", { name: ct.common.sectionsLabel });
export const crewContent = (page: Page) => crewSections(page).locator("xpath=following-sibling::*");

// 進入 crew 頁（桌機是左側欄，手機是「更多」）
export async function openCrew(page: Page): Promise<void> {
  expect(await gotoView(page, "crew")).toBe(true);
  await expect(crewSections(page)).toBeVisible();
}

// 切到 crew 的子頁（label 是 common 的 section* 文字）
export async function gotoCrewSection(page: Page, label: string): Promise<void> {
  const button = crewSections(page).getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

// 信任頁的一列（員工 × 工作類型）；列內「建議的經過」的區塊名稱也含員工與工作類型（#153），以列的頂端區分
export const trustRow = (page: Page, employee: string, workType: string): Locator =>
  page
    .getByRole("region", { name: crewFill(ct.trust.rowTitle, { employee: employeeName(employee), workType: workTypeName(workType) }) })
    .filter({ has: page.locator(".crew-trust__top") });

// 交辦 → 模擬交件 → 在「工作與驗收」選這一筆並以 reason（review 的 reason* 文字）退回；beforeReturn 在退回前檢查面板。
// 結束時停在「工作與驗收」
export async function assignSimulateReturn(
  page: Page,
  input: { title: string; employee: string; workType: string; reason: string; beforeReturn?: (panel: Locator) => Promise<void> },
): Promise<void> {
  const { title, employee, workType, reason, beforeReturn } = input;
  await gotoCrewSection(page, ct.common.sectionAssignments);
  const form = page.getByRole("form", { name: ct.assign.formTitle });
  await form.getByRole("textbox", { name: ct.assign.fieldTitle, exact: true }).fill(title);
  // 交給誰是單選卡（#76）：選了員工後帶入他平常的來源（可改）與工作類型（唯讀）
  await form.getByRole("group", { name: ct.assign.fieldEmployee }).getByRole("radio", { name: new RegExp(employeeName(employee)) }).check();
  const source = form.getByLabel(new RegExp(`^${ct.assign.fieldSource}`));
  await source.selectOption(sourceOf(employee, workType).id);
  await expect(source).toHaveValue(sourceOf(employee, workType).id);
  await expect(form.getByLabel(new RegExp(`^${ct.assign.fieldWorkType}`))).toHaveValue(workTypeName(workType));
  await form.getByRole("button", { name: ct.assign.submit, exact: true }).click();

  const item = page.getByRole("region", { name: ct.assign.listTitle }).getByRole("listitem").filter({ hasText: title });
  await expect(item.getByText(ct.assign.statusNotSubmitted, { exact: true })).toBeVisible();
  await item.getByRole("button", { name: ct.assign.simulate, exact: true }).click();
  await expect(item.getByText(ct.assign.statusAwaitingReview, { exact: true })).toBeVisible();

  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  if (beforeReturn) await beforeReturn(panel);
  await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
  await panel.getByRole("radio", { name: reason, exact: true }).check();
  await panel.getByRole("button", { name: ct.review.confirmReturn, exact: true }).click();
  const listed = page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title });
  await expect(listed.getByText(ct.review.verdictReturned, { exact: true })).toBeVisible();
}

// 首頁的「今天的工作」（#96）
export const homeToday = (page: Page) => page.getByRole("region", { name: ct.home.title, exact: true });

// ---- 第一次來的導覽（#122）：首頁的入口小卡與導覽對話框；walkTour() 走完 6 步，每一步確認切到的畫面與標出的區塊 ----
export const tourCard = (page: Page) => page.getByRole("region", { name: ct.tour.cardTitle, exact: true });
export const tourDialog = (page: Page) => page.getByRole("dialog").filter({ has: page.locator(".crew-tour__title") });
export const tourReplay = (page: Page) => page.getByRole("button", { name: ct.tour.replay, exact: true });

// 每一步：標題、應在的畫面（首頁或 crew 的子頁）、標出的區塊（owner：區塊所在的員工卡）
const TOUR = [
  { title: () => ct.tour.todayTitle, section: null, target: ".crew-home" },
  { title: () => ct.tour.reviewTitle, section: () => ct.common.sectionWorks, target: ".crew-review__pair" },
  { title: () => ct.tour.returnTitle, section: () => ct.common.sectionWorks, target: ".crew-review__decision" },
  { title: () => ct.tour.guidelinesTitle, section: () => ct.common.sectionEmployees, target: ".crew-employees__guidelines[data-pending]", owner: "rowan" },
  { title: () => ct.tour.trustTitle, section: () => ct.common.sectionTrust, target: ".crew-trust__row" },
  { title: () => ct.tour.flowbackTitle, section: () => ct.common.sectionWorks, target: ".crew-review__knowledge" },
] as const;

// 外框包住目標，對話框在畫面內（不被裁掉），沒有橫向捲動
async function expectSpotOn(page: Page, target: string): Promise<void> {
  const spot = page.locator(".crew-tour__spot");
  await expect(spot).toBeVisible();
  await expect
    .poll(async () => {
      const [a, b] = [await spot.boundingBox(), await page.locator(target).first().boundingBox()];
      return a !== null && b !== null && a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
    })
    .toBe(true);
  const box = (await tourDialog(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (viewport.width <= 600) await expectTargetMostlyVisible(page, target);
}

// 手機（#131）：標出的區塊不被對話框、頂端列與底部分頁列蓋住的部分，至少是「放得下的高度」的九成
// （放得下的高度：目標的高度與頂端列到分頁列之間扣掉對話框的空間，取較小者）
async function expectTargetMostlyVisible(page: Page, target: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect());
        const t = box(document.querySelector(selector))!;
        const d = box(document.querySelector(".crew-tour"))!;
        const top = box(document.querySelector(".mobile-topbar"))?.bottom ?? 0;
        const bottom = box(document.querySelector(".mobile-tabbar"))?.top ?? window.innerHeight;
        const span = (a: number, b: number) => Math.max(0, b - a);
        const shown = span(Math.max(t.top, top), Math.min(t.bottom, bottom));
        const covered = span(Math.max(t.top, top, d.top), Math.min(t.bottom, bottom, d.bottom));
        const room = Math.min(t.height, bottom - top - d.height);
        return (shown - covered) / room >= 0.9;
      }, target),
    )
    .toBe(true);
}

// 從首頁的入口開始走完 6 步；keyboard 時以 Enter 按「下一步」（開始時焦點在「下一步」）。結束後回到首頁不必要：停在最後一步的畫面
export async function walkTour(page: Page, opts: { keyboard?: boolean } = {}): Promise<void> {
  await (await tourStart(page)).click();
  for (const [i, step] of TOUR.entries()) {
    const dialog = tourDialog(page);
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(step.title());
    await expect(dialog).toContainText(crewFill(ct.tour.progress, { current: i + 1, total: TOUR.length }));
    if (step.section === null) await expect(page.locator('[data-view="home"][aria-current="page"]').first()).toBeVisible();
    else await expect(crewSections(page).getByRole("button", { name: step.section(), exact: true })).toHaveAttribute("aria-current", "page");
    await expectSpotOn(page, step.target);
    // 守則一步（#151）：標出的是 Rowan 卡（有一條等確認）的守則區塊
    if ("owner" in step) await expect(page.locator(".crew-employees__card", { has: page.locator(step.target) }).first()).toContainText(employeeName(step.owner));
    const last = i === TOUR.length - 1;
    const button = dialog.getByRole("button", { name: last ? ct.tour.finish : ct.tour.next, exact: true });
    if (opts.keyboard) {
      await expect(button).toBeFocused();
      await page.keyboard.press("Enter");
    } else await button.click();
  }
  await expect(tourDialog(page)).toHaveCount(0);
  await expect(page.locator(".crew-tour__spot")).toHaveCount(0);
}

// 首頁的「開始導覽」（沒看過）或「重新看導覽」（看過）
async function tourStart(page: Page): Promise<Locator> {
  const start = tourCard(page).getByRole("button", { name: ct.tour.start, exact: true });
  return (await start.count()) > 0 ? start : tourReplay(page);
}

// 「工作與驗收」的驗收面板（名稱是工作的標題）
export const reviewPanel = (page: Page, title: string) => page.getByRole("article", { name: title });

// ---- 知識庫條目的回流（#92）：seed 時回流的部門。依資料集算圖譜預期的 E2E 以此補上 ----
import type { DemoFile } from "../../app/src/crew/demo/types";
import { OWNER_ENTITY_TYPE, flowbackOwnerPendingId, toFlowbackDocument } from "../../app/src/crew/knowledge/flowback";
import { demoWorkId } from "../../app/src/crew/demo/types";
import { nameKeys } from "../../app/src/extraction/merge";
import type { Graph } from "../../app/src/graph/read";
import type { RoleId } from "./app";
import { access, knowledgeModel } from "./client";

// demo.json 已通過的知識庫條目在 seed 時新建的部門（crew/demo/seed.ts 與 db/store.ts 的 writeFlowback() 的規則），
// 加在 graph（資料集算出的預期）之後。同名的部門已在 graph 中時是合併，不新增節點
export function withCrewFlowback(graph: Graph, role: RoleId): Graph {
  const r = access.roles.find((x) => x.id === role);
  if (!hasCrewDemo || !r || !knowledgeModel.entityTypes.some((t) => t.id === OWNER_ENTITY_TYPE)) return graph;
  const demo = readClientJson<DemoFile>("crew/demo.json");
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const uploaders = new Set(access.roles.filter((x) => x.canUpload).map((x) => x.id));
  // nameKeys() 只讀 aliasRules；檔案的型別（icon 可省略）與 app 的型別不同，所以轉型
  const keysOf = (names: string[]) => nameKeys(OWNER_ENTITY_TYPE, names, knowledgeModel.entityTypes as Parameters<typeof nameKeys>[2]);
  const added: Graph["entities"] = [];
  for (const a of demo.assignments) {
    const source = demo.sources.find((x) => x.id === a.source)!;
    const level = source.knowledgeVisibility;
    if (!level || rank.get(level)! > rank.get(r.visibility)! || !r.projects.includes(source.project)) continue;
    for (const w of a.works) {
      if (w.review?.verdict !== "accepted" || !uploaders.has(w.review.decidedBy)) continue;
      const owner = toFlowbackDocument(w.body[language])?.owner;
      if (!owner) continue;
      const keys = keysOf([owner.name]);
      const same = [...graph.entities, ...added].filter((e) => e.type === OWNER_ENTITY_TYPE && [...keysOf([e.name, ...Object.values(e.names)])].some((k) => keys.has(k)));
      if (same.length > 0) continue;
      added.push({ id: flowbackOwnerPendingId(demoWorkId(a.id, w.round)), type: OWNER_ENTITY_TYPE, name: owner.name, names: { [language]: owner.name }, sources: [] });
    }
  }
  return { entities: [...graph.entities, ...added], relations: graph.relations };
}
