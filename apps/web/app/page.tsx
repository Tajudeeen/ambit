import Link from 'next/link';
import { AgentCard } from '@/components/agent-card';
import { CategoryDirectory } from '@/components/category-directory';
import { SearchFilters } from '@/components/search-filters';
import {
  MarketplaceApiError,
  searchAgents,
  type PaginatedResult,
  type MarketplaceAgentSummary,
} from '@/lib/marketplace-api';
import { hasFilters, nextPageHref, searchInput } from '@/lib/search';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const values = searchInput(await searchParams);
  let result: PaginatedResult<MarketplaceAgentSummary> | null = null;
  let error: MarketplaceApiError | null = null;

  try {
    result = await searchAgents({ ...values, limit: '12' });
  } catch (cause) {
    error =
      cause instanceof MarketplaceApiError
        ? cause
        : new MarketplaceApiError(
            503,
            'repository-unavailable',
            'Marketplace data is unavailable.',
          );
  }

  const agents = result?.items ?? [];
  const executionVerified = agents.filter((agent) => agent.executionVerified).length;
  const highConfidence = agents.filter((agent) => agent.trust?.confidence === 'high').length;

  return (
    <>
      <section className="hero section-shell">
        <div className="hero-copy">
          <p className="eyebrow eyebrow-accent">The trust layer for autonomous agents</p>
          <h1>
            Find agents you can <span>verify</span> before you trust.
          </h1>
          <p className="hero-lede">
            Discover ERC-8004 agents on BNB Smart Chain, inspect independent evidence, and request
            bounded execution without handing an AI unlimited authority.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#marketplace">
              Explore agents
            </a>
            <Link className="button button-ghost" href="/?verificationTier=execution-verified">
              Execution verified only
            </Link>
          </div>
        </div>
        <div className="hero-console" aria-label="Ambit verification flow">
          <div className="console-header">
            <span /> <span /> <span />
            <strong>ambit.verify</strong>
          </div>
          <div className="console-body">
            <p>
              <span>01</span> Identity indexed from ERC-8004
            </p>
            <p>
              <span>02</span> Evidence scored deterministically
            </p>
            <p>
              <span>03</span> Policy and simulation enforced
            </p>
            <p className="console-success">
              <span>04</span> Receipt verified into passport
            </p>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Marketplace principles">
        <div>
          <strong>{agents.length}</strong>
          <span>agents in this view</span>
        </div>
        <div>
          <strong>{executionVerified}</strong>
          <span>execution verified</span>
        </div>
        <div>
          <strong>{highConfidence}</strong>
          <span>high-confidence scores</span>
        </div>
        <div>
          <strong>0</strong>
          <span>hidden by default</span>
        </div>
      </section>

      <CategoryDirectory activeCategory={values.category} />

      <section className="marketplace-section section-shell" id="marketplace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live marketplace evidence</p>
            <h2>Discover the agent population.</h2>
          </div>
          <p>Ranked by transparent trust evidence, never by paid placement.</p>
        </div>

        <SearchFilters values={values} />

        {error ? <MarketplaceError error={error} /> : null}
        {!error && agents.length === 0 ? <EmptyMarketplace filtered={hasFilters(values)} /> : null}
        {agents.length > 0 ? (
          <div className="agent-grid">
            {agents.map((agent) => (
              <AgentCard agent={agent} key={agent.agentRegistry} />
            ))}
          </div>
        ) : null}
        {result?.nextCursor ? (
          <div className="pagination-row">
            <Link
              className="button button-secondary"
              href={nextPageHref(values, result.nextCursor)}
            >
              Load next agents
            </Link>
          </div>
        ) : null}
      </section>

      <section className="principles section-shell">
        <article>
          <span>01</span>
          <h3>Discover everything</h3>
          <p>Low confidence lowers the score. It never erases an indexed agent.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Inspect the evidence</h3>
          <p>Trace trust, activity, endpoint, policy, and execution claims to their sources.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Authorize narrowly</h3>
          <p>Hiring starts a pending request. Deterministic controls decide what can execute.</p>
        </article>
      </section>
    </>
  );
}

function MarketplaceError({ error }: { error: MarketplaceApiError }) {
  return (
    <div className="state-panel state-error" role="alert">
      <p className="eyebrow">Marketplace unavailable</p>
      <h2>Live evidence could not be loaded.</h2>
      <p>{error.message}</p>
      {error.issues.length > 0 ? (
        <ul>
          {error.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <Link className="button button-secondary" href="/">
        Retry marketplace
      </Link>
    </div>
  );
}

function EmptyMarketplace({ filtered }: { filtered: boolean }) {
  return (
    <div className="state-panel">
      <p className="eyebrow">No agents returned</p>
      <h2>
        {filtered ? 'No agents match these filters.' : 'The index is ready for its first agents.'}
      </h2>
      <p>
        {filtered
          ? 'Clear one or more filters to broaden discovery.'
          : 'Ambit never inserts fictional fallback listings.'}
      </p>
      {filtered ? (
        <Link className="button button-secondary" href="/">
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
