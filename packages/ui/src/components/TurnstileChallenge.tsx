import { useEffect, useRef, useState } from 'react';
type Turnstile = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let loading: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = undefined;
        reject(new Error('Security check could not load.'));
      };
      document.head.appendChild(script);
    });
  return loading;
}
/** Supabase Auth verifies this token server-side with its configured secret. */
export function TurnstileChallenge({
  siteKey,
  onToken,
  resetVersion = 0,
}: {
  siteKey?: string;
  onToken: (token: string | null) => void;
  resetVersion?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!siteKey) return;
    let live = true;
    let widget: string | undefined;
    void load()
      .then(() => {
        if (!live || !root.current || !window.turnstile) return;
        widget = window.turnstile.render(root.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null);
            setError('Security check failed. Reload to retry.');
          },
        });
      })
      .catch(() => {
        if (live) setError('Security check could not load. Reload to retry.');
      });
    return () => {
      live = false;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, onToken, resetVersion]);
  if (!siteKey) return null;
  return (
    <div>
      <div ref={root} aria-label="Security verification" />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
