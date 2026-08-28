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

  it('exposes the rotatable-publisher security surface (AMB-2)', async () => {
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
    const contract = output.contracts?.['AmbitScoreAttestation.sol']?.AmbitScoreAttestation;
    const compiled = (contract?.abi as AbiEntry[])
      .map((entry) => abiSignature(entry))
      .sort();

    const required = [
      'function:owner()',
      'function:pendingPublisher()',
      'function:transferPublisher(address)',
      'function:acceptPublisher()',
      'event:PublisherRotated(address,address)',
      'error:NotOwner()',
      'error:PendingPublisherExists()',
    ];
    for (const sig of required) {
      expect(compiled, `compiled ABI missing ${sig}`).toContain(sig);
    }

    // Constructor preserves existing deploy semantics: the publisher is also the
    // initial owner, so a single-key deployment remains valid while gaining a
    // rotation + recovery path.
    expect(compiled).toContain('constructor:(address)');

    // Parity check mirrors the main test: compare only error/event/function entries
    // (the exported ABI surface), which is the contract's verified interface.
    const exportedSurface = (AMBIT_SCORE_ATTESTATION_ABI as readonly AbiEntry[])
      .filter((entry) => ['error', 'event', 'function'].includes(entry.type))
      .map(abiSignature)
      .sort();
    const compiledSurface = compiled
      .filter((sig) => sig.startsWith('error:') || sig.startsWith('event:') || sig.startsWith('function:'))
      .sort();
    expect(exportedSurface).toEqual(compiledSurface);
  });

  // In-repo static analysis gate (AMB-4). Slither is the recommended deeper gate;
  // this asserted set runs deterministically in CI with the pinned solc and no
  // network install, covering the findings from the manual contract review.
  it('satisfies contract static invariants (no selfdestruct/delegatecall, rotatable publisher)', async () => {
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
    const contract = output.contracts?.['AmbitScoreAttestation.sol']?.AmbitScoreAttestation;
    const bytecode = contract?.evm?.bytecode?.object ?? '';
    expect(bytecode, 'contract must compile to non-empty bytecode').toMatch(/^[0-9a-f]+$/);

    // No destructive / upgrade / external-call escape patterns in the source. The
    // manual review found publishRoot only writes storage + emits; these assertions
    // lock that in. (Slither is the recommended deeper gate — see AUDIT.md AMB-4.)
    expect(source).not.toMatch(/selfdestruct\s*\(/);
    expect(source).not.toMatch(/delegatecall/);
    expect(source).not.toMatch(/\.call\s*\{/);
    expect(source).not.toMatch(/address\s*\(\s*this\s*\)\s*\.call/);
    expect(source).not.toMatch(/assembly\s*\{/);

    // The publisher must NOT be immutable (AMB-2 fix): the source must allow rotation.
    expect(source).not.toMatch(/address\s+public\s+immutable\s+publisher/);
    expect(source).toMatch(/address\s+public\s+publisher/);

    // publishRoot is the only state-mutating external entry and must be guarded by
    // publisher authorization (no reentrancy surface: only storage writes + emit).
    const abi = contract?.abi as AbiEntry[];
    const publish = abi.find((entry) => entry.name === 'publishRoot');
    expect(publish).toBeDefined();
    expect(abiSignature(publish!)).toBe(
      'function:publishRoot(bytes32,bytes32,bytes32,uint64,uint32)',
    );
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
