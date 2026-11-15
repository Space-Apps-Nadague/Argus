/**
 * ARGUS — Sending a Photobooth photo home without the ARGUS server (specs/02-ui-dashboard.md §2.7)
 * The device share menu (Web Share API) sends the real photo through Mail, WhatsApp, Messages…
 * Where a browser cannot share files, the photo is downloaded and the mail app opens with a
 * ready-written email to the family's addresses (the photo has to be attached by hand).
 */

export type ShareResult = 'shared' | 'mail_app' | 'cancelled';

/** data:image/jpeg;base64,… → File, synchronously (the share call must stay inside the click). */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

/** mailto: link with the addresses, subject and body encoded. */
export function mailtoLink(emails: string[], subject: string, body: string): string {
  const to = emails.map((e) => encodeURIComponent(e.trim())).join(',');
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface SharePhoto {
  image: string;
  fileName: string;
  subject: string;
  text: string;
  emails: string[];
}

export interface ShareEnv {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: (url: string, fileName: string) => void;
  openUrl: (url: string) => void;
}

const browserEnv = (): ShareEnv => ({
  canShare: typeof navigator !== 'undefined' && navigator.canShare ? (d) => navigator.canShare(d) : undefined,
  share: typeof navigator !== 'undefined' && navigator.share ? (d) => navigator.share(d) : undefined,
  download: (url, fileName) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  },
  openUrl: (url) => {
    window.location.href = url;
  },
});

/** Share sheet with the photo when the browser can share files; otherwise download + mail app. */
export async function sharePhoto(p: SharePhoto, env: ShareEnv = browserEnv()): Promise<ShareResult> {
  const file = dataUrlToFile(p.image, p.fileName);
  const data: ShareData = { files: [file], title: p.subject, text: p.text };
  if (env.share && env.canShare?.(data)) {
    try {
      await env.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Share failed for another reason: fall through to the email route.
    }
  }
  env.download(p.image, p.fileName);
  env.openUrl(mailtoLink(p.emails, p.subject, `${p.text}\n\n(The photo is attached.)`));
  return 'mail_app';
}
