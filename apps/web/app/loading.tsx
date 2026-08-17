export default function MarketplaceLoading() {
  return (
    <section
      className="section-shell loading-state"
      aria-busy="true"
      aria-label="Loading marketplace"
    >
      <div className="loading-line loading-title" />
      <div className="loading-line" />
      <div className="loading-grid">
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}
