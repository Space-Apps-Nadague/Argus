/**
 * Procedural stimulus glyphs for the cognition games (no image assets, no copyrighted stimuli).
 * A glyph is shape × color × fill × count × rotation, so thousands of distinct items exist.
 */
import React from 'react';

export type GlyphShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'star';
export type GlyphFill = 'solid' | 'outline' | 'striped';

export interface GlyphSpec {
  shape: GlyphShape;
  color: number; // 0..5
  fill: GlyphFill;
  count: number; // 1..3
  rot?: number; // degrees
}

export const SHAPES: GlyphShape[] = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star'];
export const FILLS: GlyphFill[] = ['solid', 'outline', 'striped'];
export const COLOR_COUNT = 6;

export const glyphKey = (g: GlyphSpec) => `${g.shape}-${g.color}-${g.fill}-${g.count}-${g.rot ?? 0}`;
export const sameGlyph = (a: GlyphSpec, b: GlyphSpec) => glyphKey(a) === glyphKey(b);

const poly = (n: number, r: number, start = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const star = (r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 ? r * 0.45 : r;
    const a = ((-90 + 36 * i) * Math.PI) / 180;
    return `${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

function ShapePath({ shape, r, ...rest }: { shape: GlyphShape; r: number } & React.SVGProps<SVGElement>) {
  const p = rest as React.SVGProps<SVGPolygonElement>;
  switch (shape) {
    case 'circle':
      return <circle r={r} {...(rest as React.SVGProps<SVGCircleElement>)} />;
    case 'square':
      return <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} rx={r * 0.15} {...(rest as React.SVGProps<SVGRectElement>)} />;
    case 'triangle':
      return <polygon points={poly(3, r * 1.1, -90)} {...p} />;
    case 'diamond':
      return <polygon points={poly(4, r * 1.1, -90)} {...p} />;
    case 'hexagon':
      return <polygon points={poly(6, r, -90)} {...p} />;
    case 'star':
      return <polygon points={star(r * 1.15)} {...p} />;
  }
}

const OFFSETS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-22, 0], [22, 0]],
  3: [[0, -20], [-22, 18], [22, 18]],
};

export const Glyph: React.FC<{ spec: GlyphSpec; size?: number; title?: string; className?: string }> = ({
  spec,
  size = 96,
  title,
  className = '',
}) => {
  const color = `var(--game-${(spec.color % COLOR_COUNT) + 1})`;
  const id = React.useId().replace(/:/g, '');
  const r = spec.count === 1 ? 34 : spec.count === 2 ? 17 : 15;
  return (
    <svg
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      <defs>
        <pattern id={`st-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill={color} />
        </pattern>
      </defs>
      <g transform={`rotate(${spec.rot ?? 0})`}>
        {OFFSETS[spec.count].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <ShapePath
              shape={spec.shape}
              r={r}
              fill={spec.fill === 'solid' ? color : spec.fill === 'striped' ? `url(#st-${id})` : 'none'}
              stroke={color}
              strokeWidth={3}
              strokeLinejoin="round"
            />
          </g>
        ))}
      </g>
    </svg>
  );
};
