// 首頁的「今天的工作」（#96）：knowledge-kit 首頁的接入點只放這裡的元件（HomePage.tsx 的 todaySummary、todayCard），
// 判斷與文字在 home-today.ts 與 client/i18n/crew/home.<語言>.json。版面、列與按鈕沿用首頁既有的 home__* 樣式。
// 資料由 App 以 useCrewToday() 讀一次，首頁與側欄的待驗收件數共用。
import { useEffect, useState, type ReactNode } from "react";
import { fill, strings } from "../../client/i18n";
import { clientConfig } from "../../client/load";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { crewStrings } from "../i18n";
import { withEmployee } from "./components";
import { DECIDE_TARGET, guidelineTarget, homeSummary, homeToday, isHomeTodayEmpty, rowStatus, rowTarget, type HomeToday } from "./home-today";
import { workTypeLabel } from "./labels";
import { assignmentRef } from "./refs";
import type { CrewTarget } from "./sections";
import { canReviewOf, readToday, type TodayAssignment } from "./today";
import "./HomeToday.css";

/** 讀取結果；identity 是讀取時的身分（切換身分後不顯示前一個身分的內容）。讀取中是 null */
export type CrewTodayState = { identity: string; data: HomeToday | "failed"; awaiting: number | null } | null;

/**
 * 讀取今天的工作：enabled（有 AI 員工頁籤）時，身分、語言或 version 改變就重新讀取；重新讀取時保留上一次的結果（徽章不閃）。
 */
export function useCrewToday(db: Database | null, identity: string, language: LanguageCode, enabled: boolean, version: unknown): CrewTodayState {
  const [state, setState] = useState<CrewTodayState>(null);
  useEffect(() => {
    if (db === null || !enabled) return;
    let current = true;
    const canReview = canReviewOf(clientConfig.access, identity);
    readToday(db, identity, language, canReview).then(
      (today) => current && setState({ identity, data: homeToday(today), awaiting: canReview ? today.awaitingReview.length : null }),
      () => current && setState({ identity, data: "failed", awaiting: null }),
    );
    return () => {
      current = false;
    };
  }, [db, identity, language, enabled, version]);
  return enabled ? state : null;
}

const ready = (state: CrewTodayState, identity: string): HomeToday | "failed" | null => (state?.identity === identity ? state.data : null);

/** 問候下方的一句總結 */
export function HomeTodaySummary({ state, identity, language }: { state: CrewTodayState; identity: string; language: LanguageCode }) {
  const data = ready(state, identity);
  const text = data === null || data === "failed" ? null : homeSummary(data, language);
  return text === null ? null : <p className="crew-home__summary">{text}</p>;
}

interface CardProps {
  state: CrewTodayState;
  identity: string;
  language: LanguageCode;
  /** 手機：區塊不是卡片，整列是按鈕（與首頁其他區塊相同） */
  phone: boolean;
  onOpen(target: CrewTarget): void;
}

/** 「今天的工作」：依設計規格 v3 第 6.1 節分組，空的組不顯示；不能驗收的身分沒有可看的事時整區不顯示 */
export function HomeTodayCard({ state, identity, language, phone, onOpen }: CardProps) {
  // 沒有 AI 員工的客戶沒有 crew 的翻譯檔：先確認有資料，再讀文字
  const data = ready(state, identity);
  if (data === null) return null;
  if (data !== "failed" && isHomeTodayEmpty(data) && !data.canReview) return null;
  const t = crewStrings("home", language);
  const { colon } = strings(language);
  const className = phone ? "home__card crew-home" : "card home__card crew-home";
  let first = true;
  // 只有第一列的「開始驗收」是主要按鈕（規格 6.1）；不能驗收的身分是「查看」
  const action = (awaiting: boolean) => {
    const review = awaiting && data !== "failed" && data.canReview;
    const primary = review && first;
    first = false;
    return { label: review ? t.actionReview : t.actionView, primary };
  };
  const assignmentRows = (items: TodayAssignment[], awaiting: boolean) =>
    items.map((a) => {
      const { label, primary } = action(awaiting);
      return (
        <Row key={a.id} phone={phone} label={label} primary={primary} name={`${label}${colon}${a.title}`} onClick={() => onOpen(rowTarget(a, awaiting))}>
          <strong className="home__name" title={a.title}>
            {a.title}
          </strong>
          <span className="home__sub crew-home__meta">
            {/* 員工名稱後是工作類型（#100：原本 AI 員工的「今天」子頁才有） */}
            <span className="crew-home__employee">
              {withEmployee(t.employeeWorkType, { workType: workTypeLabel(a.workTypeId, language) }, a.employee.displayName, language)}
            </span>
            <span>{assignmentRef(a, language)}</span>
            <span className="crew-home__status">{rowStatus(a, awaiting, language)}</span>
          </span>
        </Row>
      );
    });
  const group = (id: string, title: string, rows: ReactNode[]) =>
    rows.length > 0 && (
      <section className="crew-home__group" aria-labelledby={`crew-home-${id}`}>
        <h4 id={`crew-home-${id}`} className="crew-home__group-title">
          {title}
        </h4>
        <ul className="home__list">{rows}</ul>
      </section>
    );
  return (
    <section className={className} aria-labelledby="crew-home-title">
      <h3 id="crew-home-title">{t.title}</h3>
      {data === "failed" ? (
        <p className="error" role="alert">
          {t.loadFailed}
        </p>
      ) : isHomeTodayEmpty(data) ? (
        <p className="home__note">{t.allEmpty}</p>
      ) : (
        <>
          {group("failing", t.groupFailing, assignmentRows(data.failing, true))}
          {group("awaiting", t.groupAwaiting, assignmentRows(data.awaiting, true))}
          {group(
            "decide",
            t.groupDecide,
            data.decide.map((d) => (
              <Row
                key={`${d.employee.id}/${d.workTypeId}`}
                phone={phone}
                label={t.actionTrust}
                primary={false}
                name={`${t.actionTrust}${colon}${d.employee.displayName}`}
                onClick={() => onOpen(DECIDE_TARGET)}
              >
                <strong className="home__name crew-home__wrap">
                  {withEmployee(t.decideItem, { workType: workTypeLabel(d.workTypeId, language) }, d.employee.displayName, language)}
                </strong>
                <span className="home__sub crew-home__wrap">{fill(t.decideNote, { count: d.count }, language)}</span>
              </Row>
            )).concat(
              // 等確認的守則（#145）：決定在員工頁做，點了切到「員工」並捲到該員工卡
              data.guidelines.map((g) => (
                <Row
                  key={`guideline/${g.id}`}
                  phone={phone}
                  label={t.actionGuideline}
                  primary={false}
                  name={`${t.actionGuideline}${colon}${g.employee.displayName}`}
                  onClick={() => onOpen(guidelineTarget(g))}
                >
                  <strong className="home__name crew-home__wrap">
                    {withEmployee(t.guidelineItem, { workType: workTypeLabel(g.workTypeId, language) }, g.employee.displayName, language)}
                  </strong>
                  <span className="home__sub crew-home__wrap">{t.guidelineNote}</span>
                </Row>
              )),
            ),
          )}
          {group("progress", t.groupInProgress, assignmentRows(data.inProgress, false))}
        </>
      )}
    </section>
  );
}

// 一列：桌機與平板右側是動作按鈕；手機整列是按鈕、右側是 ›（與首頁的「有更新」相同）
function Row(props: { phone: boolean; label: string; primary: boolean; name: string; onClick(): void; children: ReactNode }) {
  const { phone, label, primary, name, onClick, children } = props;
  if (phone)
    return (
      <li>
        <button type="button" className="home__row home__row--raised home__row--tap" aria-label={name} onClick={onClick}>
          <span className="home__text">{children}</span>
          <span className="home__chevron" aria-hidden="true">
            ›
          </span>
        </button>
      </li>
    );
  return (
    <li className="home__row home__row--raised">
      <span className="home__text">{children}</span>
      <button type="button" className={primary ? "crew-home__primary" : "home__action"} aria-label={name} onClick={onClick}>
        {label}
      </button>
    </li>
  );
}

/** 側欄與手機導覽「AI 員工」的待驗收件數（與「待審」分開）；樣式與待審的數字徽章相同（app.css 的 .tab-count 規則） */
export function CrewTabCount({ count, language }: { count: number; language: LanguageCode }) {
  return (
    <span className="crew-tab-count">
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{fill(crewStrings("home", language).tabCount, { count }, language)}</span>
    </span>
  );
}
