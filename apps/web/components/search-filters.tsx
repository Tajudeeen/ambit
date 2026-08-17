import Link from 'next/link';
import type { AgentSearchInput } from '@/lib/marketplace-api';

export function SearchFilters({ values }: { values: AgentSearchInput }) {
  return (
    <form className="search-panel" action="/" method="get">
      <div className="search-primary">
        <label className="field field-search">
          <span>Search agents</span>
          <input
            name="q"
            defaultValue={values.q}
            placeholder="Name, capability, or protocol"
            autoComplete="off"
          />
        </label>
        <button className="button button-primary" type="submit">
          Search marketplace
        </button>
      </div>

      <div className="filter-grid">
        <label className="field">
          <span>Category</span>
          <select name="category" defaultValue={values.category ?? ''}>
            <option value="">All categories</option>
            <option value="monitoring">Monitoring</option>
            <option value="grid-trading">Grid trading</option>
            <option value="health-factor">Health factor</option>
            <option value="yield">Yield</option>
          </select>
        </label>
        <label className="field">
          <span>Verification</span>
          <select name="verificationTier" defaultValue={values.verificationTier ?? ''}>
            <option value="">All evidence levels</option>
            <option value="unverified">Unverified</option>
            <option value="data-verified">Data verified</option>
            <option value="execution-verified">Execution verified</option>
          </select>
        </label>
        <label className="field">
          <span>Execution support</span>
          <select name="supportedExecution" defaultValue={values.supportedExecution ?? ''}>
            <option value="">Any support level</option>
            <option value="true">Supported</option>
            <option value="false">Not supported</option>
          </select>
        </label>
        <label className="field">
          <span>Minimum trust</span>
          <input
            name="minTrustScore"
            type="number"
            min="0"
            max="100"
            defaultValue={values.minTrustScore}
            placeholder="Any score"
          />
        </label>
        <label className="field">
          <span>Protocol</span>
          <input name="protocol" defaultValue={values.protocol} placeholder="e.g. venus" />
        </label>
        <div className="filter-actions">
          <button className="button button-secondary" type="submit">
            Apply filters
          </button>
          <Link className="text-link" href="/">
            Reset
          </Link>
        </div>
      </div>

      <p className="filter-note">
        Every indexed agent remains discoverable by default. Verification filters are always opt-in.
      </p>
    </form>
  );
}
