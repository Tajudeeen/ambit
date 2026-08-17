import Link from 'next/link';
import { agentInitials, formatDate, formatLabel } from '@/lib/format';
import type { MarketplaceAgentSummary } from '@/lib/marketplace-api';
import { StatusPill, endpointTone, verificationTone } from './status-pill';
import { TrustScore } from './trust-score';

export function AgentCard({ agent }: { agent: MarketplaceAgentSummary }) {
  return (
    <article className="agent-card">
      <div className="agent-card-topline">
        <div className="agent-avatar" aria-hidden="true">
          {agentInitials(agent.name)}
        </div>
        <div className="agent-card-statuses">
          <StatusPill
            value={agent.verificationTier}
            tone={verificationTone(agent.verificationTier)}
          />
          {agent.endpoint ? (
            <StatusPill
              value={`endpoint ${agent.endpoint.status}`}
              tone={endpointTone(agent.endpoint.status)}
            />
          ) : null}
        </div>
      </div>

      <div className="agent-card-heading">
        <div>
          <p className="eyebrow">
            {agent.category ? formatLabel(agent.category) : 'General agent'}
          </p>
          <h2>{agent.name}</h2>
        </div>
        <TrustScore trust={agent.trust} compact />
      </div>

      <p className="agent-description">
        {agent.description || 'No description has been indexed yet.'}
      </p>

      <div className="chip-list" aria-label="Supported protocols">
        {agent.supportedProtocols.slice(0, 3).map((protocol) => (
          <span className="chip" key={protocol}>
            {protocol}
          </span>
        ))}
        {agent.supportedProtocols.length === 0 ? (
          <span className="chip chip-muted">No protocols</span>
        ) : null}
      </div>

      <div className="agent-card-footer">
        <span>Indexed {formatDate(agent.lastIndexedAt)}</span>
        <Link className="text-link" href={`/agents/${encodeURIComponent(agent.agentRegistry)}`}>
          Inspect evidence <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
