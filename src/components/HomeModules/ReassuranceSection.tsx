import { Check, Clock, Info, type LucideIcon } from 'lucide-react';
import type { ReassuranceFact } from '@/lib/pages/home';
import styles from './HomeModules.module.css';

export type ReassuranceSectionProps = { facts: readonly ReassuranceFact[] };

const icons: Record<ReassuranceFact['icon'], LucideIcon> = {
  check: Check,
  clock: Clock,
  info: Info,
};

export function ReassuranceSection({ facts }: ReassuranceSectionProps) {
  return (
    <section className={styles.section} aria-label="Booking with Ramble">
      <div className={styles.inner}>
        <ul className={styles.facts} role="list">
          {facts.map((fact) => {
            const Icon = icons[fact.icon];
            return (
              <li key={fact.text} className={styles.fact}>
                <Icon className={styles.factIcon} aria-hidden="true" />
                {fact.text}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
