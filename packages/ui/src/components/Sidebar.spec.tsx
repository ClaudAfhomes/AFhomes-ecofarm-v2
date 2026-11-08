import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Sidebar } from './Sidebar';
import styles from './Sidebar.module.css';

describe('Sidebar dropdown', () => {
  it('applies the open class when a category is expanded', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar
          items={[
            {
              to: '/ops',
              label: 'Operations',
              dropdown: [{ to: '/admin/sales', label: 'Sales' }],
            },
          ]}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Operations' }));

    const wrapper = document.querySelector('div[aria-hidden="false"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain(styles.subListWrapOpen);
  });

  it('removes the open class when a category is collapsed', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar
          items={[
            {
              to: '/ops',
              label: 'Operations',
              dropdown: [{ to: '/admin/sales', label: 'Sales' }],
            },
          ]}
        />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: 'Operations' });
    await user.click(button);
    await user.click(button);

    const wrapper = document.querySelector(`.${styles.subListWrap}`);
    expect(wrapper?.className).not.toContain(styles.subListWrapOpen);
  });
});

it('keeps collapsed module icons keyboard accessible and requests expansion', async () => {
  const onExpand = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Sidebar
        collapsed
        onExpand={onExpand}
        items={[
          {
            to: '/ops',
            label: 'Operations',
            icon: 'user',
            dropdown: [{ to: '/admin/sales', label: 'Sales' }],
          },
        ]}
      />
    </MemoryRouter>,
  );
  const icon = screen.getByRole('button', { name: 'Operations' });
  expect(icon).not.toHaveAttribute('aria-disabled', 'true');
  expect(icon).not.toHaveAttribute('tabindex', '-1');
  await user.click(icon);
  expect(onExpand).toHaveBeenCalledOnce();
});
