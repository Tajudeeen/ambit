import { describe, expect, it } from 'vitest';
import type { PublicClient } from 'viem';
import { Erc8004Reader } from '../src/reader.js';
import { getNetwork } from '../src/networks.js';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

function readerWith(readContract: PublicClient['readContract']): Erc8004Reader {
  const client = { readContract } as unknown as PublicClient;
  return new Erc8004Reader(client, getNetwork(56));
}

describe('Erc8004Reader.getAgentWallet', () => {
  it('reads the wallet at the requested observation block', async () => {
    let requestedBlock: bigint | undefined;
    const reader = readerWith((async (request: { blockNumber?: bigint }) => {
      requestedBlock = request.blockNumber;
      return WALLET;
    }) as PublicClient['readContract']);

    await expect(reader.getAgentWallet(7n, 41_000_100n)).resolves.toBe(WALLET);
    expect(requestedBlock).toBe(41_000_100n);
  });

  it('treats the zero address as an unset wallet', async () => {
    const reader = readerWith(
      (async () => '0x0000000000000000000000000000000000000000') as PublicClient['readContract'],
    );
    await expect(reader.getAgentWallet(7n)).resolves.toBeNull();
  });

  it('returns no claim when the registry read fails', async () => {
    const reader = readerWith((async () =>
      Promise.reject(new Error('RPC unavailable'))) as PublicClient['readContract']);
    await expect(reader.getAgentWallet(7n)).resolves.toBeNull();
  });
});
