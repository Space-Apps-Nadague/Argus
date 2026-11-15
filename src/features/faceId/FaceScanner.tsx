/**
 * ARGUS — Face ID scanner (specs/02-ui-dashboard.md §6 "Face ID")
 *
 * Round camera view with an iPhone-style ring of ticks that fill as the scan progresses.
 *  - enroll: captures 5 clear frames and averages them into one face template.
 *  - verify: needs the same face in 2 frames, then a blink or a small head turn (liveness), within 20 s.
 *    The liveness step reads landmarks only, so it is fast enough to catch a quick blink.
 * Camera frames never leave the browser.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ScanFace, X } from 'lucide-react';
import { loadFaceEngine, readFace, readLiveness } from './faceEngine';
import { averageDescriptors, detectBlink, detectHeadTurn, FaceEnrollment, matchFace } from './faceStore';

const TICKS = 60;
const ENROLL_FRAMES = 5;
const VERIFY_TIMEOUT_MS = 25_000;

type Phase = 'camera' | 'models' | 'scanning' | 'success' | 'error';

type Props =
  | { mode: 'enroll'; onEnrolled: (descriptor: number[]) => Promise<void> | void; onCancel: () => void }
  | { mode: 'verify'; enrollments: FaceEnrollment[]; onMatch: (e: FaceEnrollment) => Promise<void> | void; onCancel: () => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const FaceScanner: React.FC<Props> = (props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Starting camera…');
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access. Use your password.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      } catch {
        throw new Error('Camera permission was denied. Allow the camera or use your password.');
      }
      if (cancelled) return;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      setPhase('models');
      setMessage('Loading face recognition…');
      const faceapi = await loadFaceEngine();
      if (cancelled) return;

      setPhase('scanning');
      const p = propsRef.current;
      if (p.mode === 'enroll') {
        setMessage('Look at the camera and move your head slowly in a circle');
        const captures: Float32Array[] = [];
        let last = 0;
        while (!cancelled && captures.length < ENROLL_FRAMES) {
          const f = await readFace(faceapi, video);
          if (f && f.score > 0.7 && f.box.width > 0.2 && Date.now() - last > 250) {
            captures.push(f.descriptor);
            last = Date.now();
            setProgress(captures.length / ENROLL_FRAMES);
          } else if (!f) {
            setMessage('Move your face into the circle');
          } else if (f.box.width <= 0.2) {
            setMessage('Move a little closer');
          } else {
            setMessage('Look at the camera and move your head slowly in a circle');
          }
          await sleep(60);
        }
        if (cancelled) return;
        await p.onEnrolled(averageDescriptors(captures));
        setPhase('success');
        setMessage('Face ID is set up');
        return;
      }

      setMessage('Look at the camera');
      const started = Date.now();
      const timeLeft = () => Date.now() - started < VERIFY_TIMEOUT_MS;

      // 1) Who is it? Same enrolled face in 2 frames.
      let matches = 0;
      let matched: FaceEnrollment | null = null;
      while (!cancelled && timeLeft() && matches < 2) {
        const f = await readFace(faceapi, video);
        if (f) {
          const m = matchFace(f.descriptor, p.enrollments);
          if (m && (!matched || matched.userId === m.enrollment.userId)) {
            matched = m.enrollment;
            matches += 1;
            setProgress(matches * 0.3);
          } else {
            setMessage('Face not recognised yet. Look straight at the camera');
          }
        } else {
          setMessage('Move your face into the circle');
        }
        await sleep(30);
      }
      if (cancelled) return;
      if (!matched || matches < 2) throw new Error('Face not recognised. Try again or use your password.');

      // 2) Is it a live person? A blink or a small head turn (fast landmark-only frames).
      setMessage('Face recognised. Now blink, or turn your head slightly');
      const ears: number[] = [];
      const yaws: number[] = [];
      while (!cancelled && timeLeft()) {
        const l = await readLiveness(faceapi, video);
        if (l) {
          ears.push(l.ear);
          yaws.push(l.yaw);
          if (ears.length > 90) {
            ears.shift();
            yaws.shift();
          }
          if (detectBlink(ears) || detectHeadTurn(yaws)) {
            setProgress(1);
            setPhase('success');
            setMessage(`Welcome, ${matched.username}`);
            await p.onMatch(matched);
            return;
          }
          setProgress(0.6 + Math.min(0.3, ears.length / 100));
        } else {
          setMessage('Keep your face in the circle, then blink or turn your head slightly');
        }
        await sleep(0);
      }
      if (!cancelled) throw new Error('No blink or head turn detected. Try again or use your password.');
    };

    run().catch((err: unknown) => {
      if (cancelled) return;
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Face ID failed. Use your password.');
    });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const lit = Math.round(progress * TICKS);
  const ringColor = phase === 'success' ? '#3ddc97' : phase === 'error' ? '#ff4d5e' : '#4dd0ff';

  return (
    <div className="flex flex-col items-center gap-4" aria-live="polite">
      <div className="relative h-64 w-64">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-6 h-52 w-52 rounded-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
          aria-label="Camera preview for Face ID"
        />
        <svg viewBox="0 0 256 256" className="absolute inset-0 h-64 w-64" aria-hidden="true">
          {Array.from({ length: TICKS }, (_, i) => {
            const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
            const on = i < lit || phase === 'success';
            return (
              <line
                key={i}
                x1={128 + Math.cos(a) * 112}
                y1={128 + Math.sin(a) * 112}
                x2={128 + Math.cos(a) * 124}
                y2={128 + Math.sin(a) * 124}
                stroke={on ? ringColor : '#2a3a4f'}
                strokeWidth={3}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        {phase === 'success' && (
          <CheckCircle2 className="absolute inset-0 m-auto h-20 w-20 text-status-green drop-shadow" aria-hidden="true" />
        )}
        {(phase === 'camera' || phase === 'models') && (
          <ScanFace className="absolute inset-0 m-auto h-14 w-14 animate-pulse text-hud-accent" aria-hidden="true" />
        )}
      </div>
      <p role={phase === 'error' ? 'alert' : undefined} className={`min-h-[2.5rem] text-center text-sm ${phase === 'error' ? 'text-status-red' : 'text-hud-text'}`}>
        {message}
      </p>
      <button type="button" onClick={props.onCancel} className="hud-btn w-full">
        <X className="h-4 w-4" aria-hidden="true" />
        {phase === 'success' ? 'Close' : phase === 'error' ? 'Back' : 'Cancel'}
      </button>
    </div>
  );
};
