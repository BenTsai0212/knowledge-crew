// crew 頁（#34）：頁首（標題與「虛構資料」標示）、子導覽與目前位置的畫面。
// H～K 掛上畫面時：新增 <畫面>View.tsx／.css，在 SCREENS 插入一行 import 與一行登錄。
import { useState } from "react";
import { crewStrings } from "../i18n";
import { CREW_SECTIONS, type CrewScreen, type CrewScreenProps, type CrewSection } from "./sections";
import "./CrewPage.css";

const SCREENS: Partial<Record<CrewSection, CrewScreen>> = {};

export function CrewPage(props: CrewScreenProps) {
  const t = crewStrings("common", props.language);
  // 目前位置只存在元件 state，不寫瀏覽器儲存
  const [section, setSection] = useState<CrewSection>("today");
  const Screen = SCREENS[section];
  return (
    <section className="crew-page">
      <header className="crew-page__header">
        <h1 className="crew-page__title">{t.title}</h1>
        <span className="badge" title={t.fictionalDataNote}>
          {t.fictionalData}
        </span>
      </header>
      <nav className="crew-page__sections" aria-label={t.sectionsLabel}>
        {CREW_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="crew-page__section"
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => setSection(s.id)}
          >
            {t[s.label]}
          </button>
        ))}
      </nav>
      {Screen ? (
        <Screen {...props} />
      ) : (
        <section className="empty-state">
          <p className="empty-state__title">{t.preparingTitle}</p>
          <p className="empty-state__reason">{t.preparingBody}</p>
        </section>
      )}
    </section>
  );
}
