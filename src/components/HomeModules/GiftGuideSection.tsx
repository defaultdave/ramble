import { Gift } from 'lucide-react';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Illustration } from '@/components/Illustration';
import { Eyebrow } from './Eyebrow';
import styles from './HomeModules.module.css';

export type GiftGuideSectionProps = {
  eyebrow: string;
  heading: string;
  /** The module's copy, already rendered, or nothing. */
  body: ReactNode;
  action: { href: string; label: string };
  /** The sponsor placement under the action. */
  sponsor: string;
};

export function GiftGuideSection({
  eyebrow,
  heading,
  body,
  action,
  sponsor,
}: GiftGuideSectionProps) {
  const headingId = useId();

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.inner}>
        <div className={styles.gift}>
          <div className={styles.giftCopy}>
            <Eyebrow icon={<Gift />} label={eyebrow} />
            <h2 id={headingId} className={styles.headingLarge}>
              {heading}
            </h2>
            {body ? <div className={styles.giftBody}>{body}</div> : null}
            <Link className={styles.action} href={action.href}>
              <Gift className={styles.actionIcon} aria-hidden="true" />
              {action.label}
            </Link>
            <p className={styles.sponsor}>{sponsor}</p>
          </div>
          <div className={styles.giftArt}>
            <Illustration width={320} height={240} />
          </div>
        </div>
      </div>
    </section>
  );
}
