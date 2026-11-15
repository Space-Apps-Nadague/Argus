/**
 * Game frame: intro card → 3-2-1 countdown → play with a live HUD (points, combo, progress).
 * specs/02-ui-dashboard.md §2.8
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Flame, Play, X } from 'lucide-react';
import type { CognitionGameDef, GameResult } from './types';
import { GAME_COMPONENTS } from './games';
import type { GameProgress } from './games/common';
import { sfx } from './sfx';

interface Props {
  def: CognitionGameDef;
  seed: number;
  isRetest: boolean;
  onFinish: (r: GameResult) => void;
  onCancel: () => void;
}

export const GameShell: React.FC<Props> = ({ def, seed, isRetest, onFinish, onCancel }) => {
  const [phase, setPhase] = useState<'intro' | 'count' | 'play'>('intro');
  const [count, setCount] = useState(3);
  const [hud, setHud] = useState<GameProgress>({ points: 0, progress: 0 });
  const Game = GAME_COMPONENTS[def.id];

  useEffect(() => {
    if (phase !== 'count') return;
    if (count === 0) {
      sfx.go();
      setPhase('play');
      return;
    }
    sfx.tick();
    const id = setTimeout(() => setCount((c) => c - 1), 700);
    return () => clearTimeout(id);
  }, [phase, count]);

  const onProgress = useCallback((p: GameProgress) => setHud(p), []);

  return (
    <div className="hud-card relative overflow-hidden p-4 sm:p-6" aria-live="polite">
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-0">
          <p className="font-display text-xs tracking-[0.2em] text-hud-muted">
            {isRetest ? 'RETEST' : 'TODAY’S GAME'} · {def.nasaTest.toUpperCase()}
          </p>
          <h3 className="font-display text-xl font-bold text-hud-text">{def.title}</h3>
        </div>
        {phase === 'play' && (
          <div className="ml-auto flex items-center gap-4">
            {(hud.combo ?? 0) > 1 && (
              <span className="game-pop flex items-center gap-1 font-mono text-sm text-game-4" key={hud.combo}>
                <Flame className="h-4 w-4" aria-hidden="true" />×{hud.combo}
              </span>
            )}
            <span className="font-mono text-2xl font-bold tabular-nums text-hud-accent" aria-label={`${hud.points} points`}>
              {hud.points}
            </span>
          </div>
        )}
        <button type="button" onClick={onCancel} className="hud-btn ml-2 h-8 w-8 p-0" aria-label="Quit game">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {phase === 'play' && (
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-hud-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.progress * 100)}>
          <div className="h-full bg-hud-accent transition-[width] duration-200" style={{ width: `${hud.progress * 100}%` }} />
        </div>
      )}

      {phase === 'intro' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="max-w-sm text-base text-hud-text">{def.howTo}</p>
          <p className="text-xs text-hud-muted">
            {def.domain} · about {def.seconds >= 60 ? `${Math.round(def.seconds / 60)} min` : `${def.seconds} s`}
          </p>
          <button type="button" className="hud-btn-primary mt-2 px-8 py-3 text-base" onClick={() => setPhase('count')} autoFocus>
            <Play className="h-4 w-4" aria-hidden="true" /> Start
          </button>
        </div>
      )}

      {phase === 'count' && (
        <div className="flex h-72 items-center justify-center">
          <span key={count} className="game-pop font-display text-8xl font-bold text-hud-accent">
            {count || 'GO'}
          </span>
        </div>
      )}

      {phase === 'play' && <Game seed={seed} durationSec={def.seconds} onProgress={onProgress} onDone={onFinish} />}
    </div>
  );
};
