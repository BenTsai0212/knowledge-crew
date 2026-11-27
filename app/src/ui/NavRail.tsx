// 平板（720–980px）的圖示側欄（#255；#182 依 crew 設計規格 v4 第 4 節「側欄縮成 72px 的圖示列」）：左側 72px，產品 icon、各頁籤（圖示，60×56px；
// 名稱不顯示，留給輔助技術與 title；數字在圖示右上角；有 AI 員工時 AI 員工與評測台在分隔線之後）、「虛構資料」標示、底部是身分的頭像。
// 依身分只列可用的頁籤，主管 8 個也放得下，所以沒有「更多」。頭像打開身分與語言面板（右側的滑出面板，內容與手機相同）。
// 「這次的問題」在平板上先不顯示（#255 決定 4）
import { Fragment, useState } from "react";
import { clientConfig } from "../client/load";
import { fill, strings } from "../client/i18n";
import { BottomSheet } from "./BottomSheet";
import { IDENTITY_SELECT_ID } from "./empty-state";
import { IdentitySheet } from "./IdentitySheet";
import { navGroups } from "./layout";
import { NavIcon } from "./MobileNav";
import { ProductIcon } from "./ProductIcon";
import { BRAND_ICON_SIZE, DemoFlagIcon, tabLabels, type NavProps } from "./Sidebar";

export function NavRail(props: NavProps) {
  const { language, identity, identityControl, views, view, onView, tabExtra, bell } = props;
  const s = strings(language);
  const labels = tabLabels(language);
  const [open, setOpen] = useState(false);
  const signedIn = identityControl !== "none";
  const role = clientConfig.access.roles.find((r) => r.id === identity)?.label[language] ?? identity;

  return (
    <>
      <nav className="nav-rail" aria-label={s.views}>
        <p className="nav-rail__brand">
          <ProductIcon size={BRAND_ICON_SIZE} />
          <span className="visually-hidden">
            {s.productName} {clientConfig.client.displayName[language]}
          </span>
        </p>
        {bell}
        {navGroups(views).map((group, i) => (
          <Fragment key={group[0]}>
            {i > 0 && <div className="nav-sep" role="separator" />}
            {group.map((id) => (
              // 名稱只給輔助技術（#182）：按鈕的名稱是頁籤名稱，數字的說明在 tabExtra 的 visually-hidden 文字
              <button key={id} type="button" data-view={id} aria-current={view === id ? "page" : undefined} title={labels[id]} onClick={() => onView(id)}>
                <NavIcon view={id} />
                <span className="nav-rail__label">{labels[id]}</span>
                {tabExtra?.[id]}
              </button>
            ))}
          </Fragment>
        ))}
        {/* 「虛構資料」標示（#182）：圖示＋短文字，每一頁都看得到 */}
        <p className="nav-rail__flag">
          <DemoFlagIcon />
          <span>{s.fictionalData}</span>
        </p>
        {signedIn && (
          // 頭像是角色名稱的第一個字；空狀態的「切換身分」把焦點移到這裡（#245）
          <button
            type="button"
            id={IDENTITY_SELECT_ID}
            className="identity-badge nav-rail__avatar"
            aria-haspopup="dialog"
            aria-label={fill(s.identityBadge, { role })}
            onClick={() => setOpen(true)}
          >
            <span aria-hidden="true">{Array.from(role)[0]}</span>
          </button>
        )}
      </nav>
      <BottomSheet open={open && signedIn} onClose={() => setOpen(false)} title={s.identityAndLanguage} language={language} className="identity-sheet" side="right">
        <IdentitySheet {...props} onChangeAccessCode={props.onChangeAccessCode && (() => (setOpen(false), props.onChangeAccessCode?.()))} />
      </BottomSheet>
    </>
  );
}
