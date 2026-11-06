import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrollToTop } from './ScrollToTop';

let go: (to: string) => void = () => {};

function Nav() {
  go = useNavigate();
  return null;
}

describe('ScrollToTop', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    window.scrollTo = scrollTo as never;
    scrollTo.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('scrolls to top on path change but not on search-only change', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <ScrollToTop />
        <Nav />
      </MemoryRouter>,
    );
    scrollTo.mockClear();

    act(() => go('/a?page=2'));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => go('/b'));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('scrolls to a hash target instead of the top', () => {
    const target = document.createElement('div');
    target.id = 'section';
    target.scrollIntoView = vi.fn();
    document.body.append(target);

    render(
      <MemoryRouter initialEntries={['/a#section']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    target.remove();
  });
});
