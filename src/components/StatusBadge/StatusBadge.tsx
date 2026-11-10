import {
  Check,
  CircleDashed,
  Info,
  TriangleAlert,
  type LucideIcon,
  X,
} from 'lucide-react';
import { Badge } from '@/components/Badge';
import { statusBadgeTone, type StatusTone } from '@/lib/statusBadge';

export type StatusBadgeProps = {
  tone: StatusTone;
  /** The status in words. The icon repeats it, so color is never the only signal. */
  label: string;
};

const toneIcon = {
  success: Check,
  warning: TriangleAlert,
  danger: X,
  info: Info,
  neutral: CircleDashed,
} satisfies Record<StatusTone, LucideIcon>;

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  const Icon = toneIcon[tone];
  return <Badge tone={statusBadgeTone[tone]} label={label} icon={<Icon />} />;
}
