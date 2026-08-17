import type { AgentSearchInput } from './marketplace-api';

export function searchInput(
  params: Record<string, string | string[] | undefined>,
): AgentSearchInput {
  return {
    q: first(params.q),
    category: first(params.category),
    verificationTier: first(params.verificationTier),
    supportedExecution: first(params.supportedExecution),
    protocol: first(params.protocol),
    minTrustScore: first(params.minTrustScore),
    cursor: first(params.cursor),
  };
}

export function nextPageHref(values: AgentSearchInput, cursor: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...values, cursor })) {
    if (value) params.set(key, value);
  }
  return `/?${params}`;
}

export function hasFilters(values: AgentSearchInput): boolean {
  return Object.values(values).some(Boolean);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
