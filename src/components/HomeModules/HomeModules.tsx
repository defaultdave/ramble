import type { ReactNode } from 'react';
import type { HomeModuleView } from '@/lib/home';
import type { RichTextDoc } from '@/lib/richText/format';
import { CategoryRail } from './CategoryRail';
import { GiftGuideSection } from './GiftGuideSection';
import { HomeHero } from './HomeHero';
import { PicksSection } from './PicksSection';
import { ReassuranceSection } from './ReassuranceSection';
import { ThisWeekSection } from './ThisWeekSection';

export type HomeModulesProps = {
  modules: readonly HomeModuleView[];
  /** The earliest day the hero's date field offers, as YYYY-MM-DD. */
  minDate: string;
  /**
   * Draws a module's rich-text copy. The renderer is server-only, so the page hands it in and
   * this component stays free of it.
   */
  renderCopy: (doc: RichTextDoc) => ReactNode;
};

function Module({
  module,
  minDate,
  renderCopy,
}: {
  module: HomeModuleView;
  minDate: string;
  renderCopy: HomeModulesProps['renderCopy'];
}) {
  switch (module.kind) {
    case 'hero_search':
      return (
        <HomeHero
          eyebrow={module.eyebrow}
          heading={module.heading}
          body={renderCopy(module.body)}
          neighborhoods={module.neighborhoods}
          minDate={minDate}
        />
      );
    case 'category_rail':
      return (
        <CategoryRail heading={module.heading} categories={module.categories} />
      );
    case 'picks':
      return (
        <PicksSection
          anchor={module.anchor}
          eyebrow={module.eyebrow}
          heading={module.heading}
          summary={module.summary}
          cards={module.cards}
          seeAll={module.seeAll}
        />
      );
    case 'gift_guide':
      return (
        <GiftGuideSection
          eyebrow={module.eyebrow}
          heading={module.heading}
          body={module.body ? renderCopy(module.body) : null}
          action={module.action}
          sponsor={module.sponsor}
        />
      );
    case 'this_week':
      return <ThisWeekSection heading={module.heading} cards={module.cards} />;
    case 'reassurance':
      return <ReassuranceSection facts={module.facts} />;
  }
}

/** The home page's modules, in the order staff arranged them. */
export function HomeModules({
  modules,
  minDate,
  renderCopy,
}: HomeModulesProps) {
  return (
    <>
      {modules.map((module) => (
        <Module
          key={module.id}
          module={module}
          minDate={minDate}
          renderCopy={renderCopy}
        />
      ))}
    </>
  );
}
