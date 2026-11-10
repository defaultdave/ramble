import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Runs axe on the page as it is and attaches what it finds to the report. It never fails the test:
 * the Storybook job is the accessibility gate, and this is a look at the real, seeded pages.
 */
export async function reportAxeViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  try {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    if (violations.length === 0) return;
    console.warn(
      `axe: ${String(violations.length)} violation(s) on ${name}: ${violations.map((v) => v.id).join(', ')}`,
    );
    await testInfo.attach(`axe-${name}.json`, {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  } catch (error) {
    console.warn(`axe could not run on ${name}: ${String(error)}`);
  }
}
