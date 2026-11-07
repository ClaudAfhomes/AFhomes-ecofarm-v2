import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

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
