import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticStorage } from './fixture';

const ROUTES = [
  { name: 'overview', hash: '#/overview' },
  { name: 'assets', hash: '#/assets' },
  { name: 'finance-monthly', hash: '#/finance/monthly-review' },
  { name: 'finance-reconcile', hash: '#/finance/initial-reconciliation' },
  { name: 'history', hash: '#/review/history' },
  { name: 'reports', hash: '#/review/reports' },
  { name: 'trends', hash: '#/review/trends' },
  { name: 'goals', hash: '#/planning/goals' },
  { name: 'prediction', hash: '#/planning/prediction' },
  { name: 'lottery', hash: '#/lottery' },
  { name: 'settings', hash: '#/settings' },
  { name: 'settings-ai', hash: '#/settings/ai' },
  { name: 'settings-data', hash: '#/settings/storage' },
] as const;

async function openRoute(page: import('@playwright/test').Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator('.workspace-content')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('正在加载 WealthGrowthTracker…')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '[aria-label="通知"] { display: none !important; }' });
  await expect(page.locator('[aria-label="通知"]')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-08T02:30:00.000Z') });
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, syntheticStorage());
});

test('全部主页面与设置子页视觉基线', async ({ page }) => {
  test.setTimeout(180_000);
  for (const route of ROUTES) {
    await openRoute(page, route.hash);
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: 'disabled',
      ...(route.name === 'finance-monthly' ? { maxDiffPixelRatio: 0.06 } : {}),
    });
  }
});

test('代表性页面无 serious/critical 无障碍问题', async ({ page }) => {
  test.setTimeout(120_000);
  for (const hash of ['#/overview', '#/assets', '#/review/history', '#/settings']) {
    await openRoute(page, hash);
    const result = await new AxeBuilder({
      page,
    } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const severe = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(severe, severe.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
  }
});

test('主要页面在 390px 视口重排且不产生整页横向滚动', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const hash of ['#/overview', '#/assets', '#/finance/monthly-review', '#/review/history', '#/reports', '#/planning/goals', '#/lottery', '#/settings']) {
    await openRoute(page, hash);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
          right: Math.round(element.getBoundingClientRect().right),
        })),
    }));
    expect(dimensions.width, `${hash}: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.client + 1);
    await expect(page).toHaveScreenshot(`mobile-${hash.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`, {
      animations: 'disabled',
    });
  }
});
