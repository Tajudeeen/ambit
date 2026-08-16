import { describe, it, expect } from 'vitest';
import { ERC8004_IDENTITY_ABI, ERC8004_REPUTATION_ABI } from '../src/abis.js';

function find(abi: readonly unknown[], name: string) {
  return (abi as Array<{ name?: string }>).find((e) => e.name === name);
}

describe('erc8004 ABIs match the spec', () => {
  it('identity registry exposes register / setAgentURI / getMetadata / getAgentWallet', () => {
    expect(find(ERC8004_IDENTITY_ABI, 'register')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'setAgentURI')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'getMetadata')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'getMetadata')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'getAgentWallet')).toBeDefined();
  });

  it('identity registry emits Registered / URIUpdated / MetadataSet', () => {
    expect(find(ERC8004_IDENTITY_ABI, 'Registered')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'URIUpdated')).toBeDefined();
    expect(find(ERC8004_IDENTITY_ABI, 'MetadataSet')).toBeDefined();
  });

  it('reputation registry exposes giveFeedback and getIdentityRegistry', () => {
    expect(find(ERC8004_REPUTATION_ABI, 'giveFeedback')).toBeDefined();
    expect(find(ERC8004_REPUTATION_ABI, 'getIdentityRegistry')).toBeDefined();
  });

  it('reputation NewFeedback carries agentId + clientAddress-indexed', () => {
    const ev = find(ERC8004_REPUTATION_ABI, 'NewFeedback') as { inputs: Array<{ name: string; indexed: boolean }> };
    const agentId = ev.inputs.find((i) => i.name === 'agentId');
    const client = ev.inputs.find((i) => i.name === 'clientAddress');
    expect(agentId?.indexed).toBe(true);
    expect(client?.indexed).toBe(true);
  });
});
