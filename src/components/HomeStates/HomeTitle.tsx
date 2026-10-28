import styles from './HomeStates.module.css';

/** The page's h1 for a home page with no hero, kept out of sight because the modules are the page. */
export function HomeTitle() {
  return <h1 className={styles.visuallyHidden}>Ramble</h1>;
}
