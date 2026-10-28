import type { ReactNode } from 'react';
import styles from './HomeModules.module.css';

type EyebrowProps = { icon: ReactNode; label: string };

export function Eyebrow({ icon, label }: EyebrowProps) {
  return (
    <span className={styles.eyebrow}>
      <span className={styles.eyebrowIcon} aria-hidden="true">
        {icon}
      </span>
      {label}
    </span>
  );
}
