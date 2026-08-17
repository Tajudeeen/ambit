import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HirePanel } from '@/components/hire-panel';
import { StatusPill, endpointTone, verificationTone } from '@/components/status-pill';
import { TrustScore } from '@/components/trust-score';
import { agentInitials, formatAddress, formatDate, formatLabel } from '@/lib/format';
import {
  MarketplaceApiError,
  getAgent,
  getExecutions,
  type ExecutionHistoryItem,
  type MarketplaceAgentProfile,
  type PaginatedResult,
} from '@/lib/marketplace-api';

type PageParams = Promise<{ agentRegistry: string }>;

export const metadata: Metadata = {
  title: 'Agent Evidence',
  description:
    'Inspect indexed identity, trust, policy, activity, and verified execution evidence.',
};

export default async function AgentProfilePage({ params }: { params: PageParams }) {
  const { agentRegistry } = await params;
  let agent: MarketplaceAgentProfile | null;
  try {
    agent = await getAgent(agentRegistry);
  } catch (cause) {
    return <ProfileUnavailable error={cause} />;
  }
  if (!agent) notFound();

  let executions: PaginatedResult<ExecutionHistoryItem> | null = null;
  try {
    executions = await getExecutions(agentRegistry);
  } catch {
    executions = null;
  }

  return (
    <div className="profile-page section-shell">
      <Link className="back-link" href="/">
        <span aria-hidden="true">←</span> Back to marketplace
      </Link>

      <section className="profile-hero">
        <div className="profile-identity">
          <div className="agent-avatar agent-avatar-large" aria-hidden="true">
            {agentInitials(agent.name)}
          </div>
          <div>
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
              {agent.verifiedActivity ? (
                <StatusPill value="activity evidenced" tone="brand" />
              ) : null}
            </div>
            <p className="eyebrow">
              {agent.category ? formatLabel(agent.category) : 'General agent'}
            </p>
            <h1>{agent.name}</h1>
            <p className="profile-description">
              {agent.description || 'No description has been indexed for this agent.'}
            </p>
          </div>
        </div>
        <div className="profile-trust-card">
          <p className="eyebrow">Independent trust signal</p>
          <TrustScore trust={agent.trust} />
          <p>
            {agent.trust
              ? `Methodology ${agent.trust.methodologyVersion}, computed ${formatDate(agent.trust.computedAt)}.`
              : 'Ambit has not collected enough evidence to compute a reliable trust score.'}
          </p>
        </div>
      </section>

      <section className="profile-facts" aria-label="Agent identity facts">
        <DataPair label="Agent ID" value={agent.agentId} />
        <DataPair label="Chain" value={`BNB Smart Chain · ${agent.chainId}`} />
        <DataPair label="Owner" value={formatAddress(agent.owner)} title={agent.owner} />
        <DataPair
          label="Indexed block"
          value={agent.lastIndexedBlock?.toLocaleString() ?? 'Not recorded'}
        />
      </section>

      <div className="profile-layout">
        <div className="profile-content">
          <EvidenceOverview agent={agent} />
          <PolicyPanel agent={agent} />
          <ActivityPanel agent={agent} />
          <ExecutionHistory executions={executions} />
        </div>
        <div className="profile-sidebar">
          <HirePanel
            agentRegistry={agent.agentRegistry}
            protocols={agent.supportedProtocols}
            supportedExecution={agent.supportedExecution}
          />
          <RegistryPanel agent={agent} />
        </div>
      </div>
    </div>
  );
}

function ProfileUnavailable({ error }: { error: unknown }) {
  const message =
    error instanceof MarketplaceApiError ? error.message : 'Marketplace evidence is unavailable.';
  return (
    <section className="section-shell not-found-page">
      <p className="eyebrow">Marketplace unavailable</p>
      <h1>This profile could not be loaded.</h1>
      <p>{message}</p>
      <Link className="button button-primary" href="/">
        Return to marketplace
      </Link>
    </section>
  );
}

function DataPair({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="data-pair">
      <span>{label}</span>
      <strong title={title}>{value}</strong>
    </div>
  );
}

function EvidenceOverview({ agent }: { agent: MarketplaceAgentProfile }) {
  return (
    <section className="detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Capabilities and service state</p>
          <h2>What this agent claims and what Ambit observed</h2>
        </div>
      </div>
      <div className="evidence-grid">
        <div>
          <h3>Capabilities</h3>
          <div className="chip-list">
            {agent.capabilities.map((capability) => (
              <span className="chip" key={capability}>
                {capability}
              </span>
            ))}
            {agent.capabilities.length === 0 ? (
              <span className="muted-copy">None indexed</span>
            ) : null}
          </div>
        </div>
        <div>
          <h3>Protocols</h3>
          <div className="chip-list">
            {agent.supportedProtocols.map((protocol) => (
              <span className="chip" key={protocol}>
                {protocol}
              </span>
            ))}
            {agent.supportedProtocols.length === 0 ? (
              <span className="muted-copy">None indexed</span>
            ) : null}
          </div>
        </div>
        <div>
          <h3>Endpoint</h3>
          {agent.endpoint ? (
            <dl className="compact-list">
              <div>
                <dt>Status</dt>
                <dd>{formatLabel(agent.endpoint.status)}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>
                  {agent.endpoint.latencyMs === null
                    ? 'Not measured'
                    : `${agent.endpoint.latencyMs} ms`}
                </dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{formatDate(agent.endpoint.lastChecked)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted-copy">No endpoint evidence has been recorded.</p>
          )}
        </div>
        <div>
          <h3>Metadata provenance</h3>
          {agent.metadata ? (
            <dl className="compact-list">
              <div>
                <dt>Source</dt>
                <dd>{agent.metadata.source}</dd>
              </div>
              <div>
                <dt>Block</dt>
                <dd>{agent.metadata.blockNumber?.toLocaleString() ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>{formatDate(agent.metadata.timestamp)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted-copy">No metadata provenance has been recorded.</p>
          )}
        </div>
      </div>

      {agent.trust?.evidence.length ? (
        <div className="evidence-sources">
          <h3>Trust evidence sources</h3>
          {agent.trust.evidence.map((evidence, index) => (
            <div className="evidence-row" key={`${evidence.source}-${evidence.timestamp}-${index}`}>
              <span>{formatLabel(evidence.source)}</span>
              <span>{formatDate(evidence.timestamp)}</span>
              <span>
                {evidence.blockNumber
                  ? `Block ${evidence.blockNumber.toLocaleString()}`
                  : 'Offchain evidence'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RegistryPanel({ agent }: { agent: MarketplaceAgentProfile }) {
  return (
    <aside className="registry-panel">
      <p className="eyebrow">Canonical identity</p>
      <dl className="compact-list">
        <div>
          <dt>Agent registry</dt>
          <dd title={agent.agentRegistry}>{formatAddress(agent.agentRegistry)}</dd>
        </div>
        <div>
          <dt>Identity registry</dt>
          <dd title={agent.identityRegistry}>{formatAddress(agent.identityRegistry)}</dd>
        </div>
        <div>
          <dt>Agent URI</dt>
          <dd title={agent.agentURI}>{formatAddress(agent.agentURI)}</dd>
        </div>
        <div>
          <dt>Last indexed</dt>
          <dd>{formatDate(agent.lastIndexedAt)}</dd>
        </div>
      </dl>
      <p className="registry-note">
        Identity and metadata are displayed as indexed evidence, not as an endorsement by Ambit.
      </p>
    </aside>
  );
}

function PolicyPanel({ agent }: { agent: MarketplaceAgentProfile }) {
  return (
    <section className="detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Execution boundary</p>
          <h2>Latest indexed policy</h2>
        </div>
        <StatusPill
          value={agent.supportedExecution ? 'execution supported' : 'execution not supported'}
          tone={agent.supportedExecution ? 'positive' : 'neutral'}
        />
      </div>
      {agent.policy ? (
        <div className="policy-grid">
          <DataPair label="Max transaction value" value={agent.policy.maxTxValue ?? 'Not set'} />
          <DataPair label="Daily spend" value={agent.policy.dailySpend ?? 'Not set'} />
          <DataPair
            label="Max slippage"
            value={
              agent.policy.maxSlippageBps === null
                ? 'Not set'
                : `${agent.policy.maxSlippageBps} bps`
            }
          />
          <DataPair
            label="Minimum health factor"
            value={agent.policy.minHealthFactor ?? 'Not set'}
          />
          <DataPair label="Expires" value={formatDate(agent.policy.expiry)} />
          <DataPair label="Policy indexed" value={formatDate(agent.policy.createdAt)} />
          <div className="policy-list">
            <span>Allowed protocols</span>
            <strong>{agent.policy.allowedProtocols.join(', ') || 'None'}</strong>
          </div>
          <div className="policy-list">
            <span>Allowed targets</span>
            <strong>{agent.policy.allowedTargets.map(formatAddress).join(', ') || 'None'}</strong>
          </div>
        </div>
      ) : (
        <div className="notice notice-warning">
          No execution policy is available. Ambit cannot infer safe authority from capabilities
          alone.
        </div>
      )}
    </section>
  );
}

function ActivityPanel({ agent }: { agent: MarketplaceAgentProfile }) {
  return (
    <section className="detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Observed evidence</p>
          <h2>Activity, reputation, and payments</h2>
        </div>
      </div>
      <div className="evidence-columns">
        <EvidenceList
          title="Activity"
          empty="No registered-wallet activity evidence."
          items={agent.activity.slice(0, 6).map((event) => ({
            key: `${event.txHash}-${event.kind}`,
            title: formatLabel(event.kind),
            meta: `Block ${event.blockNumber.toLocaleString()} · ${formatDate(event.timestamp)}`,
          }))}
        />
        <EvidenceList
          title="Reputation"
          empty="No reputation events indexed."
          items={agent.reputation.slice(0, 6).map((event) => ({
            key: `${event.txHash}-${event.clientAddress}`,
            title: `${event.value} value · ${event.tag1 ?? 'untagged'}`,
            meta: `${formatAddress(event.clientAddress)} · ${formatDate(event.timestamp)}`,
          }))}
        />
        <EvidenceList
          title="Payments"
          empty="No reliable payment evidence indexed."
          items={agent.payments.slice(0, 6).map((payment, index) => ({
            key: `${payment.source}-${payment.observedAt}-${index}`,
            title: `${formatLabel(payment.source)} · ${payment.reliable ? 'reliable' : 'unverified'}`,
            meta: `${payment.chainId ? `Chain ${payment.chainId} · ` : ''}${formatDate(payment.observedAt)}`,
          }))}
        />
      </div>
    </section>
  );
}

function EvidenceList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: readonly { key: string; title: string; meta: string }[];
}) {
  return (
    <div className="evidence-list">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted-copy">{empty}</p> : null}
      {items.map((item) => (
        <div className="timeline-item" key={item.key}>
          <span aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            <small>{item.meta}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutionHistory({
  executions,
}: {
  executions: PaginatedResult<ExecutionHistoryItem> | null;
}) {
  return (
    <section className="detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Public execution record</p>
          <h2>Requests and verified passports</h2>
        </div>
      </div>
      {!executions ? (
        <div className="notice notice-warning">Execution history is temporarily unavailable.</div>
      ) : null}
      {executions && executions.items.length === 0 ? (
        <p className="muted-copy">
          No public execution requests have been recorded for this agent.
        </p>
      ) : null}
      {executions?.items.map((execution) => {
        const passportVerified = Boolean(execution.passportId && execution.verifiedAt);
        return (
          <article className="execution-row" key={execution.id}>
            <div>
              <StatusPill
                value={passportVerified ? 'passport verified' : execution.requestStatus}
                tone={passportVerified ? 'positive' : 'warning'}
              />
              <h3>
                {execution.protocol ? formatLabel(execution.protocol) : 'Protocol not specified'}
              </h3>
              <p>
                {formatAddress(execution.destination)} · {execution.requestedValue} wei
              </p>
            </div>
            <dl className="execution-results">
              <div>
                <dt>Policy</dt>
                <dd>{formatLabel(execution.policyResult)}</dd>
              </div>
              <div>
                <dt>Simulation</dt>
                <dd>
                  {execution.simulationResult ? formatLabel(execution.simulationResult) : 'Pending'}
                </dd>
              </div>
              <div>
                <dt>Approval</dt>
                <dd>{formatLabel(execution.approvalResult)}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{formatDate(execution.createdAt)}</dd>
              </div>
            </dl>
            <div className="execution-proof">
              {passportVerified ? (
                <>
                  <strong>
                    {execution.outcome ? formatLabel(execution.outcome) : 'Receipt verified'}
                  </strong>
                  <span>Passport {formatAddress(execution.passportId!)}</span>
                  <span>{formatDate(execution.verifiedAt)}</span>
                </>
              ) : (
                <>
                  <strong>No verified passport</strong>
                  <span>A pending request or relay hash is not execution proof.</span>
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
