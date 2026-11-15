import { describe, expect, it } from 'vitest';
import { captionLines, coverFit, faceToStage, placeName, STAGE_H, STAGE_W } from '../effects';

describe('photobooth effects', () => {
  it('names the place for captions', () => {
    expect(placeName('mars_surface')).toBe('Mars');
    expect(placeName('lunar_surface')).toBe('the Moon');
    expect(placeName('earth_post')).toBe('Earth');
    expect(captionLines({ place: 'the Moon', callsign: 'VEGA', missionDay: 12, dateLine: '15 Nov 2026', message: ' love you ' })).toEqual({
      title: 'Greetings from The Moon!',
      meta: 'VEGA · Mission day 12 · 15 Nov 2026',
      message: 'love you',
    });
  });

  it('fits the camera to the stage and mirrors the face box like a selfie', () => {
    const fit = coverFit(640, 480);
    expect(fit.s).toBeCloseTo(STAGE_W / 640, 5);
    expect(fit.ox).toBeCloseTo(0, 5);
    // A face on the left of the camera image appears on the right of the mirrored preview.
    const f = faceToStage({ x: 0, y: 0, width: 100, height: 100 }, 640, 480);
    expect(f.x).toBeCloseTo(STAGE_W - 150, 5);
    expect(f.width).toBeCloseTo(150, 5);
    expect(STAGE_W / STAGE_H).toBeCloseTo(640 / 480, 5);
  });
});
