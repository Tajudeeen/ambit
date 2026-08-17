import { formatLabel } from '@/lib/format';

interface StatusPillProps {
  value: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'brand';
}

export function StatusPill({ value, tone = 'neutral' }: StatusPillProps) {
  return <span className={`status-pill status-${tone}`}>{formatLabel(value)}</span>;
}

export function verificationTone(value: string): StatusPillProps['tone'] {
  if (value === 'execution-verified') return 'positive';
  if (value === 'data-verified') return 'brand';
  return 'neutral';
}

export function endpointTone(value: string): StatusPillProps['tone'] {
  if (value === 'up') return 'positive';
  if (value === 'degraded') return 'warning';
  if (value === 'down') return 'danger';
  return 'neutral';
}
