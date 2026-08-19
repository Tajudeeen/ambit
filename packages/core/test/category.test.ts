import { describe, expect, it } from 'vitest';
import {
  CATEGORY_CLASSIFIER_VERSION,
  classifyAgentCategory,
  type CategoryMetadataInput,
} from '../src/index.js';

function metadata(overrides: Partial<CategoryMetadataInput> = {}): CategoryMetadataInput {
  return {
    name: 'General agent',
    description: 'Performs a documented autonomous service.',
    services: [{ name: 'agent-service', skills: [], domains: [] }],
    ...overrides,
  };
}

describe('M11 category classifier', () => {
  it.each([
    ['rebalancing', metadata({ services: [{ name: 'liquidity-rebalancing' }] })],
    ['grid-trading', metadata({ services: [{ name: 'trader', skills: ['grid-trading'] }] })],
    [
      'health-factor',
      metadata({ services: [{ name: 'risk-agent', domains: ['position-health'] }] }),
    ],
    [
      'yield',
      metadata({ name: 'Vault operator', description: 'A deterministic yield optimizer.' }),
    ],
  ] as const)('classifies %s from reviewed aliases', (expected, input) => {
    expect(classifyAgentCategory(input)).toMatchObject({
      category: expected,
      status: 'classified',
      methodologyVersion: CATEGORY_CLASSIFIER_VERSION,
    });
  });

  it('gives structured service signals precedence over free text', () => {
    const result = classifyAgentCategory(
      metadata({
        name: 'Yield monitor',
        description: 'Mentions yield and monitoring for discovery copy.',
        services: [{ name: 'grid-trading' }],
      }),
    );

    expect(result).toMatchObject({
      category: 'grid-trading',
      status: 'classified',
      source: 'structured',
      matchedCategories: ['grid-trading'],
    });
  });

  it('leaves multi-category structured metadata uncategorized', () => {
    const result = classifyAgentCategory(
      metadata({ services: [{ name: 'liquidity-rebalancing' }, { name: 'yield-optimizer' }] }),
    );

    expect(result).toMatchObject({
      category: null,
      status: 'ambiguous',
      source: 'structured',
      matchedCategories: ['rebalancing', 'yield'],
    });
  });

  it('does not use category ordering to break an ambiguous text tie', () => {
    const result = classifyAgentCategory(
      metadata({
        name: 'Position health and yield assistant',
        description: 'Tracks liquidation risk while comparing yield.',
        services: [{ name: 'agent-service' }],
      }),
    );

    expect(result.category).toBeNull();
    expect(result.status).toBe('ambiguous');
    expect(result.matchedCategories).toEqual(['health-factor', 'yield']);
  });

  it('uses whole phrases and ignores unknown object-valued claims', () => {
    const result = classifyAgentCategory(
      metadata({
        name: 'Yielding results assistant',
        description: 'Monitors nothing and contains no reviewed category phrase.',
        services: [
          {
            name: 'agent-service',
            skills: [{ name: 'grid-trading' }],
            domains: [{ name: 'health-factor' }],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      category: null,
      status: 'unknown',
      matchedCategories: [],
    });
  });
});
