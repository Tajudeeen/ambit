import { describe, it, expect } from 'vitest';
import { FakeAltanaAdapter } from '../src/index.js';

describe('altana FakeAltanaAdapter (test double)', () => {
  it('creates a session and reports it authorized within expiry', async () => {
    const a = new FakeAltanaAdapter();
    const s = await a.createSession({
      agentId: '0xabc',
      principal: '0xuser',
      wallet: '0xagentwallet',
      spendCap: 1_000_000n,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      allowedTargets: ['0xpancake'],
      allowedProtocols: ['pancakeswap'],
    });
    expect(s.revoked).toBe(false);
    expect(await a.isAuthorized(s.sessionId)).toBe(true);
  });

  it('revocation causes isAuthorized to return false', async () => {
    const a = new FakeAltanaAdapter();
    const s = await a.createSession({
      agentId: '0xabc',
      principal: '0xuser',
      wallet: '0xagentwallet',
      spendCap: 1_000_000n,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      allowedTargets: [],
      allowedProtocols: [],
    });
    await a.revokeSession(s.sessionId);
    expect(await a.isAuthorized(s.sessionId)).toBe(false);
    const after = await a.getSession(s.sessionId);
    expect(after?.revoked).toBe(true);
  });

  it('expired session is not authorized', async () => {
    const a = new FakeAltanaAdapter();
    const s = await a.createSession({
      agentId: '0xabc',
      principal: '0xuser',
      wallet: '0xagentwallet',
      spendCap: 1_000_000n,
      expiresAt: Math.floor(Date.now() / 1000) - 10,
      allowedTargets: [],
      allowedProtocols: [],
    });
    expect(await a.isAuthorized(s.sessionId)).toBe(false);
  });
});
