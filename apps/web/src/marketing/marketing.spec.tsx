import { screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/utils';
import App from '../app/App';

beforeEach(() => {
  // motion's whileInView needs IntersectionObserver; jsdom has none.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = vi.fn() as never;
  localStorage.clear();
});

const chrome = async () => {
  // Lazy marketing chunks pay transform cost on first load in tests.
  const main = await screen.findByRole('main', undefined, { timeout: 20000 });
  return { main };
};

describe('public route coverage', () => {
  it.each([
    ['/', 'Hospitality · Wellness · Dining · Nature — Laguna, Philippines'],
    ['/about', 'Hospitality, touched by home.'],
    ['/experiences', 'Dine. Stay. Escape.'],
    ['/vip', 'Your passport to the AFhomes experience.'],
    ['/stories', 'Notes from the AFhomes world.'],
    ['/faq', 'Questions, answered.'],
    ['/compliance', 'Transparent by design.'],
    ['/contact', "Let's connect."],
  ])('renders %s with marketing chrome', async (route, marker) => {
    renderWithProviders(<App />, { route });
    const { main } = await chrome();
    expect(within(main).getByText(marker, { exact: false })).toBeInTheDocument();
    // Marketing shell: brand nav + footer, never the portal shell.
    expect(screen.getByRole('link', { name: 'AFhomes — Home Away From Home' })).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).toBeInTheDocument();
  });

  it.each([
    ['/experiences/smart-wellness-hotel', "Sleep isn't just rest. It's recovery."],
    ['/experiences/hotspring-ecofarm-resort', '60 hectares of nature'],
  ])('renders the hardcoded experience deep-dive %s', async (route, marker) => {
    renderWithProviders(<App />, { route });
    const { main } = await chrome();
    // The headline appears in both the hero and the body section.
    expect(within(main).getAllByText(marker, { exact: false })[0]).toBeInTheDocument();
  });

  it('renders the ALM deep-dive', async () => {
    renderWithProviders(<App />, { route: '/experiences/alm-japanese-restaurant' });
    const { main } = await chrome();
    expect(
      within(main).getAllByText('The art of Japanese dining.', { exact: false })[0],
    ).toBeInTheDocument();
  });

  it('renders the generic experience renderer for a known slug', async () => {
    renderWithProviders(<App />, { route: '/experiences/alm-japanese-restaurant' });
    const { main } = await chrome();
    expect(
      within(main).getAllByText('The art of Japanese dining.', { exact: false })[0],
    ).toBeInTheDocument();
  });

  it('renders a story detail with related stories', async () => {
    renderWithProviders(<App />, { route: '/stories/a-gentler-way-to-rest' });
    const { main } = await chrome();
    // The article body loads asynchronously from the static content.
    expect(
      await within(main).findByRole(
        'heading',
        { name: (name) => name.toLowerCase().includes('gentler way to rest') },
        { timeout: 20000 },
      ),
    ).toBeInTheDocument();
  });

  it('renders the marketing 404 for an unknown path', async () => {
    // The 404 page carries no <main> landmark by design; assert directly.
    renderWithProviders(<App />, { route: '/no-such-page' });
    expect(
      await screen.findByRole(
        'heading',
        { name: 'This page is taking a rest day.' },
        { timeout: 20000 },
      ),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(document.title).toContain('Page not found'), {
      timeout: 20000,
    });
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow',
    );
  });

  it('serves the local-dev staff entry on /admin/login, not the marketing 404', async () => {
    renderWithProviders(<App />, { route: '/admin/login' });
    expect(await screen.findByText('Administration Login')).toBeInTheDocument();
    expect(screen.queryByText('This page is taking a rest day.')).not.toBeInTheDocument();
  });
});

describe('header and navigation', () => {
  it('shows the brand, the section links, and the footer notice', async () => {
    renderWithProviders(<App />, { route: '/' });
    await chrome();
    for (const label of [
      'Experiences',
      'VIP Privilege',
      'About',
      'Stories & Insights',
      'FAQ',
      'Contact',
    ]) {
      expect(screen.getAllByRole('link', { name: label })[0]).toBeInTheDocument();
    }
    // No standalone "Home" link: the brand mark links home.
    expect(screen.getByRole('link', { name: 'AFhomes — Home Away From Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByText('Important Notice')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('serves the bundled brand logo, not a remote URL', async () => {
    renderWithProviders(<App />, { route: '/' });
    await chrome();
    const logo = screen.getByRole('img', { name: 'AFhomes' });
    expect(logo.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('opens the mobile menu dialog with the section links', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/' });
    await chrome();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Contact' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // The menu plays its exit transition first.
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'), { timeout: 20000 });
  });

  it('exposes a single member Login entry that routes to /customer/login', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/' });
    await chrome();
    // jsdom matchMedia never matches desktop, so the entry lives in the menu.
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    const login = within(dialog).getByRole('link', { name: 'Login' });
    expect(login).toHaveAttribute('href', '/customer/login');
    // Staff/admin entries stay URL-only: never advertised in the public nav.
    expect(within(dialog).queryByRole('link', { name: /staff/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
    await user.click(login);
    expect(await screen.findByLabelText(/Email/)).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).not.toBeInTheDocument();
  });
});

describe('homepage critical sections', () => {
  it('renders hero, pillars, journey, VIP teaser, and footer CTA', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    const scope = within(main);
    expect(
      scope.getByText('Hospitality · Wellness · Dining · Nature — Laguna, Philippines'),
    ).toBeInTheDocument();
    expect(scope.getByText('A pioneer in homestyle hospitality')).toBeInTheDocument();
    expect(scope.getByText('A destination, arriving in chapters.')).toBeInTheDocument();
    // All three VIP tiers load asynchronously from the static content.
    const tierLabels = await scope.findAllByText('VIP tier', undefined, { timeout: 20000 });
    expect(tierLabels).toHaveLength(3);
    // The footer sits outside <main> by design; assert globally.
    expect(screen.getByText('Important Notice')).toBeInTheDocument();
  });

  it('lists the three experiences with their actions', async () => {
    renderWithProviders(<App />, { route: '/experiences' });
    const { main } = await chrome();
    const scope = within(main);
    expect(scope.getByRole('link', { name: /Discover the Hotel/ })).toHaveAttribute(
      'href',
      '/experiences/smart-wellness-hotel',
    );
    expect(scope.getByRole('link', { name: /Discover ALM/ })).toHaveAttribute(
      'href',
      '/experiences/alm-japanese-restaurant',
    );
    expect(scope.getByRole('link', { name: /Discover the Resort/ })).toHaveAttribute(
      'href',
      '/experiences/hotspring-ecofarm-resort',
    );
  });
});

describe('contact and inquiry form', () => {
  it('renders the office cards and the inquiry form', async () => {
    renderWithProviders(<App />, { route: '/contact' });
    const { main } = await chrome();
    const scope = within(main);
    expect(
      scope.getByRole('link', { name: /claudmarsjimenez.afhomes@gmail.com/i }),
    ).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(scope.getByLabelText(/Name/)).toBeInTheDocument();
    expect(scope.getByLabelText(/Message/)).toBeInTheDocument();
    expect(scope.getByRole('button', { name: /Send message/ })).toBeInTheDocument();
  });

  it('refuses an empty submit with inline validation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/contact' });
    await chrome();
    await user.click(screen.getByRole('button', { name: /Send message/ }));
    expect(await screen.findByText('Please enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Please choose an inquiry type.')).toBeInTheDocument();
  });

  it('saves a valid inquiry to the browser outbox and opens the mail app', async () => {
    const user = userEvent.setup();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    try {
      renderWithProviders(<App />, { route: '/contact' });
      await chrome();
      await user.type(screen.getByLabelText(/Name/), 'Juan Dela Cruz');
      await user.type(screen.getByLabelText(/Email/), 'juan@example.com');
      await user.type(screen.getByLabelText(/Contact Number/), '+639171234567');
      await user.selectOptions(screen.getByLabelText(/Inquiry Type/), 'General Inquiry');
      await user.type(screen.getByLabelText(/Message/), 'We would like to visit the resort soon.');
      await user.click(screen.getByRole('button', { name: /Send message/ }));

      expect(await screen.findByText('Request saved locally.')).toBeInTheDocument();
      expect((window.location as unknown as { href: string }).href).toMatch(
        /^mailto:claudmarsjimenez\.afhomes@gmail\.com\?/,
      );
      const outbox = JSON.parse(localStorage.getItem('afhomes.inquiries.v1') ?? '[]') as {
        name: string;
      }[];
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.name).toBe('Juan Dela Cruz');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});

describe('stories, FAQ, and VIP pages', () => {
  it('filters stories by category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/stories' });
    const { main } = await chrome();
    const scope = within(main);
    expect(
      await scope.findByText('A gentler way to rest', undefined, { timeout: 20000 }),
    ).toBeInTheDocument();
    // The featured story stays visible outside the filtered grid by design.
    await user.click(scope.getByRole('button', { name: 'Eco-Friendly Living' }));
    expect(
      await scope.findByText('Learning from the land', undefined, { timeout: 20000 }),
    ).toBeInTheDocument();
    expect(scope.queryByText('The live fire of ALM')).not.toBeInTheDocument();
    expect(scope.getByText('A gentler way to rest')).toBeInTheDocument();
  });

  it('switches FAQ categories and expands answers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/faq' });
    const { main } = await chrome();
    const scope = within(main);
    expect(
      await scope.findByText('Who is the AFhomes Group?', undefined, { timeout: 20000 }),
    ).toBeInTheDocument();
    await user.click(scope.getByRole('tab', { name: /VIP Privilege/ }));
    expect(
      await scope.findByText('What is the purpose of the VIP Privilege Program?', undefined, {
        timeout: 20000,
      }),
    ).toBeInTheDocument();
  });

  it('lists the VIP tiers from static content', async () => {
    renderWithProviders(<App />, { route: '/vip' });
    const { main } = await chrome();
    const scope = within(main);
    for (const tier of ['Gold', 'Silver', 'Bronze']) {
      expect(await scope.findByText(tier, { exact: true }, { timeout: 20000 })).toBeInTheDocument();
    }
  });
});

describe('SEO behavior', () => {
  it('applies the title template, canonical, and JSON-LD per route', async () => {
    renderWithProviders(<App />, { route: '/about' });
    await chrome();
    await vi.waitFor(
      () => {
        // The About page sets its own Seo title through the title template.
        expect(document.title).toBe('About AFhomes — AFhomes');
      },
      { timeout: 20000 },
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://www.afhomes.com.ph/about',
    );
    const schema = document.querySelector('#afhomes-local-business-schema');
    expect(schema?.textContent).toContain('"@type":"Resort"');
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute(
      'content',
      'https://www.afhomes.com.ph/about',
    );
  });
});

describe('route precedence', () => {
  it('keeps the customer login inside the portal shell, not marketing chrome', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    expect(await screen.findByLabelText(/Email/)).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).not.toBeInTheDocument();
  });

  it('keeps unknown portal paths on the portal not-found screen', async () => {
    renderWithProviders(<App />, { route: '/customer/nope' });
    // The guard bounces to the sign-in screen, which carries its own heading
    // alongside the hero - assert the sign-in specifically.
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your card', level: 2 }),
    ).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).not.toBeInTheDocument();
    expect(screen.queryByText('This page is taking a rest day.')).not.toBeInTheDocument();
  });
});
