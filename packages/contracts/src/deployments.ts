import type { Address, Hash } from 'viem';

/**
 * Verified public deployment metadata for the score attestation contract.
 *
 * This module intentionally contains no signer, RPC credential, or private key.
 * Deployments should be performed with an operator-supplied environment secret.
 */
export interface ContractDeployment {
  chainId: number;
  address: Address;
  deployer: Address;
  transactionHash: Hash;
  blockNumber: bigint;
  explorerUrl: string;
}

export const AMBIT_SCORE_ATTESTATION_BSC_TESTNET: ContractDeployment = {
  chainId: 97,
  address: '0xacc188c511d2230ae0ef6e17e9c6bc54da3fe0ae',
  deployer: '0x541291139b59570D1CD5D0E64df217b3F6efd7c8',
  transactionHash: '0xf7377900229dd945c34cddf9a7b585fb00e9f74739855f7987a50bc740ab47af',
  blockNumber: 125979676n,
  explorerUrl: 'https://testnet.bscscan.com/address/0xacc188c511d2230ae0ef6e17e9c6bc54da3fe0ae',
};
