/**
 * ARGUS — StatusPill primitive (specs/02-ui-dashboard.md §3)
 * Status is always color + icon + word, never color alone (WCAG 1.4.1).
 */

import React from 'react';
import { CheckCircle2, OctagonAlert, TriangleAlert } from 'lucide-react';
import { TriageStatus } from '../../types/argus';

export const STATUS_WORD: Record<TriageStatus, string> = {
  green: 'Nominal',
  yellow: 'Caution',
  red: 'Alert',
};

const STATUS_CLASS: Record<TriageStatus, string> = {
  green: 'text-status-green bg-status-green/10 border-status-green/40',
  yellow: 'text-status-yellow bg-status-yellow/10 border-status-yellow/40',
  red: 'text-status-red bg-status-red/10 border-status-red/50',
};

export const StatusIcon: React.FC<{ status: TriageStatus; className?: string }> = ({
  status,
  className = 'w-3.5 h-3.5',
}) => {
  const Icon = status === 'green' ? CheckCircle2 : status === 'yellow' ? TriangleAlert : OctagonAlert;
  return <Icon className={className} aria-hidden="true" />;
};

interface StatusPillProps {
  status: TriageStatus;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, size = 'sm', label, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${
      size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
    } ${STATUS_CLASS[status]} ${className}`}
  >
    <StatusIcon status={status} className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
    {label ?? STATUS_WORD[status]}
  </span>
);
