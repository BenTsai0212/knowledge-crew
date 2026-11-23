// 第一次來的導覽（#122）：首頁「今天的工作」上方的入口小卡（todayCard 插槽），與逐步切換畫面、標出區塊的導覽對話框。
// 步驟與判斷在 tour.ts；文字在 client/i18n/crew/tour.<語言>.json。不自動彈出：只有按「開始導覽」才開始（線上 demo 也一樣）。
// 第三方套件不用；標出區塊是蓋在目標上的外框（不擋點擊），對話框不是 modal，可以隨時以「結束導覽」或 Esc 結束。
import { useEffect, useRef, useState } from "react";
import { fill } from "../../client/i18n";
import type { LanguageCode } from "../../client/types";
import type { Database } from "../../db/database";
import { crewStrings } from "../i18n";
import type { CrewTarget } from "./sections";
import { dialogPlace, inView, pickTarget, readTourFlowback, readTourSeen, scrollBlock, TARGET_WAIT_MS, TOUR_STEPS, writeTourSeen } from "./tour";
import "./Tour.css";

/** 導覽的狀態：看過了沒（入口小卡或「重新看導覽」）、目前第幾步（沒有在導覽時是 null） */
export function useCrewTour() {
  const [seen, setSeen] = useState(() => readTourSeen());
  const [step, setStep] = useState<number | null>(null);
  const markSeen = () => (writeTourSeen(), setSeen(true));
  return {
    seen,
    step,
    start: () => setStep(0),
    dismiss: markSeen,
    next: () => setStep((s) => (s === null || s + 1 >= TOUR_STEPS.length ? null : s + 1)),
    // 結束後焦點回到首頁的「重新看導覽」（在其他頁結束時沒有，焦點留在原處）
    end: () => (markSeen(), setStep(null), requestAnimationFrame(() => document.querySelector<HTMLElement>(".crew-tour-replay__button")?.focus())),
  };
}

interface CardProps {
  /** 有 AI 員工頁籤時才顯示（沒有 AI 員工的客戶不讀 crew 的文字） */
  enabled: boolean;
  seen: boolean;
  language: LanguageCode;
  onStart(): void;
  onDismiss(): void;
}

/** 首頁的入口：沒看過時是一張小卡（可以關掉），看過或關掉後是一個不顯眼的「重新看導覽」 */
export function CrewTourCard({ enabled, seen, language, onStart, onDismiss }: CardProps) {
  if (!enabled) return null;
  const t = crewStrings("tour", language);
  if (seen) {
    return (
      <p className="crew-tour-replay">
        <button type="button" className="link crew-tour-replay__button" onClick={onStart}>
          {t.replay}
        </button>
      </p>
    );
  }
  return (
    <section className="card crew-tour-card" aria-labelledby="crew-tour-card-title">
      <div className="crew-tour-card__text">
        <h3 id="crew-tour-card-title" className="crew-tour-card__title">
          {t.cardTitle}
        </h3>
        <p className="crew-tour-card__body">{t.cardBody}</p>
      </div>
      <div className="crew-tour-card__actions">
        <button type="button" className="crew-tour-card__start" onClick={onStart}>
          {t.start}
        </button>
        <button type="button" className="crew-tour-card__close" aria-label={t.dismiss} title={t.dismiss} onClick={onDismiss}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </section>
  );
}

type Go = { kind: "home" } | { kind: "crew"; target: CrewTarget };

interface TourProps {
  db: Database;
  identity: string;
  language: LanguageCode;
  step: number;
  /** 切到首頁或 crew 頁的某個位置（App 提供） */
  go(to: Go): void;
  onNext(): void;
  onEnd(): void;
}

type Rect = { top: number; left: number; width: number; height: number };

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};
const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/** 導覽對話框與標出的外框；每一步先切畫面，再等目標出現（最多 TARGET_WAIT_MS），捲進畫面並跟著目標移動 */
export function CrewTour({ db, identity, language, step, go, onNext, onEnd }: TourProps) {
  const t = crewStrings("tour", language);
  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const [target, setTarget] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const primary = useRef<HTMLButtonElement>(null);

  // 切畫面：回流那一步先找最近一件已回流的工作（找不到時是「工作與驗收」的預設選取）
  useEffect(() => {
    let alive = true;
    setTarget(null);
    setRect(null);
    const dest = current.go;
    if (dest.kind === "home") go(dest);
    else if (dest.kind === "crew") go(dest);
    else
      readTourFlowback(db, identity, language).then(
        (assignmentId) => alive && go({ kind: "crew", target: assignmentId === null ? { section: "works" } : { section: "works", assignmentId } }),
        () => alive && go({ kind: "crew", target: { section: "works" } }),
      );
    // 等目標出現：找到後捲進畫面（已在畫面上時不捲動）
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const found = pickTarget(current.targets, (selector) => document.querySelector(selector) !== null, elapsed);
      if (found !== null) {
        window.clearInterval(timer);
        const el = document.querySelector(found)!;
        const box = rectOf(el);
        if (!inView(box, window.innerHeight)) el.scrollIntoView?.({ block: scrollBlock(box, window.innerHeight) });
        setTarget(found);
      } else if (elapsed >= TARGET_WAIT_MS) window.clearInterval(timer);
    }, 100);
    primary.current?.focus();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // go 每次 render 都是新的函式；只在換步驟、身分或語言時重新切換
  }, [step, identity, language]);

  // 外框跟著目標（捲動、版面改變）；目標消失時拿掉外框
  useEffect(() => {
    if (target === null) return;
    let frame = 0;
    const tick = () => {
      const el = document.querySelector(target);
      const next = el ? rectOf(el) : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target]);

  // Esc 在任何地方都結束導覽（onEnd 每次 render 都是新的函式，以 ref 取最新的）
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const place = dialogPlace(rect, typeof window === "undefined" ? 0 : window.innerHeight);
  const titleId = "crew-tour-title";
  const bodyId = "crew-tour-body";
  return (
    <>
      {rect !== null && (
        <div
          className="crew-tour__spot"
          data-step={current.id}
          aria-hidden="true"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <section className="crew-tour" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId} data-place={place} data-step={current.id}>
        <p className="muted crew-tour__progress">
          <span className="visually-hidden">{t.dialogLabel} </span>
          {fill(t.progress, { current: step + 1, total: TOUR_STEPS.length }, language)}
        </p>
        <h2 id={titleId} className="crew-tour__title">
          {t[current.title]}
        </h2>
        <p id={bodyId} className="crew-tour__body">
          {t[current.body]}
        </p>
        <p className="muted crew-tour__hint">{t.escHint}</p>
        <div className="crew-tour__buttons">
          <button type="button" className="secondary" onClick={onEnd}>
            {t.end}
          </button>
          <button ref={primary} type="button" className="crew-tour__next" onClick={last ? onEnd : onNext}>
            {last ? t.finish : t.next}
          </button>
        </div>
      </section>
    </>
  );
}
