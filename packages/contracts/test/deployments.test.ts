import { describe, expect, it } from 'vitest';
import { AMBIT_SCORE_ATTESTATION_BSC_TESTNET } from '../src/deployments.js';

describe('verified contract deployments', () => {
  it('records the confirmed BSC testnet attestation deployment', () => {
    expect(AMBIT_SCORE_ATTESTATION_BSC_TESTNET).toMatchObject({
      chainId: 97,
      address: '0xacc188c511d2230ae0ef6e17e9c6bc54da3fe0ae',
      deployer: '0x541291139b59570D1CD5D0E64df217b3F6efd7c8',
      transactionHash: '0xf7377900229dd945c34cddf9a7b585fb00e9f74739855f7987a50bc740ab47af',
      blockNumber: 125979676n,
    });
    expect(AMBIT_SCORE_ATTESTATION_BSC_TESTNET.explorerUrl).toContain(
      AMBIT_SCORE_ATTESTATION_BSC_TESTNET.address,
    );
  });
});
