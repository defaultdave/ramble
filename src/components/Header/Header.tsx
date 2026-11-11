import { Gift, Search } from 'lucide-react';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import styles from './Header.module.css';

export type NavLink = { label: string; href: string };

type HeaderBaseProps = Omit<
  ComponentPropsWithoutRef<'header'>,
  'children' | 'className' | 'style'
>;

export type DefaultHeaderProps = HeaderBaseProps & {
  variant?: 'default';
  links: NavLink[];
  showGifts?: boolean;
  giftsHref: string;
  searchLabel: string;
  searchHref: string;
  menu: ReactNode;
  /** The sign-in or sign-out control (see AccountControl), at every width. */
  account?: ReactNode;
};

export type CheckoutHeaderProps = HeaderBaseProps & {
  variant: 'checkout';
  holdTimer: ReactNode;
};

/** The home link alone, for a frame that cannot carry the site navigation. */
export type PlainHeaderProps = HeaderBaseProps & { variant: 'plain' };

export type HeaderProps =
  DefaultHeaderProps | CheckoutHeaderProps | PlainHeaderProps;

export function Header(props: HeaderProps) {
  switch (props.variant) {
    case 'checkout':
      return <CheckoutHeader {...props} />;
    case 'plain':
      return <PlainHeader {...props} />;
    default:
      return <DefaultHeader {...props} />;
  }
}

function HomeLink() {
  return (
    <Link href="/" className={styles.home} aria-label="Ramble home">
      <Logo />
    </Link>
  );
}

function DefaultHeader({
  variant = 'default',
  links,
  showGifts = true,
  giftsHref,
  searchLabel,
  searchHref,
  menu,
  account,
  ...rest
}: DefaultHeaderProps) {
  return (
    <header {...rest} className={styles.header} data-variant={variant}>
      <div className={styles.inner}>
        <div className={styles.start}>
          <HomeLink />
          <nav className={styles.nav} aria-label="Main">
            <ul className={styles.navList}>
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={styles.navLink}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <Link className={styles.search} href={searchHref}>
          <span className={styles.visuallyHidden}>Search:</span>{' '}
          <span className={styles.searchLabel}>{searchLabel}</span>
          <span className={styles.searchGo} aria-hidden="true">
            <Search className={styles.searchIcon} />
          </span>
        </Link>
        {account ? <div className={styles.account}>{account}</div> : null}
        <div className={styles.actions}>
          {showGifts ? (
            <Link href={giftsHref} className={styles.gifts}>
              <Gift className={styles.giftsIcon} aria-hidden="true" />
              Gifts
            </Link>
          ) : null}
          <div className={styles.menu}>{menu}</div>
        </div>
      </div>
    </header>
  );
}

function CheckoutHeader({ variant, holdTimer, ...rest }: CheckoutHeaderProps) {
  return (
    <header {...rest} className={styles.header} data-variant={variant}>
      <div className={styles.inner}>
        <div className={styles.start}>
          <HomeLink />
          <p className={styles.secure}>Secure checkout</p>
        </div>
        {holdTimer}
      </div>
    </header>
  );
}

function PlainHeader({ variant, ...rest }: PlainHeaderProps) {
  return (
    <header {...rest} className={styles.header} data-variant={variant}>
      <div className={styles.inner}>
        <HomeLink />
      </div>
    </header>
  );
}
