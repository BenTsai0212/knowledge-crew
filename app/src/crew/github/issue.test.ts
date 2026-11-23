import { describe, expect, it } from "vitest";
import template from "../../../../.github/ISSUE_TEMPLATE/feature.md?raw";
import {
  assignmentIdOf,
  assignmentToIssue,
  DISPATCH_LABEL,
  dispatchSteps,
  IssueFormInvalid,
  planFirstOption,
  readBackMismatches,
  resolvePlanFirst,
  templateHeadings,
  type AssignmentForm,
  type IssueConfig,
} from "./issue";
import { checkIssue } from "./post-check";

// 虛構的平台設定：四種工作類型，其中 schema 是高風險
const CONFIG: IssueConfig = {
  workTypes: {
    feature: { label: "type:feat", titlePrefix: "feat: ", planFirst: false, highRisk: false },
    bugfix: { label: "type:fix", titlePrefix: "fix: ", planFirst: false, highRisk: false },
    docs: { label: "type:docs", titlePrefix: "docs: ", planFirst: false, highRisk: false },
    schema: { label: "type:feat", titlePrefix: "feat: ", planFirst: true, highRisk: true },
  },
  areas: ["crew", "workflow"],
};

const FORM: AssignmentForm = {
  assignmentId: "as-0001",
  summary: "交辦清單加上篩選",
  goal: "交辦多了以後，決定者想只看某位員工的交辦。",
  acceptance: ["可以依員工篩選", "篩選後件數正確"],
  workTypeId: "feature",
  sourceId: "src-crew",
  employee: "小開",
  assignedBy: "決定者",
};

const reason = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof IssueFormInvalid ? e.reason : e;
  }
  return null;
};

describe("assignmentToIssue：四種工作類型的快照", () => {
  it("feature：有目標與範圍", () => {
    expect(assignmentToIssue({ ...FORM, area: "crew" }, CONFIG)).toMatchSnapshot();
  });

  it("bugfix：沒有目標時，目標寫一句話交辦", () => {
    expect(
      assignmentToIssue({ ...FORM, workTypeId: "bugfix", summary: "篩選後件數少一件", goal: "  ", acceptance: ["件數與清單一致"] }, CONFIG),
    ).toMatchSnapshot();
  });

  it("docs：使用者勾選先提計畫", () => {
    expect(
      assignmentToIssue({ ...FORM, workTypeId: "docs", summary: "說明篩選的用法", planFirst: true, area: "workflow" }, CONFIG),
    ).toMatchSnapshot();
  });

  it("schema：高風險，一律先提計畫", () => {
    expect(assignmentToIssue({ ...FORM, workTypeId: "schema", summary: "交辦加上 part 欄位" }, CONFIG)).toMatchSnapshot();
  });
});

describe("本文格式", () => {
  it("標題沿用 feature.md 的範本", () => {
    const headings = templateHeadings(template);
    expect(headings.slice(0, 2)).toEqual(["## 目標", "## 驗收條件"]);
    const { body } = assignmentToIssue(FORM, CONFIG);
    expect(body.split("\n").filter((l) => l.startsWith("## "))).toEqual(headings.slice(0, 2));
  });

  it("驗收條件是未勾選的核取方塊；空白的條件略過", () => {
    const { body } = assignmentToIssue({ ...FORM, acceptance: ["  第一條 ", "", "第二條"] }, CONFIG);
    expect(body).toContain("- [ ] 第一條\n- [ ] 第二條\n");
    expect(body).not.toContain("[x]");
  });

  it("末行是交辦編號、員工與交辦人；讀回時以末行對到平台的交辦", () => {
    const { body } = assignmentToIssue(FORM, CONFIG);
    expect(body.trimEnd().split("\n").at(-1)).toBe("crew-assignment: as-0001; employee: 小開; by: 決定者");
    expect(assignmentIdOf(body)).toBe("as-0001");
    expect(assignmentIdOf(body.replace(/\n/g, "\r\n"))).toBe("as-0001");
    expect(assignmentIdOf("## 目標\n\ncrew-assignment: as-0001\n\n之後又有一行")).toBeNull();
    expect(assignmentIdOf("沒有交辦編號")).toBeNull();
  });

  it("轉換結果通過貼出前的檢查（虛構的禁用名稱）", () => {
    expect(checkIssue(assignmentToIssue(FORM, CONFIG), ["Zorblax"]).ok).toBe(true);
  });
});

describe("不合格的表單", () => {
  it.each([
    ["unknownWorkType", { workTypeId: "nope" }],
    ["unknownWorkType", { workTypeId: "toString" }],
    ["emptySummary", { summary: "  " }],
    ["multilineSummary", { summary: "第一行\n第二行" }],
    ["noAcceptance", { acceptance: [] }],
    ["noAcceptance", { acceptance: ["", "  "] }],
    ["multilineAcceptance", { acceptance: ["一條\n兩行"] }],
    ["invalidAssignmentId", { assignmentId: "as 1" }],
    ["invalidAssignmentId", { assignmentId: "" }],
    ["invalidName", { employee: " " }],
    ["invalidName", { assignedBy: "a; crew-assignment: x" }],
    ["unknownArea", { area: "billing" }],
  ] as const)("%s", (expected, patch) => {
    expect(reason(() => assignmentToIssue({ ...FORM, ...patch } as AssignmentForm, CONFIG))).toBe(expected);
  });

  it("設定的標籤不是 type:* 時拒絕（派工標籤不能經由設定混進建立時的標籤）", () => {
    const bad: IssueConfig = { ...CONFIG, workTypes: { feature: { ...CONFIG.workTypes.feature, label: DISPATCH_LABEL } } };
    expect(reason(() => assignmentToIssue(FORM, bad))).toBe("invalidConfig");
  });
});

describe("先提計畫", () => {
  it("預設依工作類型；非高風險可以改", () => {
    expect(planFirstOption("feature", CONFIG)).toEqual({ checked: false, locked: false });
    expect(resolvePlanFirst("feature", undefined, CONFIG)).toBe(false);
    expect(resolvePlanFirst("feature", true, CONFIG)).toBe(true);
    const planned: IssueConfig = { ...CONFIG, workTypes: { ...CONFIG.workTypes, docs: { ...CONFIG.workTypes.docs, planFirst: true } } };
    expect(planFirstOption("docs", planned)).toEqual({ checked: true, locked: false });
    expect(resolvePlanFirst("docs", false, planned)).toBe(false);
    expect(assignmentToIssue({ ...FORM, workTypeId: "docs" }, planned).labels).toContain("plan-first");
    expect(assignmentToIssue({ ...FORM, workTypeId: "docs", planFirst: false }, planned).labels).not.toContain("plan-first");
  });

  it("高風險一律勾選，而且不能取消", () => {
    expect(planFirstOption("schema", CONFIG)).toEqual({ checked: true, locked: true });
    expect(resolvePlanFirst("schema", false, CONFIG)).toBe(true);
    expect(assignmentToIssue({ ...FORM, workTypeId: "schema", planFirst: false }, CONFIG).labels).toContain("plan-first");
    // 設定的預設寫成不勾，高風險仍然勾選
    const odd: IssueConfig = { ...CONFIG, workTypes: { ...CONFIG.workTypes, schema: { ...CONFIG.workTypes.schema, planFirst: false } } };
    expect(planFirstOption("schema", odd)).toEqual({ checked: true, locked: true });
    expect(assignmentToIssue({ ...FORM, workTypeId: "schema", planFirst: false }, odd).labels).toContain("plan-first");
  });
});

describe("派工標籤與寫入順序", () => {
  it("轉換結果的標籤沒有 agent:ready", () => {
    for (const workTypeId of Object.keys(CONFIG.workTypes)) {
      for (const planFirst of [true, false]) {
        const { labels } = assignmentToIssue({ ...FORM, workTypeId, planFirst, area: "crew" }, CONFIG);
        expect(labels).not.toContain(DISPATCH_LABEL);
        expect(labels.filter((l) => l.startsWith("agent:"))).toEqual([]);
      }
    }
  });

  it("建立 → 讀回比對 → 單獨加 agent:ready；agent:ready 是最後一次、而且單獨的寫入", () => {
    const draft = assignmentToIssue({ ...FORM, area: "crew" }, CONFIG);
    const steps = dispatchSteps(draft);
    expect(steps.map((s) => s.kind)).toEqual(["createIssue", "readBack", "addLabels"]);
    const writes = steps.filter((s) => s.kind !== "readBack");
    expect(writes.at(-1)).toEqual({ kind: "addLabels", labels: [DISPATCH_LABEL] });
    // agent:ready 只出現在最後一步
    const withReady = steps.filter((s) => JSON.stringify(s).includes(DISPATCH_LABEL));
    expect(withReady).toEqual([steps.at(-1)]);
    expect(steps[0]).toEqual({ kind: "createIssue", draft });
    expect(steps[1]).toEqual({ kind: "readBack", expect: draft });
  });

  it("建立時的標籤已含 agent:ready 時拒絕", () => {
    const draft = assignmentToIssue(FORM, CONFIG);
    expect(reason(() => dispatchSteps({ ...draft, labels: [...draft.labels, DISPATCH_LABEL] }))).toBe("invalidConfig");
  });

  it("步驟中的資料是複本，之後改動原本的 draft 不影響", () => {
    const draft = assignmentToIssue(FORM, CONFIG);
    const steps = dispatchSteps(draft);
    draft.labels.push(DISPATCH_LABEL);
    expect(JSON.stringify(steps.slice(0, 2))).not.toContain(DISPATCH_LABEL);
  });

  it("讀回比對：標籤不論順序；本文的 CRLF 視為相同", () => {
    const draft = assignmentToIssue({ ...FORM, area: "crew" }, CONFIG);
    const same = { ...draft, body: draft.body.replace(/\n/g, "\r\n"), labels: [...draft.labels].reverse() };
    expect(readBackMismatches(draft, same)).toEqual([]);
    expect(readBackMismatches(draft, { title: "x", body: "y", labels: [...draft.labels, DISPATCH_LABEL] })).toEqual(["title", "body", "labels"]);
  });
});
