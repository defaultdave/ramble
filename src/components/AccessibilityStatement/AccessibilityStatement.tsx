import Link from 'next/link';
import { contactPath } from '@/lib/paths';
import styles from './AccessibilityStatement.module.css';

/** A static page: what Ramble aims for, what is known to fall short, and how to tell the team. */
export function AccessibilityStatement() {
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Accessibility</h1>
        <p className={styles.lede}>
          Ramble is a demo marketplace. This statement says how the site is
          built and where it falls short, in plain terms. No outside audit has
          reviewed it.
        </p>
      </header>
      <section className={styles.section} aria-labelledby="a11y-aim">
        <h2 id="a11y-aim" className={styles.heading}>
          What we aim for
        </h2>
        <p>
          We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2,
          level AA. That means pages that work with a keyboard and a screen
          reader, on a phone or a desktop, and with text enlarged.
        </p>
        <ul>
          <li>Each page has one main heading, and headings follow in order.</li>
          <li>Every control has a visible label and a clear focus outline.</li>
          <li>
            Color is never the only way we say something. Status and errors also
            use words and icons.
          </li>
          <li>
            Search and filters are ordinary forms, so they work without
            scripting.
          </li>
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="a11y-experiences">
        <h2 id="a11y-experiences" className={styles.heading}>
          Accessibility of experiences
        </h2>
        <p>
          Hosts describe access at their location, such as ramps, stairs, and
          how much mobility an activity needs, on each experience page. We do
          not check those notes in person. If one is missing or wrong, tell us
          and we will ask the host to fix it.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="a11y-known">
        <h2 id="a11y-known" className={styles.heading}>
          Known gaps
        </h2>
        <ul>
          <li>
            We have tested with a keyboard and automated checks, not with every
            screen reader and browser pairing.
          </li>
          <li>
            Photos come from hosts, and their descriptions may not capture every
            detail.
          </li>
          <li>
            Pages from hosts&apos; own websites, which guide entries link to,
            are outside our control.
          </li>
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="a11y-feedback">
        <h2 id="a11y-feedback" className={styles.heading}>
          Tell us about a barrier
        </h2>
        <p>
          If something on Ramble is hard to use, or you need information in
          another form, send us a message. Say the page and what got in the way.
          Because this is a demo, the message goes to the demo team, and we
          cannot promise a reply time.
        </p>
        <Link className={styles.link} href={contactPath}>
          Contact us about accessibility
        </Link>
      </section>
    </article>
  );
}
