import { Check, Clock, Info, type LucideIcon } from 'lucide-react';
import styles from './HomeModules.module.css';

export type ReassuranceSectionProps = { facts: readonly string[] };

// The Figma rows pair each fact with one of these, in this order.
const icons: readonly LucideIcon[] = [Check, Clock, Info];

export function ReassuranceSection({ facts }: ReassuranceSectionProps) {
  return (
    <section className={styles.section} aria-label="Booking with Ramble">
      <div className={styles.inner}>
        <ul className={styles.facts} role="list">
          {facts.map((fact, index) => {
            const Icon = icons[index % icons.length] ?? Check;
            return (
              <li key={fact} className={styles.fact}>
                <Icon className={styles.factIcon} aria-hidden="true" />
                {fact}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
