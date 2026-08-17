'use client';

import { useState, type FormEvent } from 'react';
import type { ExecutionHistoryItem } from '@/lib/marketplace-api';

interface HirePanelProps {
  agentRegistry: string;
  protocols: readonly string[];
  supportedExecution: boolean;
}

type HireState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; request: ExecutionHistoryItem }
  | { kind: 'error'; message: string; issues: readonly string[] };

export function HirePanel({ agentRegistry, protocols, supportedExecution }: HirePanelProps) {
  const [requester, setRequester] = useState('');
  const [state, setState] = useState<HireState>({ kind: 'idle' });

  async function connectWallet() {
    const provider = (
      window as Window & {
        ethereum?: { request(input: { method: string }): Promise<unknown> };
      }
    ).ethereum;
    if (!provider) {
      setState({ kind: 'error', message: 'No injected wallet was detected.', issues: [] });
      return;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const account = Array.isArray(accounts)
        ? accounts.find((value) => typeof value === 'string')
        : null;
      if (!account || typeof account !== 'string') throw new Error('No account returned');
      setRequester(account);
      setState({ kind: 'idle' });
    } catch {
      setState({ kind: 'error', message: 'Wallet connection was not completed.', issues: [] });
    }
  }

  async function submitHire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: 'submitting' });
    const data = new FormData(event.currentTarget);
    const payload = {
      clientRequestId: crypto.randomUUID(),
      requester: String(data.get('requester') ?? ''),
      destination: String(data.get('destination') ?? ''),
      protocol: String(data.get('protocol') ?? ''),
      requestedValue: String(data.get('requestedValue') ?? ''),
    };

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentRegistry)}/hire`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = publicError(body);
        setState({ kind: 'error', message: error.message, issues: error.issues });
        return;
      }
      if (!isRecord(body) || !isRecord(body.request)) {
        setState({
          kind: 'error',
          message: 'The marketplace returned an invalid response.',
          issues: [],
        });
        return;
      }
      setState({ kind: 'success', request: body.request as unknown as ExecutionHistoryItem });
    } catch {
      setState({
        kind: 'error',
        message: 'The hire request could not reach the marketplace.',
        issues: [],
      });
    }
  }

  return (
    <aside className="hire-panel" id="hire">
      <p className="eyebrow eyebrow-accent">Bounded execution request</p>
      <h2>Request this agent</h2>
      <p>
        This creates a pending authorization request. It does not approve policy, grant a session,
        or claim successful execution.
      </p>

      {!supportedExecution ? (
        <div className="notice notice-warning">
          This agent has not advertised supported execution. You can inspect its evidence, but Ambit
          will not imply that it can execute safely.
        </div>
      ) : null}

      <form onSubmit={submitHire} className="hire-form">
        <label className="field">
          <span>Requester wallet</span>
          <div className="input-action">
            <input
              name="requester"
              value={requester}
              onChange={(event) => setRequester(event.target.value)}
              placeholder="0x…"
              required
              pattern="0x[0-9a-fA-F]{40}"
            />
            <button className="button button-compact" type="button" onClick={connectWallet}>
              Connect
            </button>
          </div>
        </label>
        <label className="field">
          <span>Destination contract</span>
          <input name="destination" placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" />
        </label>
        <label className="field">
          <span>Protocol</span>
          <input
            name="protocol"
            list="agent-protocols"
            defaultValue={protocols[0] ?? ''}
            placeholder="Optional protocol label"
          />
          <datalist id="agent-protocols">
            {protocols.map((protocol) => (
              <option value={protocol} key={protocol} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Requested native value (wei)</span>
          <input
            name="requestedValue"
            defaultValue="0"
            inputMode="numeric"
            pattern="0|[1-9][0-9]*"
            required
          />
        </label>
        <button
          className="button button-primary button-wide"
          type="submit"
          disabled={state.kind === 'submitting' || !supportedExecution}
        >
          {state.kind === 'submitting' ? 'Creating request…' : 'Create pending request'}
        </button>
      </form>

      <div className="hire-status" aria-live="polite">
        {state.kind === 'success' ? (
          <div className="notice notice-success">
            <strong>Request created.</strong>
            <span>Status: {state.request.requestStatus}</span>
            <code>{state.request.id}</code>
          </div>
        ) : null}
        {state.kind === 'error' ? (
          <div className="notice notice-error" role="alert">
            <strong>{state.message}</strong>
            {state.issues.map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function publicError(value: unknown): { message: string; issues: readonly string[] } {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { message: 'The hire request failed.', issues: [] };
  }
  return {
    message:
      typeof value.error.message === 'string' ? value.error.message : 'The hire request failed.',
    issues: Array.isArray(value.error.issues)
      ? value.error.issues.filter((issue): issue is string => typeof issue === 'string')
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
