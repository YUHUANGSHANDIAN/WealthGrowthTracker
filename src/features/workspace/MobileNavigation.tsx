import { useState } from 'react';
import { MOBILE_MORE_ITEMS, MOBILE_PRIMARY_ITEMS } from '../../constants/navigation';
import { Modal } from '../../components/ui/Modal';
import { NavIcon } from '../../components/ui/NavIcon';
import { sectionForTab, useNavigationStore } from '../../store/navigationStore';

export function MobileNavigation() {
  const tab = useNavigationStore((state) => state.tab);
  const navigate = useNavigationStore((state) => state.navigate);
  const [moreOpen, setMoreOpen] = useState(false);
  const section = sectionForTab(tab);
  const moreIsCurrent = MOBILE_MORE_ITEMS.some((item) => item.id === section);

  function openSection(item: (typeof MOBILE_MORE_ITEMS)[number]) {
    navigate({ tab: item.defaultTab, ...(item.id === 'finance' ? { financeTaskKind: 'monthly-review' as const } : {}) });
    setMoreOpen(false);
  }

  function go(item: (typeof MOBILE_PRIMARY_ITEMS)[number]) {
    navigate({ tab: item.defaultTab, ...(item.id === 'finance' ? { financeTaskKind: 'monthly-review' as const } : {}) });
  }

  return (
    <>
      <nav className="workspace-mobile" aria-label="移动导航">
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item)}
            aria-current={section === item.id ? 'page' : undefined}
          >
            <NavIcon id={item.defaultTab} />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="mobile-more-trigger"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-current={moreIsCurrent ? 'page' : undefined}
        >
          <MoreIcon />
          <span>更多</span>
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="更多页面" size="sm">
        <nav className="mobile-more-menu" aria-label="更多页面">
          {MOBILE_MORE_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openSection(item)}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <NavIcon id={item.defaultTab} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </Modal>
    </>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

