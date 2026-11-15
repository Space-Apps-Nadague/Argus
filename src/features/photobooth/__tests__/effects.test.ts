import { describe, expect, it } from 'vitest';
import { captionLines, coverFit, placeName, STAGE_H, STAGE_W, stampLines } from '../effects';

describe('photobooth effects', () => {
  it('names the place for captions', () => {
    expect(placeName('mars_surface')).toBe('Mars');
    expect(placeName('lunar_surface')).toBe('the Moon');
    expect(placeName('earth_post')).toBe('Earth');
    expect(captionLines({ place: 'the Moon', callsign: 'VEGA', missionDay: 12, dateLine: '15 Nov 2026', message: ' love you ', stamp: [] })).toEqual({
      title: 'Greetings from The Moon!',
      meta: 'VEGA · Mission day 12 · 15 Nov 2026',
      message: 'love you',
    });
  });

  it('fits the camera to the stage', () => {
    const fit = coverFit(640, 480);
    expect(fit.s).toBeCloseTo(STAGE_W / 640, 5);
    expect(fit.ox).toBeCloseTo(0, 5);
    expect(STAGE_W / STAGE_H).toBeCloseTo(640 / 480, 5);
  });

  it('writes the mission-camera data stamp', () => {
    expect(
      stampLines({ now: new Date(Date.UTC(2026, 10, 15, 8, 41, 7)), callsign: 'Vega', missionDay: 214, sol: 1043, location: 'Mars surface', lightTime: '10m 58s' })
    ).toEqual(['ARGUS CAM · VEGA', '2026-11-15 08:41:07 UTC', 'MISSION DAY 214 · SOL 1043', 'MARS SURFACE · LIGHT TIME TO EARTH 10M 58S']);
    expect(stampLines({ now: new Date(0), callsign: 'x', missionDay: 1, location: 'Earth', lightTime: '0.000 s' })[2]).toBe('MISSION DAY 1');
  });
});
