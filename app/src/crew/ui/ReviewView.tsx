// 「工作與驗收」畫面（#39）：左側是工作清單（窄螢幕在面板之下，#50），選一筆後顯示驗收面板。
// 資料整理在 review.ts；面板（review/ReviewPanel.tsx）只依 readReviewPanel() 的結果呈現。「通過」「退回」只給能驗收的身分，寫入後重新讀取。
import { useCallback, useEffect, useRef, useState } from "react";
import { fill } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import { createReview } from "../db/store";
import { crewStrings, type CrewTexts } from "../i18n";
import { withEmployee } from "./components";
import { workTypeLabel } from "./labels";
import { initialSelection, readReviewPanel, readWorkList, type ReviewPanel as PanelData, type WorkList, type WorkListItem } from "./review";
import { itemRef, ReviewPanel } from "./review/ReviewPanel";
import type { CrewScreenProps } from "./sections";
import { canReviewOf } from "./today";
import "./ReviewView.css";

type Texts = CrewTexts<"review">;
type Data = { list: WorkList; selected: string | null; panel: PanelData | null };
type State = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: Data };

export function ReviewView({ db, identity, language, assignmentId, onOpenSource, onChanged }: CrewScreenProps) {
  const t = crewStrings("review", language);
  const canReview = canReviewOf(clientConfig.access, identity);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // 剛才的「通過」因為沒有上傳權限而沒有收進知識庫（#92 的 `## 決定` 4）；只在這次畫面中註明，換一筆時清除
  const [noUpload, setNoUpload] = useState(false);
  // 目前的選取只存在元件 state；重新讀取時保留（還看得到時），否則選待驗收的第一筆。從原文的來源（#92）或首頁的今天的工作（#96）切過來時先選那一件
  const selectedRef = useRef<string | null>(assignmentId ?? null);
  // 在清單選了一筆之後把面板捲進畫面（窄螢幕面板在清單之上；已在畫面上時不捲動）
  const panelRef = useRef<HTMLElement>(null);
  const scrollPending = useRef(assignmentId !== undefined);

  const load = useCallback(
    async (want: string | null): Promise<Data> => {
      const list = await readWorkList(db, identity, language);
      const visible = want !== null && [...list.awaiting, ...list.recent].some((i) => i.id === want);
      const selected = visible ? want : initialSelection(list);
      const panel = selected === null ? null : await readReviewPanel(db, identity, language, selected, canReview);
      selectedRef.current = selected;
      return { list, selected, panel };
    },
    [db, identity, language, canReview],
  );

  const refresh = useCallback(
    async (want: string | null) => {
      try {
        setState({ kind: "ready", data: await load(want) });
      } catch {
        setState({ kind: "failed" });
      }
    },
    [load],
  );

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    setSaveFailed(false);
    load(selectedRef.current).then(
      (data) => current && setState({ kind: "ready", data }),
      () => current && setState({ kind: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [load]);

  const select = (id: string) => {
    setSaveFailed(false);
    setNoUpload(false);
    scrollPending.current = true;
    void refresh(id);
  };

  useEffect(() => {
    if (state.kind !== "ready" || !scrollPending.current) return;
    scrollPending.current = false;
    const panel = panelRef.current;
    if (panel && !topInView(panel)) panel.scrollIntoView?.({ block: "start" });
  }, [state]);

  const decide = async (input: Parameters<typeof createReview>[2]) => {
    setSaving(true);
    setSaveFailed(false);
    setNoUpload(false);
    try {
      const { flowback } = await createReview(db, identity, input);
      setNoUpload(flowback === "no-upload-permission");
      onChanged?.();
    } catch {
      setSaveFailed(true);
    }
    // 成功或失敗都重新讀取，畫面與資料庫一致
    await refresh(selectedRef.current);
    setSaving(false);
  };

  if (state.kind === "loading") return <p className="muted">{t.loading}</p>;
  if (state.kind === "failed") return <p className="error" role="alert">{t.loadFailed}</p>;
  const { list, selected, panel } = state.data;
  if (list.awaiting.length === 0 && list.recent.length === 0) {
    return (
      <section className="empty-state">
        <p className="empty-state__title">{t.empty}</p>
      </section>
    );
  }
  return (
    <div className="crew-review">
      <nav className="card crew-review__list" aria-label={t.listLabel}>
        <ListGroup title={t.awaiting} count={t.awaitingCount} empty={t.awaitingEmpty} items={list.awaiting} {...{ selected, select, t, language }} />
        <ListGroup title={t.recent} count={t.recentCount} empty={t.recentEmpty} items={list.recent} {...{ selected, select, t, language }} />
      </nav>
      {panel ? (
        <ReviewPanel
          key={panel.current.id}
          anchor={panelRef}
          panel={panel}
          language={language}
          saving={saving}
          saveFailed={saveFailed}
          decide={decide}
          noUpload={noUpload}
          onOpenSource={onOpenSource}
        />
      ) : (
        <p className="muted crew-review__hint">{t.selectHint}</p>
      )}
    </div>
  );
}

interface ListGroupProps {
  title: string;
  count: string;
  empty: string;
  items: WorkListItem[];
  selected: string | null;
  select: (id: string) => void;
  t: Texts;
  language: LanguageCode;
}

function ListGroup({ title, count, empty, items, selected, select, t, language }: ListGroupProps) {
  return (
    <section className="crew-review__group">
      <h3>
        {title} <span className="muted">{fill(count, { count: items.length }, language)}</span>
      </h3>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="crew-review__items">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="crew-review__item"
                aria-current={item.id === selected ? "true" : undefined}
                onClick={() => select(item.id)}
              >
                <span className="crew-review__item-title">{item.title}</span>
                <span className="muted crew-review__ref">{itemRef(item, t, language)}</span>
                <span className="muted">{itemMeta(item, t, language)}</span>
                {item.verdict && (
                  <span className="badge" data-verdict={item.verdict}>
                    {item.verdict === "accepted" ? t.verdictAccepted : t.verdictReturned}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 面板的頂端是否在畫面上、且不被 sticky 的頂端列蓋住（scroll-margin-top 是頂端列讓出的高度，#50）
function topInView(element: HTMLElement): boolean {
  const top = element.getBoundingClientRect().top;
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
  return top >= margin && top < window.innerHeight;
}

const itemMeta = (item: WorkListItem, t: Texts, language: LanguageCode) =>
  withEmployee(t.itemMeta, { workType: workTypeLabel(item.workTypeId, language), round: item.round }, item.employee.displayName, language);
