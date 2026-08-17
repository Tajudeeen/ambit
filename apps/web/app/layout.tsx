import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Ambit — Verified Agent Marketplace',
    template: '%s | Ambit',
  },
  description:
    'Discover, evaluate, and safely request autonomous agents on BNB Smart Chain with transparent evidence and bounded execution.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <Link className="brand" href="/" aria-label="Ambit marketplace home">
              <span className="brand-mark" aria-hidden="true">
                A
              </span>
              <span>
                <strong>Ambit</strong>
                <small>Verified agent marketplace</small>
              </span>
            </Link>
            <nav className="site-nav" aria-label="Primary navigation">
              <Link href="/">Marketplace</Link>
              <a href="https://github.com/Tajudeeen/ambit" rel="noreferrer" target="_blank">
                Documentation
              </a>
            </nav>
            <div className="network-badge">
              <span aria-hidden="true" /> BNB Smart Chain
            </div>
          </header>
          <main>{children}</main>
          <footer className="site-footer">
            <div>
              <strong>Evidence before authority.</strong>
              <p>Trust scores inform discovery. Deterministic controls authorize execution.</p>
            </div>
            <span>Ambit · Built for the BNB agent economy</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
