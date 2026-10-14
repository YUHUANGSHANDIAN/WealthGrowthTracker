import { useState } from 'react';
import { MOBILE_MORE_ITEMS, MOBILE_PRIMARY_ITEMS } from '../../constants/navigation';
import { Modal } from '../../components/ui/Modal';
import { NavIcon } from '../../components/ui/NavIcon';
import { useNavigationStore } from '../../store/navigationStore';

export function MobileNavigation() {
  const tab = useNavigationStore((state) => state.tab);
  const navigate = useNavigationStore((state) => state.navigate);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreIsCurrent = MOBILE_MORE_ITEMS.some((item) => item.id === tab);

  function openTab(nextTab: (typeof MOBILE_MORE_ITEMS)[number]['id']) {
    navigate({ tab: nextTab });
    setMoreOpen(false);
  }

  return (
    <>
      <nav className="workspace-mobile" aria-label="移动导航">
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate({ tab: item.id })}
            aria-current={tab === item.id ? 'page' : undefined}
          >
            <NavIcon id={item.id} />
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
              onClick={() => openTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <NavIcon id={item.id} />
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

