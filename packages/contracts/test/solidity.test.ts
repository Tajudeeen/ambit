import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import solc from 'solc';
import { AMBIT_SCORE_ATTESTATION_ABI } from '../src/abi.js';

interface AbiParameter {
  type: string;
  components?: AbiParameter[];
}

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: AbiParameter[];
}

interface SolcOutput {
  contracts?: Record<
    string,
    Record<string, { abi: unknown[]; evm?: { bytecode?: { object?: string } } }>
  >;
  errors?: Array<{ severity: string; formattedMessage: string }>;
}

describe('AmbitScoreAttestation Solidity contract', () => {
  it('compiles with the pinned compiler and exposes the verification surface', async () => {
    const source = await readFile(
      new URL('../src/AmbitScoreAttestation.sol', import.meta.url),
      'utf8',
    );
    const input = {
      language: 'Solidity',
      sources: { 'AmbitScoreAttestation.sol': { content: source } },
      settings: {
        evmVersion: 'cancun',
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
    const errors = output.errors?.filter((error) => error.severity === 'error') ?? [];
    expect(errors, errors.map((error) => error.formattedMessage).join('\n')).toHaveLength(0);

    const contract = output.contracts?.['AmbitScoreAttestation.sol']?.AmbitScoreAttestation;
    expect(contract).toBeDefined();
    expect(contract?.evm?.bytecode?.object).toMatch(/^[0-9a-f]+$/);

    const compiledSurface = (contract?.abi as AbiEntry[])
      .filter((entry) => ['error', 'event', 'function'].includes(entry.type))
      .map(abiSignature)
      .sort();
    const exportedSurface = (AMBIT_SCORE_ATTESTATION_ABI as readonly AbiEntry[])
      .filter((entry) => ['error', 'event', 'function'].includes(entry.type))
      .map(abiSignature)
      .sort();
    expect(exportedSurface).toEqual(compiledSurface);
  });
});

function abiSignature(entry: AbiEntry): string {
  const inputs = (entry.inputs ?? []).map(abiParameterType).join(',');
  return `${entry.type}:${entry.name ?? ''}(${inputs})`;
}

function abiParameterType(parameter: AbiParameter): string {
  if (!parameter.type.startsWith('tuple')) return parameter.type;
  const suffix = parameter.type.slice('tuple'.length);
  return `(${(parameter.components ?? []).map(abiParameterType).join(',')})${suffix}`;
}
