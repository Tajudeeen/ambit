import type { MarketplaceTrust } from '@/lib/marketplace-api';
import { formatLabel } from '@/lib/format';

interface TrustScoreProps {
  trust: MarketplaceTrust | null;
  compact?: boolean;
}

export function TrustScore({ trust, compact = false }: TrustScoreProps) {
  if (!trust) {
    return (
      <div className={`trust-score trust-empty${compact ? ' trust-compact' : ''}`}>
        <strong>—</strong>
        <span>Insufficient evidence</span>
      </div>
    );
  }

  return (
    <div className={`trust-score${compact ? ' trust-compact' : ''}`}>
      <strong>{trust.score}</strong>
      <span>{formatLabel(trust.confidence)} confidence</span>
    </div>
  );
}
