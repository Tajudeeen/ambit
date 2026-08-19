import type { AgentCategory } from './marketplace-api';

export interface CategoryDefinition {
  id: AgentCategory;
  code: string;
  label: string;
  description: string;
}

export const CATEGORY_DIRECTORY: readonly CategoryDefinition[] = [
  {
    id: 'rebalancing',
    code: 'RB',
    label: 'Rebalancing',
    description:
      'Manage liquidity ranges and position allocation with explicit strategy and execution evidence.',
  },
  {
    id: 'grid-trading',
    code: 'GT',
    label: 'Grid trading',
    description: 'Discover agents that declare bounded range and grid strategy capabilities.',
  },
  {
    id: 'health-factor',
    code: 'HF',
    label: 'Health factor',
    description:
      'Inspect agents focused on collateral ratios, position health, and liquidation risk.',
  },
  {
    id: 'yield',
    code: 'YD',
    label: 'Yield',
    description: 'Explore declared vault, staking, farming, and liquidity-incentive capabilities.',
  },
];

export function categoryHref(category: AgentCategory): string {
  return `/?category=${category}#marketplace`;
}
