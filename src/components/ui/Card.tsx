/**
 * ARGUS — Card primitive (specs/02-ui-dashboard.md §3)
 * Glass panel with an optional title row (icon + display label + actions).
 */

import React from 'react';

interface CardProps {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
  ariaLabel?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  icon,
  actions,
  className = '',
  bodyClassName = 'p-4',
  as: Tag = 'section',
  ariaLabel,
  children,
}) => (
  <Tag className={`hud-card ${className}`} aria-label={ariaLabel}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        {title && (
          <h2 className="flex min-w-0 items-center gap-2 font-display text-[13px] font-semibold tracking-wide text-hud-text">
            {icon && <span className="text-hud-accent" aria-hidden="true">{icon}</span>}
            {title}
          </h2>
        )}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
    )}
    <div className={bodyClassName}>{children}</div>
  </Tag>
);
