import type { AgentCategory } from './agent.js';

export const CATEGORY_CLASSIFIER_VERSION = 'v1.0.0' as const;

export interface CategoryMetadataInput {
  name: string;
  description: string;
  services: readonly {
    name: string;
    skills?: readonly unknown[];
    domains?: readonly unknown[];
  }[];
}

export interface CategoryClassification {
  category: AgentCategory | null;
  status: 'classified' | 'ambiguous' | 'unknown';
  source: 'structured' | 'text' | null;
  matchedCategories: readonly AgentCategory[];
  matchedSignals: readonly string[];
  methodologyVersion: typeof CATEGORY_CLASSIFIER_VERSION;
}

const CATEGORY_ORDER: readonly AgentCategory[] = [
  'monitoring',
  'grid-trading',
  'health-factor',
  'yield',
];

const CATEGORY_ALIASES: Readonly<Record<AgentCategory, readonly string[]>> = {
  monitoring: ['monitoring', 'alerting', 'observability', 'watcher', 'surveillance'],
  'grid-trading': ['grid trading', 'grid trader', 'grid bot', 'range grid'],
  'health-factor': [
    'health factor',
    'position health',
    'liquidation risk',
    'liquidation protection',
    'collateral risk',
  ],
  yield: [
    'yield',
    'yield farming',
    'yield optimizer',
    'vault strategy',
    'staking optimizer',
    'liquidity mining',
  ],
};

export function classifyAgentCategory(input: CategoryMetadataInput): CategoryClassification {
  const structured = classifySignals(structuredSignals(input));
  if (structured.categories.length > 0) {
    return classification(structured, 'structured');
  }

  const text = classifySignals([
    { field: 'name', value: input.name },
    { field: 'description', value: input.description },
  ]);
  if (text.categories.length > 0) {
    return classification(text, 'text');
  }

  return {
    category: null,
    status: 'unknown',
    source: null,
    matchedCategories: [],
    matchedSignals: [],
    methodologyVersion: CATEGORY_CLASSIFIER_VERSION,
  };
}

function structuredSignals(input: CategoryMetadataInput): Signal[] {
  return input.services.flatMap((service, index) => [
    { field: `services[${index}].name`, value: service.name },
    ...stringSignals(`services[${index}].skills`, service.skills),
    ...stringSignals(`services[${index}].domains`, service.domains),
  ]);
}

function stringSignals(field: string, values: readonly unknown[] | undefined): Signal[] {
  if (!values) return [];
  return values.flatMap((value, index) =>
    typeof value === 'string' ? [{ field: `${field}[${index}]`, value }] : [],
  );
}

function classifySignals(signals: readonly Signal[]): MatchSet {
  const categories = new Set<AgentCategory>();
  const matchedSignals = new Set<string>();

  for (const signal of signals) {
    const normalized = normalize(signal.value);
    if (!normalized) continue;
    for (const category of CATEGORY_ORDER) {
      if (CATEGORY_ALIASES[category].some((alias) => containsPhrase(normalized, alias))) {
        categories.add(category);
        matchedSignals.add(`${signal.field}:${normalized}`);
      }
    }
  }

  return {
    categories: CATEGORY_ORDER.filter((category) => categories.has(category)),
    signals: [...matchedSignals].sort(),
  };
}

function classification(matches: MatchSet, source: 'structured' | 'text'): CategoryClassification {
  const category = matches.categories.length === 1 ? (matches.categories[0] ?? null) : null;
  return {
    category,
    status: category ? 'classified' : 'ambiguous',
    source,
    matchedCategories: matches.categories,
    matchedSignals: matches.signals,
    methodologyVersion: CATEGORY_CLASSIFIER_VERSION,
  };
}

function containsPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${normalize(phrase)} `);
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

interface Signal {
  field: string;
  value: string;
}

interface MatchSet {
  categories: AgentCategory[];
  signals: string[];
}
