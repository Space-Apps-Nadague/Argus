/**
 * Pressure Run — Balloon Analog Risk: pump a tank to earn credits; bank before it bursts.
 * Source: SRC-089 (BART: risk decision making). Outcome: adjusted pumps (mean pumps on tanks that did not burst).
 * Burst point uniform in 1–32 pumps is an ARGUS assumption for a short daily game (spec §12.1).
 */
import React, { useRef, useState } from 'react';
import { mulberry32, randInt } from '../rng';
import { sfx } from '../sfx';
import { GameProps, clamp } from './common';

const TANKS = 15;
const MAX_PUMPS = 32;
const CREDIT_PER_PUMP = 5;

export const Bart: React.FC<GameProps> = ({ seed, onProgress, onDone }) => {
  const bursts = useRef(Array.from({ length: TANKS }, (_, k) => randInt(mulberry32(seed + k * 7919), 1, MAX_PUMPS))).current;
  const [tank, setTank] = useState(0);
  const [pumps, setPumps] = useState(0);
  const [bank, setBank] = useState(0);
  const [popped, setPopped] = useState(false);
  const banked = useRef<number[]>([]);
  const explosions = useRef(0);

  const next = (newBank: number) => {
    const n = tank + 1;
    onProgress({ points: clamp(Math.round(newBank / 2), 0, 1000), progress: n / TANKS });
    if (n >= TANKS) {
      const adj = banked.current.length ? banked.current.reduce((a, b) => a + b, 0) / banked.current.length : 0;
      onDone({
        points: clamp(Math.round(newBank / 2), 0, 1000),
        metric: Number(adj.toFixed(2)),
        extra: { explosions: explosions.current, credits: newBank },
      });
      return;
    }
    setTank(n);
    setPumps(0);
    setPopped(false);
  };

  const pump = () => {
    if (popped) return;
    const p = pumps + 1;
    if (p >= bursts[tank]) {
      explosions.current++;
      sfx.burst();
      setPopped(true);
      setPumps(p);
      setTimeout(() => next(bank), 700);
      return;
    }
    sfx.tick();
    setPumps(p);
  };

  const collect = () => {
    if (popped || pumps === 0) return;
    const nb = bank + pumps * CREDIT_PER_PUMP;
    banked.current.push(pumps);
    sfx.bank();
    setBank(nb);
    next(nb);
  };

  const scale = 0.45 + (pumps / MAX_PUMPS) * 0.55;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-sm justify-between font-mono text-sm">
        <span className="text-hud-muted">Tank {tank + 1}/{TANKS}</span>
        <span className="text-hud-accent">Banked {bank} cr</span>
      </div>
      <div className="flex h-60 w-60 items-center justify-center">
        {popped ? (
          <span className="game-pop font-display text-3xl font-bold text-status-red">BURST</span>
        ) : (
          <div
            className="rounded-full border-4 border-hud-accent bg-hud-accent/20 transition-transform duration-100"
            style={{ width: 220, height: 220, transform: `scale(${scale})` }}
            aria-label={`Tank pressure ${pumps} pumps, worth ${pumps * CREDIT_PER_PUMP} credits`}
            role="img"
          />
        )}
      </div>
      <p className="font-mono text-lg text-hud-text">+{pumps * CREDIT_PER_PUMP} cr at risk</p>
      <div className="flex gap-3">
        <button type="button" className="hud-btn-primary w-32 py-3" onClick={pump} disabled={popped}>Pump</button>
        <button type="button" className="hud-btn w-32 py-3 text-sm" onClick={collect} disabled={popped || pumps === 0}>Bank</button>
      </div>
    </div>
  );
};
