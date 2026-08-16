/**
 * Altana integration — ADAPTER INTERFACE ONLY (M0 baseline).
 *
 * Per the hackathon brief and the recon report, the "Altana" integration is:
 *   - agents transact from their own Altana wallets
 *   - sessions with real spend caps + expiries registered onchain
 *   - revocation the user can see
 *   - judged via the Altana explorer (live onchain txs)
 *
 * The authoritative Altana SDK/explorer was NOT yet resolved at M0 (the public
 * `docs.altana.ai` is an unrelated supply-chain company). Per the build rule
 * "verify before integrate" we define the contract our execution plane needs,
 * implement against a deterministic in-memory fake for M0-M6 tests, and slot the
 * REAL Altana SDK behind this interface at M7 once identified. NO fake
 * addresses, NO fabricated onchain sessions.
 */

export interface AltanaSession {
  sessionId: string;
  agentId: string;
  /** User (principal) authorizing the agent. */
  principal: string;
  /** Bounded Altana wallet the agent transacts from. */
  wallet: string;
  /** Max value (in wei or token base units) the session may spend. */
  spendCap: bigint;
  /** Unix seconds; session is invalid after this. */
  expiresAt: number;
  /** Allowed destination contracts. */
  allowedTargets: string[];
  /** Allowed protocols (e.g. 'pancakeswap'). */
  allowedProtocols: string[];
  revoked: boolean;
  /** Onchain registration tx hash, once registered with real Altana. */
  registeredTxHash?: string;
}

export interface AltanaAdapter {
  readonly name: string;
  /** Register a bounded session onchain (real Altana) or record it (fake). */
  createSession(input: Omit<AltanaSession, 'sessionId' | 'revoked' | 'registeredTxHash'>): Promise<AltanaSession>;
  getSession(sessionId: string): Promise<AltanaSession | null>;
  revokeSession(sessionId: string): Promise<void>;
  /** True if the session is currently valid (active, unrevoked, unexpired). */
  isAuthorized(sessionId: string): Promise<boolean>;
}

/**
 * Deterministic in-memory adapter used by M0-M6 unit/integration tests.
 * It is explicitly a TEST DOUBLE, never wired to anything that claims to be
 * the real Altana network. M7 replaces the wiring with a real adapter.
 */
export class FakeAltanaAdapter implements AltanaAdapter {
  readonly name = 'fake-altana-testdouble';
  private sessions = new Map<string, AltanaSession>();

  async createSession(
    input: Omit<AltanaSession, 'sessionId' | 'revoked' | 'registeredTxHash'>,
  ): Promise<AltanaSession> {
    const session: AltanaSession = {
      ...input,
      sessionId: `fake-${Math.random().toString(36).slice(2, 10)}`,
      revoked: false,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async getSession(sessionId: string): Promise<AltanaSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.revoked = true;
  }

  async isAuthorized(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s || s.revoked) return false;
    return s.expiresAt > Math.floor(Date.now() / 1000);
  }
}
