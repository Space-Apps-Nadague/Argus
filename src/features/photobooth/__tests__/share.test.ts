import { describe, expect, it, vi } from 'vitest';
import { dataUrlToFile, mailtoLink, sharePhoto, type ShareEnv } from '../share';

const IMG = 'data:image/jpeg;base64,' + btoa('jpeg-bytes');
const photo = { image: IMG, fileName: 'argus.jpg', subject: 'A photo from VEGA on Mars', text: 'Miss you & love you', emails: ['mom@example.com', 'dad@example.com'] };

const env = (over: Partial<ShareEnv> = {}): ShareEnv => ({ download: vi.fn(), openUrl: vi.fn(), ...over });

describe('photobooth share', () => {
  it('turns the photo into a JPEG file', async () => {
    const f = dataUrlToFile(IMG, 'x.jpg');
    expect(f.name).toBe('x.jpg');
    expect(f.type).toBe('image/jpeg');
    expect(await f.text()).toBe('jpeg-bytes');
  });

  it('builds a mailto link with encoded fields', () => {
    expect(mailtoLink(['a@b.c', ' d@e.f '], 'Hi & bye', 'Line 1\nLine 2')).toBe('mailto:a%40b.c,d%40e.f?subject=Hi%20%26%20bye&body=Line%201%0ALine%202');
  });

  it('uses the share menu with the photo when the browser can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const e = env({ canShare: () => true, share });
    expect(await sharePhoto(photo, e)).toBe('shared');
    expect(share.mock.calls[0][0].files[0].name).toBe('argus.jpg');
    expect(e.openUrl).not.toHaveBeenCalled();
  });

  it('treats closing the share menu as cancelled', async () => {
    const e = env({ canShare: () => true, share: () => Promise.reject(new DOMException('x', 'AbortError')) });
    expect(await sharePhoto(photo, e)).toBe('cancelled');
    expect(e.download).not.toHaveBeenCalled();
  });

  it('falls back to downloading the photo and opening the mail app', async () => {
    const e = env({ canShare: () => false, share: vi.fn() });
    expect(await sharePhoto(photo, e)).toBe('mail_app');
    expect(e.download).toHaveBeenCalledWith(IMG, 'argus.jpg');
    expect(String((e.openUrl as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/^mailto:mom%40example\.com,dad%40example\.com\?subject=/);
  });
});
