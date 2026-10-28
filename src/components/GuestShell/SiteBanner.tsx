import styles from './SiteBanner.module.css';

export type SiteBannerProps = { text: string };

/** The one-line notice ops can put above every guest page, such as a weather closure. */
export function SiteBanner({ text }: SiteBannerProps) {
  return (
    <section className={styles.banner} aria-label="Site notice">
      <p className={styles.text}>{text}</p>
    </section>
  );
}
