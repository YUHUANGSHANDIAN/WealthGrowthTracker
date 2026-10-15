import type { TabId } from '../../store/navigationStore';

/** 侧边栏/底部导航的线性图标；未列出的 Tab 使用通用占位图标。 */
const PATHS: Partial<Record<TabId, string>> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  assets: 'M3 7h18v14H3z M3 7V4h15v3 M16 12h5v4h-5z',
  history: 'M3 12a9 9 0 1 0 3-6 M3 3v6h6 M12 7v5l3 2',
  reports: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  analysis: 'M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4',
  monthly: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16 M8 15h3 M13 15h3 M8 18h3',
  prediction: 'M3 18l6-6 4 3 8-12 M15 3h6v6',
  goals: 'M21 12a9 9 0 1 1-9-9 M17 12a5 5 0 1 1-5-5 M12 12l8-8',
  lottery: 'M4 4h16v16H4z M8 8h1 M15 8h1 M8 15h1 M15 15h1',
  data: 'M3 6c0-5 18-5 18 0s-18 5-18 0 M3 6v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',
  ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 3h4l1 3 3 1 3 1v4l-3 1-1 3-1 3h-4l-1-3-3-1-3-1v-4l3-1 1-3z',
};

const FALLBACK = 'M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5';

export function NavIcon({ id }: { id: TabId }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[id] ?? FALLBACK} />
    </svg>
  );
}
