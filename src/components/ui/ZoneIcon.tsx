/**
 * ARGUS — Zone icon + short zone names shared by all tabs (specs/02-ui-dashboard.md §3)
 */

import React from 'react';
import { Bone, Brain, Eye, HeartPulse, ShieldAlert } from 'lucide-react';
import { BodyZoneId } from '../../types/argus';

export const ZONE_SHORT_NAME: Record<BodyZoneId, string> = {
  neuro: 'Neuro',
  cardio: 'Cardio',
  musculo: 'Bone & muscle',
  immune: 'Immune',
  behavioral: 'Sleep & mind',
};

export const ZoneIcon: React.FC<{ zone: BodyZoneId; className?: string }> = ({ zone, className = 'w-4 h-4' }) => {
  const Icon =
    zone === 'neuro' ? Brain : zone === 'cardio' ? HeartPulse : zone === 'musculo' ? Bone : zone === 'immune' ? ShieldAlert : Eye;
  return <Icon className={className} aria-hidden="true" />;
};
