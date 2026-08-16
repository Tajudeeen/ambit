import { describe, it, expect } from 'vitest';
import { verifyActivity, type ActivityClient } from '../src/index.js';

const OBSERVED_AT = '2026-08-16T12:00:00.000Z';

function clientWith(count: number): ActivityClient {
  return { getTransactionCount: async () => count };
}

describe('on-chain activity verification (M4)', () => {
  it('verifies activity when the wallet has sent transactions', async () => {
    const r = await verifyActivity(clientWith(12), {
      wallet: '0xabc',
      observedAtBlock: 41_000_000n,
      observedAt: OBSERVED_AT,
    });
    expect(r.verifiedActivity).toBe(true);
    expect(r.transactionCount).toBe(12);
    expect(r.observedAtBlock).toBe(41_000_000n);
    expect(r.evidence[0]).toMatchObject({
      source: 'onchain-wallet-transaction-count',
      timestamp: OBSERVED_AT,
      blockNumber: 41_000_000,
    });
  });

  it('does NOT claim activity for a fresh wallet (no fabrication)', async () => {
    const r = await verifyActivity(clientWith(0), {
      wallet: '0xnew',
      observedAtBlock: 41_000_000n,
      observedAt: OBSERVED_AT,
    });
    expect(r.verifiedActivity).toBe(false);
    expect(r.transactionCount).toBe(0);
  });

  it('respects a custom minimum transaction count', async () => {
    const r = await verifyActivity(clientWith(1), {
      wallet: '0x1',
      observedAtBlock: 1n,
      observedAt: OBSERVED_AT,
      minTransactionCount: 5,
    });
    expect(r.verifiedActivity).toBe(false);
  });

  it('is pure: same inputs -> same result', async () => {
    const opts = { wallet: '0x1' as const, observedAtBlock: 5n, observedAt: OBSERVED_AT };
    expect(await verifyActivity(clientWith(3), opts)).toEqual(
      await verifyActivity(clientWith(3), opts),
    );
  });

  it('rejects invalid transaction counts rather than fabricating a signal', async () => {
    await expect(
      verifyActivity(clientWith(-1), {
        wallet: '0x1',
        observedAtBlock: 5n,
        observedAt: OBSERVED_AT,
      }),
    ).rejects.toThrow('transactionCount');
  });
});
