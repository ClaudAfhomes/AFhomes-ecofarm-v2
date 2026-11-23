import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_THEME } from '@afhomes/contracts';
import { siteConfig } from '../data/mock/site';
import { cmsRepository } from './cms';
import { startCmsPreview } from './cms-preview';

const ADMIN = 'http://admin.example.test';
const SESSION = 'session-1';
const draft = { ...siteConfig, theme: { ...DEFAULT_SITE_THEME, primary: '#336699' } };
const theme = () => (cmsRepository.getSiteConfig() as { theme?: { primary: string } }).theme;

function send(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

const content = (session = SESSION) => ({
  type: 'afhomes-cms-preview-content',
  session,
  document: { key: 'site', draftValue: draft },
});

describe('public-site draft preview bridge', () => {
  let stop = () => {};
  afterEach(() => stop());

  it('announces readiness only to the admin origin', () => {
    const parent = { postMessage: vi.fn() };
    stop = startCmsPreview([ADMIN], SESSION, parent as never);
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: 'afhomes-cms-preview-ready', session: SESSION },
      ADMIN,
    );
  });

  it('ignores content from another origin, source or session', () => {
    const parent = { postMessage: vi.fn() };
    stop = startCmsPreview([ADMIN], SESSION, parent as never);
    send(content(), 'http://evil.example.test', parent);
    send(content(), ADMIN, {});
    send(content('other'), ADMIN, parent);
    expect(theme()).toBeUndefined();
  });

  it('applies the saved draft from the admin preview and notifies the page', () => {
    const parent = { postMessage: vi.fn() };
    const updated = vi.fn();
    window.addEventListener('afhomes-cms-updated', updated);
    stop = startCmsPreview([ADMIN], SESSION, parent as never);
    send(content(), ADMIN, parent);
    window.removeEventListener('afhomes-cms-updated', updated);
    expect(theme()?.primary).toBe('#336699');
    expect(updated).toHaveBeenCalled();
  });
});
