import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="section-shell not-found-page">
      <p className="eyebrow">404 · Evidence not found</p>
      <h1>This agent is not in the current index.</h1>
      <p>Check the canonical agent registry key or return to discovery.</p>
      <Link className="button button-primary" href="/">
        Back to marketplace
      </Link>
    </section>
  );
}
