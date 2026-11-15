/**
 * ARGUS — Face ID set-up button + dialog for the signed-in user (top bar).
 */

import React, { useState } from 'react';
import { ScanFace, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { FaceScanner } from './FaceScanner';

export const FaceIdSettings: React.FC = () => {
  const { hasFaceId, enrollFace, removeFaceId } = useAuth();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setScanning(false);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setScanning(!hasFaceId);
        }}
        className="hud-focus rounded-md p-1.5 text-hud-muted hover:bg-hud-bg hover:text-hud-text"
        aria-label={hasFaceId ? 'Face ID settings' : 'Set up Face ID'}
        title={hasFaceId ? 'Face ID is on' : 'Set up Face ID'}
      >
        <ScanFace className={`h-4 w-4 ${hasFaceId ? 'text-hud-accent' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="faceid-title">
          <div className="hud-card w-full max-w-sm space-y-4 p-6">
            <h2 id="faceid-title" className="font-display text-base font-bold tracking-[0.15em]">
              FACE ID
            </h2>
            {scanning ? (
              <FaceScanner
                mode="enroll"
                onEnrolled={async (descriptor) => {
                  try {
                    await enrollFace(descriptor);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not save Face ID.');
                    throw err;
                  }
                }}
                onCancel={close}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-hud-text">Face ID is on for this device. You can sign in by looking at the camera and blinking.</p>
                <div className="flex gap-2">
                  <button type="button" className="hud-btn flex-1" onClick={() => setScanning(true)}>
                    <ScanFace className="h-4 w-4" aria-hidden="true" />
                    Scan again
                  </button>
                  <button
                    type="button"
                    className="hud-btn flex-1"
                    onClick={async () => {
                      await removeFaceId();
                      close();
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Turn off
                  </button>
                </div>
                <button type="button" className="hud-btn w-full" onClick={close}>
                  Close
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-status-red">
                {error}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-hud-muted">
              Your face template stays on this device only. Sign-in also needs a blink, so a photo is not enough. Your password always works too.
            </p>
          </div>
        </div>
      )}
    </>
  );
};
