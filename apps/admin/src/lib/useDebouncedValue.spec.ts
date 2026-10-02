/**
 * Debounced live search: keystrokes stay instant, fetches follow the pause.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello'));
    expect(result.current).toBe('hello');
  });

  it('holds the old value during the pause, then follows the latest keystroke', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'c' },
      });
      rerender({ value: 'cl' });
      rerender({ value: 'cla' });
      rerender({ value: 'clau' });
      // Still pausing: nothing fetched yet.
      expect(result.current).toBe('c');
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(result.current).toBe('c');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      // Latest query wins: intermediate keystrokes never surface.
      expect(result.current).toBe('clau');
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies once per settled term for pagination resets and applied filters', () => {
    vi.useFakeTimers();
    try {
      const settled: string[] = [];
      const { rerender } = renderHook(
        ({ value }) => useDebouncedValue(value, 300, (v) => settled.push(v)),
        { initialProps: { value: 'a' } },
      );
      rerender({ value: 'ab' });
      rerender({ value: 'abc' });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(settled).toEqual(['abc']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts the pause on every keystroke (rapid typing fetches once)', () => {
    vi.useFakeTimers();
    try {
      let commits = 0;
      const { rerender } = renderHook(
        ({ value }) => {
          const debounced = useDebouncedValue(value, 300);
          if (debounced === value) commits += 1;
          return debounced;
        },
        { initialProps: { value: 'a' } },
      );
      for (const value of ['ab', 'abc', 'abcd', 'abcde']) {
        rerender({ value });
        act(() => {
          vi.advanceTimersByTime(100);
        });
      }
      act(() => {
        vi.advanceTimersByTime(300);
      });
      // Initial render + one settled value, never one fetch per keystroke.
      expect(commits).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
