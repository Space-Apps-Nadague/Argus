/**
 * ARGUS — Non-color status badge for Thousand Eyes indicators (WCAG 1.4.1).
 */

import React from 'react';
import { CheckCircle2, CircleDashed, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { EyeStatus } from './types';

export const EYE_STATUS_LABEL: Record<EyeStatus, string> = {
  nodata: 'No data',
  nominal: 'On baseline',
  drifting: 'Drifting',
  red_flag: 'Red flag',
};

const EYE_STATUS_CLASS: Record<EyeStatus, string> = {
  nodata: 'border-slate-600/60 bg-slate-800/60 text-slate-300',
  nominal: 'border-status-green/40 bg-status-green/10 text-status-green',
  drifting: 'border-status-yellow/40 bg-status-yellow/10 text-status-yellow',
  red_flag: 'border-status-red/50 bg-status-red/10 text-status-red',
};

export const EyeStatusIcon: React.FC<{ status: EyeStatus; className?: string }> = ({
  status,
  className = 'h-3.5 w-3.5',
}) => {
  const Icon =
    status === 'nominal'
      ? CheckCircle2
      : status === 'drifting'
        ? TriangleAlert
        : status === 'red_flag'
          ? OctagonAlert
          : CircleDashed;
  return <Icon className={className} aria-hidden="true" />;
};

interface EyeStatusBadgeProps {
  status: EyeStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export const EyeStatusBadge: React.FC<EyeStatusBadgeProps> = ({
  status,
  size = 'sm',
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${
      size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
    } ${EYE_STATUS_CLASS[status]} ${className}`}
  >
    <EyeStatusIcon status={status} className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    {EYE_STATUS_LABEL[status]}
  </span>
);
