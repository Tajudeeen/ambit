'use client';

import { buildAgentActivationMessage } from '@ambit/core/activation';
import { useState, type FormEvent } from 'react';
import type { ExecutionHistoryItem } from '@/lib/marketplace-api';

interface HirePanelProps {
  agentRegistry: string;
  protocols: readonly string[];
  supportedExecution: boolean;
  defaultDestination: string | null;
}

type HireState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; request: ExecutionHistoryItem }
  | { kind: 'error'; message: string; issues: readonly string[] };

interface EthereumProvider {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export function HirePanel({
  agentRegistry,
  protocols,
  supportedExecution,
  defaultDestination,
}: HirePanelProps) {
  const [requester, setRequester] = useState('');
  const [state, setState] = useState<HireState>({ kind: 'idle' });

  function provider(): EthereumProvider | null {
    return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
  }

  async function connectWallet() {
    const ethereum = provider();
    if (!ethereum) {
      setState({ kind: 'error', message: 'No injected wallet was detected.', issues: [] });
      return;
    }
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
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
    const ethereum = provider();
    if (!ethereum || !requester || !defaultDestination) {
      setState({
        kind: 'error',
        message: 'Connect a wallet and select an agent with an activation target.',
        issues: [],
      });
      return;
    }

    setState({ kind: 'submitting' });
    const data = new FormData(event.currentTarget);
    const clientRequestId = crypto.randomUUID();
    const protocol = String(data.get('protocol') ?? '').trim();
    const requestedValue = String(data.get('requestedValue') ?? '0');
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const activation = {
      agentRegistry,
      clientRequestId,
      requester,
      destination: defaultDestination,
      ...(protocol ? { protocol } : {}),
      requestedValue,
      expiresAt,
    };

    try {
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [utf8ToHex(buildAgentActivationMessage(activation)), requester],
      });
      if (typeof signature !== 'string') throw new Error('Wallet returned an invalid signature');

      const response = await fetch(`/api/agents/${encodeURIComponent(agentRegistry)}/hire`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...activation, signature }),
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
        message: 'The activation was not signed or could not reach the marketplace.',
        issues: [],
      });
    }
  }

  const canActivate = supportedExecution && Boolean(defaultDestination);

  return (
    <aside className="hire-panel" id="hire">
      <p className="eyebrow eyebrow-accent">Wallet-authorized activation</p>
      <h2>Activate this agent</h2>
      <p>
        Your wallet signs the exact agent, protocol, target, and value. Ambit verifies that
        signature before recording the activation.
      </p>

      {!supportedExecution ? (
        <div className="notice notice-warning">
          This agent has not advertised an active execution service and cannot be activated.
        </div>
      ) : null}
      {supportedExecution && !defaultDestination ? (
        <div className="notice notice-warning">
          This agent has no registered wallet or policy-approved activation target.
        </div>
      ) : null}

      <form onSubmit={submitHire} className="hire-form">
        <label className="field">
          <span>Requester wallet</span>
          <div className="input-action">
            <input value={requester} placeholder="Connect wallet" readOnly required />
            <button className="button button-compact" type="button" onClick={connectWallet}>
              Connect
            </button>
          </div>
        </label>
        <label className="field">
          <span>Service</span>
          <select name="protocol" defaultValue={protocols[0] ?? ''}>
            {protocols.length === 0 ? <option value="">General service</option> : null}
            {protocols.map((protocol) => (
              <option value={protocol} key={protocol}>
                {protocol}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Maximum native value (wei)</span>
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
          disabled={state.kind === 'submitting' || !canActivate || !requester}
        >
          {state.kind === 'submitting' ? 'Confirm in wallet...' : 'Activate agent'}
        </button>
      </form>

      <div className="hire-status" aria-live="polite">
        {state.kind === 'success' ? (
          <div className="notice notice-success">
            <strong>Agent activated.</strong>
            <span>Status: {state.request.requestStatus}</span>
            <span>Execution remains subject to policy, simulation, and session limits.</span>
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

function utf8ToHex(value: string): `0x${string}` {
  return `0x${[...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function publicError(value: unknown): { message: string; issues: readonly string[] } {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { message: 'The activation failed.', issues: [] };
  }
  return {
    message:
      typeof value.error.message === 'string' ? value.error.message : 'The activation failed.',
    issues: Array.isArray(value.error.issues)
      ? value.error.issues.filter((issue): issue is string => typeof issue === 'string')
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
