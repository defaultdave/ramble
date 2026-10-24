import { Gift, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';
import { HoldTimer } from '@/components/HoldTimer';
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
  menuExpanded?: boolean;
  onMenuClick: () => void;
};

export type CheckoutHeaderProps = HeaderBaseProps & {
  variant: 'checkout';
  secondsRemaining: number;
};

export type HeaderProps = DefaultHeaderProps | CheckoutHeaderProps;

export function Header(props: HeaderProps) {
  return props.variant === 'checkout' ? (
    <CheckoutHeader {...props} />
  ) : (
    <DefaultHeader {...props} />
  );
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
  menuExpanded,
  onMenuClick,
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
        <a className={styles.search} href={searchHref}>
          <span className={styles.visuallyHidden}>Search:</span>{' '}
          <span className={styles.searchLabel}>{searchLabel}</span>
          <span className={styles.searchGo} aria-hidden="true">
            <Search className={styles.searchIcon} />
          </span>
        </a>
        <div className={styles.actions}>
          {showGifts ? (
            <Link href={giftsHref} className={styles.gifts}>
              <Gift className={styles.giftsIcon} aria-hidden="true" />
              Gifts
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.menu}
            aria-label="Menu"
            aria-expanded={menuExpanded}
            onClick={onMenuClick}
          >
            <Menu className={styles.menuIcon} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

function CheckoutHeader({
  variant,
  secondsRemaining,
  ...rest
}: CheckoutHeaderProps) {
  return (
    <header {...rest} className={styles.header} data-variant={variant}>
      <div className={styles.inner}>
        <div className={styles.start}>
          <HomeLink />
          <p className={styles.secure}>Secure checkout</p>
        </div>
        <HoldTimer secondsRemaining={secondsRemaining} />
      </div>
    </header>
  );
}
