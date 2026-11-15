/**
 * ARGUS — Cognition games tab (specs/02-ui-dashboard.md §2.8, specs/01-data-schema.md §12).
 * One NASA Cognition–based game per astronaut per day, shuffled; scores vs personal baseline;
 * crew leaderboard; deterministic decline alerts routed on board or to the Flight Surgeon.
 */
import React, { useMemo, useState } from 'react';
import { Brain, CalendarCheck, Flame, Medal, RotateCcw, Trophy, Volume2, VolumeX, Play } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { formatCommDelay } from '../data/spaceLocations';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';
import { InfoTip } from './InfoTip';
import { GAME_BY_ID } from '../features/cognition/catalog';
import { cycleDays, dateKeyOf, gameOfTheDay } from '../features/cognition/schedule';
import { dailyStreak, evaluateSession, leaderboard, personalBest } from '../features/cognition/scoring';
import { decideCare, earthPacketNote } from '../features/cognition/routing';
import { useCognitionStore } from '../features/cognition/store';
import { hashString } from '../features/cognition/rng';
import { isGameMuted, setGameMuted } from '../features/cognition/sfx';
import { GameShell } from '../features/cognition/GameShell';
import { CognitionAlert } from '../features/cognition/CognitionAlert';
import type { CareDecision, CognitionEvaluation, CognitionGameId, CognitionSession, GameResult } from '../features/cognition/types';

interface LastRun {
  session: CognitionSession;
  evaluation: CognitionEvaluation;
  decision: CareDecision;
  newBest: boolean;
}

const statusLabel = (e: CognitionEvaluation) =>
  e.status === 'calibrating' ? `Calibrating ${e.baselineN}/3` : null;

export const CognitionTab: React.FC = () => {
  const { activeCrewMember, crewRoster, zoneStatuses, queueEarthPacket, addCheckIn, latestDay, spaceLocation, setActiveTab } = useMission();
  const { byCrew, addSession } = useCognitionStore();
  const [playing, setPlaying] = useState<{ gameId: CognitionGameId; retest: boolean } | null>(null);
  const [last, setLast] = useState<LastRun | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [packet, setPacket] = useState<{ id: string; delay: string } | null>(null);
  const [muted, setMuted] = useState(isGameMuted());

  const todayKey = dateKeyOf(new Date());
  const crewId = activeCrewMember.id;
  const history = useMemo(() => byCrew[crewId] ?? [], [byCrew, crewId]);
  const todayGameId = gameOfTheDay(crewId, todayKey);
  const todayDef = GAME_BY_ID[todayGameId];
  const todaySession = history.find((s) => s.daily && s.dateKey === todayKey);
  const streak = dailyStreak(history, todayKey);
  const cycle = cycleDays(crewId, todayKey);
  const board = useMemo(() => leaderboard(byCrew, crewRoster.map((c) => c.id), todayKey), [byCrew, crewRoster, todayKey]);
  const recent = useMemo(
    () => [...history].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso)).slice(0, 6),
    [history]
  );
  const nameOf = (id: string) => crewRoster.find((c) => c.id === id)?.callsign ?? id;

  const finish = (gameId: CognitionGameId, retest: boolean, r: GameResult) => {
    const nowIso = new Date().toISOString();
    const session: CognitionSession = {
      ...r,
      id: `cog-${Date.now().toString(36)}-${hashString(nowIso + crewId).toString(36).slice(0, 4)}`,
      crewId,
      gameId,
      dateKey: todayKey,
      timestampIso: nowIso,
      daily: !retest,
    };
    const prevBest = personalBest(history, gameId);
    const evaluation = evaluateSession(session, history);
    const recentStatuses = [...history]
      .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso))
      .slice(0, 2)
      .map((s) => evaluateSession(s, history).status);
    const routingInput = {
      gameId,
      evaluation,
      recentStatuses,
      neuroZone: zoneStatuses.neuro,
      behavioralZone: zoneStatuses.behavioral,
    };
    const decision = decideCare(routingInput);
    addSession(session);

    // PVT feeds the existing Bio-Twin vital (pvt_lapses uses the 500 ms lapse definition).
    if (gameId === 'pvt' && r.extra?.lapses500 !== undefined) {
      addCheckIn({
        id: `pvt-${session.id}`,
        crewId,
        missionDay: latestDay || 30,
        timestampIso: nowIso,
        values: { pvt_lapses: r.extra.lapses500 },
        note: 'Cognition game: Reflex (PVT-B)',
      });
    }

    setPacket(null);
    if (decision.notifyEarth) {
      const pkt = queueEarthPacket(earthPacketNote(routingInput, decision));
      setPacket({ id: pkt.packetId, delay: formatCommDelay(spaceLocation) });
    }
    setLast({ session, evaluation, decision, newBest: history.some((s) => s.gameId === gameId) && r.points > prevBest });
    setAlertOpen(decision.route !== 'none');
    setPlaying(null);
  };

  const seedFor = (gameId: CognitionGameId, retest: boolean) =>
    hashString(`${crewId}:${todayKey}:${gameId}:${retest ? Date.now() : 'daily'}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-hud-text">
          <Brain className="h-5 w-5 text-hud-accent" aria-hidden="true" /> Cognition Games
        </h2>
        <InfoTip label="About the cognition games">
          Each game is one test from NASA’s Cognition battery, flown on the ISS. You get one game a day, in shuffled order.
          Scores are compared with your own recent results, never with the crew. The leaderboard is for fun.
        </InfoTip>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-hud-line px-3 py-1 font-mono text-sm text-game-4" aria-label={`${streak} day streak`}>
          <Flame className="h-4 w-4" aria-hidden="true" /> {streak}
        </span>
        <button
          type="button"
          className="hud-btn h-8 w-8 p-0"
          onClick={() => {
            setGameMuted(!muted);
            setMuted(!muted);
          }}
          aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
          aria-pressed={muted}
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {playing ? (
        <GameShell
          def={GAME_BY_ID[playing.gameId]}
          seed={seedFor(playing.gameId, playing.retest)}
          isRetest={playing.retest}
          onFinish={(r) => finish(playing.gameId, playing.retest, r)}
          onCancel={() => setPlaying(null)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card
            title="Today’s game"
            icon={<CalendarCheck className="h-4 w-4" />}
            className="lg:col-span-2"
            actions={<span className="text-xs text-hud-muted">{activeCrewMember.callsign}</span>}
          >
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-hud-accent/50 bg-hud-accent/10">
                <Brain className="h-10 w-10 text-hud-accent" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-xs tracking-[0.2em] text-hud-muted">{todayDef.nasaTest.toUpperCase()}</p>
                <p className="font-display text-2xl font-bold text-hud-text">{todayDef.title}</p>
                <p className="text-sm text-hud-muted">{todayDef.domain}</p>
              </div>
              {todaySession ? (
                <div className="text-right">
                  <p className="font-mono text-3xl font-bold text-hud-accent">{todaySession.points}</p>
                  <p className="text-xs text-hud-muted">Done today · new game tomorrow</p>
                </div>
              ) : (
                <button type="button" className="hud-btn-primary px-6 py-3 text-base" onClick={() => setPlaying({ gameId: todayGameId, retest: false })}>
                  <Play className="h-4 w-4" aria-hidden="true" /> Play
                </button>
              )}
            </div>

            {/* 9-day rotation: each game once per cycle, shuffled. Upcoming games stay hidden. */}
            <div className="mt-4" aria-label={`Day ${cycle.position + 1} of ${cycle.days.length} in the game rotation`}>
              <p className="mb-1.5 text-xs text-hud-muted">
                Rotation · day {cycle.position + 1} of {cycle.days.length}: every game once, a new shuffle every {cycle.days.length} days
              </p>
              <ol className="grid grid-cols-9 gap-1">
                {cycle.days.map((d, k) => {
                  const played = history.some((s) => s.daily && s.dateKey === d.dateKey);
                  const title = GAME_BY_ID[d.gameId].title;
                  const label =
                    d.when === 'upcoming' ? `Day ${k + 1}: upcoming` : `Day ${k + 1}: ${title}${d.when === 'past' ? (played ? ', played' : ', missed') : played ? ', played today' : ', today'}`;
                  return (
                    <li
                      key={d.dateKey}
                      title={label}
                      aria-label={label}
                      className={`flex h-12 flex-col items-center justify-center rounded-lg border px-0.5 text-center ${
                        d.when === 'today'
                          ? 'border-hud-accent bg-hud-accent/15 text-hud-text'
                          : d.when === 'past'
                            ? played
                              ? 'border-status-green/50 bg-status-green/10 text-hud-text'
                              : 'border-hud-line bg-hud-bg/40 text-hud-muted'
                            : 'border-dashed border-hud-line text-hud-muted'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-hud-muted">{k + 1}</span>
                      <span className="w-full truncate text-[10px] leading-tight">
                        {d.when === 'upcoming' ? '?' : d.when === 'past' ? (played ? `✓ ${title}` : '–') : title}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {last && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-hud-line bg-hud-bg/60 p-3">
                <span className="game-pop font-mono text-xl font-bold text-hud-text">+{last.session.points}</span>
                {last.newBest && (
                  <span className="game-pop flex items-center gap-1 rounded-full bg-game-6/20 px-2 py-0.5 text-xs font-semibold text-game-6">
                    <Medal className="h-3.5 w-3.5" aria-hidden="true" /> Personal best
                  </span>
                )}
                {last.evaluation.status === 'calibrating' ? (
                  <span className="text-xs text-hud-muted">{statusLabel(last.evaluation)}: 3 games of this type set your baseline</span>
                ) : (
                  <StatusPill status={last.evaluation.status} />
                )}
                <span className="text-xs text-hud-muted">
                  {GAME_BY_ID[last.session.gameId].primaryMetricLabel}: {last.session.metric} {GAME_BY_ID[last.session.gameId].primaryMetricUnit}
                </span>
                {last.decision.route !== 'none' && (
                  <button type="button" className="hud-btn ml-auto" onClick={() => setAlertOpen(true)}>
                    View alert
                  </button>
                )}
              </div>
            )}
          </Card>

          <Card title="Crew leaderboard · 7 days" icon={<Trophy className="h-4 w-4" />}>
            {board.every((r) => r.games === 0) ? (
              <p className="text-sm text-hud-muted">No games yet this week.</p>
            ) : (
              <ol className="space-y-1.5">
                {board.map((r, k) => (
                  <li
                    key={r.crewId}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${r.crewId === crewId ? 'bg-hud-accent/10 text-hud-accent' : 'text-hud-text'}`}
                  >
                    <span className="w-5 font-mono text-hud-muted">{k + 1}</span>
                    <span className="flex-1 truncate">{nameOf(r.crewId)}</span>
                    <span className="flex items-center gap-0.5 font-mono text-xs text-game-4" aria-label={`${r.streak} day streak`}>
                      <Flame className="h-3 w-3" aria-hidden="true" />
                      {r.streak}
                    </span>
                    <span className="w-14 text-right font-mono">{r.points}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Your recent games" className="lg:col-span-3">
            {recent.length === 0 ? (
              <p className="text-sm text-hud-muted">Play today’s game to start your baseline.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-hud-muted">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Day</th>
                      <th className="py-1 pr-3 font-normal">Game</th>
                      <th className="py-1 pr-3 font-normal">Points</th>
                      <th className="py-1 pr-3 font-normal">Result</th>
                      <th className="py-1 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((s) => {
                      const def = GAME_BY_ID[s.gameId];
                      const ev = evaluateSession(s, history);
                      return (
                        <tr key={s.id} className="border-t border-hud-line">
                          <td className="py-1.5 pr-3 font-mono text-xs text-hud-muted">{s.dateKey}</td>
                          <td className="py-1.5 pr-3">
                            {def.title}
                            {!s.daily && <span className="ml-1 text-xs text-hud-muted">(retest)</span>}
                          </td>
                          <td className="py-1.5 pr-3 font-mono">{s.points}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">
                            {s.metric} {def.primaryMetricUnit}
                          </td>
                          <td className="py-1.5">
                            {ev.status === 'calibrating' ? <span className="text-xs text-hud-muted">{statusLabel(ev)}</span> : <StatusPill status={ev.status} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {alertOpen && last && last.decision.route !== 'none' && (
        <CognitionAlert
          decision={last.decision}
          gameTitle={GAME_BY_ID[last.session.gameId].title}
          earthPacket={packet}
          onRetest={() => {
            setAlertOpen(false);
            setPlaying({ gameId: last.session.gameId, retest: true });
          }}
          onOpenEmergency={() => {
            setAlertOpen(false);
            setActiveTab('emergency');
          }}
          onClose={() => setAlertOpen(false)}
        />
      )}
      {!playing && last?.decision.route !== 'none' && last && !alertOpen && (
        <button type="button" className="hud-btn" onClick={() => setPlaying({ gameId: last.session.gameId, retest: true })}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retest {GAME_BY_ID[last.session.gameId].title}
        </button>
      )}
    </div>
  );
};
