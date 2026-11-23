import { expect, it, vi } from 'vitest';
import { fireEvent, renderWithProviders, screen } from '../../../test/utils';
import bundledLogo from '../../assets/logo.png';
import { Logo } from './Logo';

const cms = vi.hoisted(() => ({ src: 'https://unavailable.example.invalid/logo.png' }));
vi.mock('../../lib/cms', () => ({
  cmsRepository: { getSiteConfig: () => ({ logo: { src: cms.src, alt: 'AFhomes' } }) },
}));
vi.mock('../../hooks/useCmsRevision', () => ({ useCmsRevision: () => undefined }));

it('keeps the logo visible when a published URL fails and accepts a later CMS replacement', () => {
  const view = renderWithProviders(<Logo />);
  const image = screen.getByRole('img', { name: 'AFhomes' });
  expect(image).toHaveAttribute('src', cms.src);
  fireEvent.error(image);
  expect(image).toHaveAttribute('src', bundledLogo);

  cms.src = 'https://replacement.example.invalid/logo.png';
  view.rerender(<Logo />);
  expect(image).toHaveAttribute('src', cms.src);
});
