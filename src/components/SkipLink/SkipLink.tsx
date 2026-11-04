import styles from './SkipLink.module.css';

/** Off screen until it takes focus, then the first thing a keyboard user sees. It reaches the `main` landmark. */
export function SkipLink() {
  return (
    <a className={styles.skip} href="#main">
      Skip to main content
    </a>
  );
}
