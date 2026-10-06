import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import type { Variants } from 'motion/react';
import { cn } from '../../lib/cn';
import { Logo } from '../../components/ui/Logo';
import { Button } from '../../components/ui/Button';
import { SmartImage } from '../../components/ui/SmartImage';
import { cmsRepository } from '../../lib/cms';
import type { ExperienceStatus } from '../../types/experience';
import { ArrowRight } from '../../components/ui/icons';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { EASE } from '../../lib/motion';

const statusDot: Record<ExperienceStatus, string> = {
  open: 'bg-leaf-500',
  'opening-soon': 'bg-gold-500',
  'in-development': 'bg-cyan-500',
};

/* Mobile menu — a calm, sequential reveal. Children catch up to the panel
   fade, so the open feels effortless and the close stays quick. */
const menuPanel: Variants = {
  open: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.32,
      ease: EASE,
      when: 'beforeChildren',
      staggerChildren: 0.05,
    },
  },
  closed: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.18, ease: 'easeOut' },
  },
};

const menuItem: Variants = {
  open: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
  closed: { opacity: 0, y: 10 },
};

export function Navbar() {
  const siteConfig = cmsRepository.getSiteConfig();
  const experiences = cmsRepository.getExperiences();
  const desktopLinks = siteConfig.nav.main.filter(
    (item) => item.path !== '/' && item.path !== '/experiences',
  );
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const megaWrapperRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  const experiencesActive = location.pathname.startsWith('/experiences');
  const hasDarkTop =
    location.pathname === '/' ||
    ['/about', '/vip', '/faq', '/compliance', '/contact', '/experiences', '/stories'].some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );
  const lightText = hasDarkTop && !scrolled && !menuOpen;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // Reset menu state on navigation. Intentionally synchronous: the closed
    // menu must never survive a route change (source behavior, Phase 3 port).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false);
    setMegaOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!menuOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setMegaOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        megaOpen &&
        megaWrapperRef.current &&
        !megaWrapperRef.current.contains(event.target as Node)
      ) {
        setMegaOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [megaOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    // Make page content unreachable for assistive tech and keyboard users
    // while the dialog is open.
    const content = document.getElementById('site-content');
    content?.setAttribute('inert', '');
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const panel = mobilePanelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables?.[0];
    first?.focus();

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !focusables?.length) return;
      const list = Array.from(focusables);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl?.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl?.focus();
      }
    };
    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      content?.removeAttribute('inert');
      previouslyFocused?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    // Close the mobile menu when the viewport grows past the breakpoint.
    // Intentional synchronous close (source behavior, Phase 3 port).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDesktop) setMenuOpen(false);
  }, [isDesktop]);

  const solid = scrolled || menuOpen;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
        <div
          className={cn(
            'mx-auto flex w-full max-w-[var(--container-site)] items-center justify-between gap-4 rounded-full py-2 pr-2 pl-4 transition-all duration-300 sm:pl-5',
            solid
              ? 'border border-line bg-cream-50/90 text-navy-900 shadow-lift backdrop-blur-xl'
              : 'border border-cream-50/25 bg-navy-950/30 text-cream-50 shadow-soft backdrop-blur-md',
          )}
        >
          <Logo />

          {/* Desktop nav */}
          <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
            <div
              ref={megaWrapperRef}
              className="relative"
              onMouseEnter={() => isDesktop && setMegaOpen(true)}
              onMouseLeave={() => isDesktop && setMegaOpen(false)}
            >
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={megaOpen}
                onClick={() => setMegaOpen((open) => !open)}
                onFocus={() => setMegaOpen(true)}
                className={cn(
                  'group flex min-h-10 items-center gap-1.5 text-sm font-semibold transition-colors',
                  lightText
                    ? 'text-cream-100 hover:text-leaf-300'
                    : experiencesActive
                      ? 'text-leaf-700'
                      : 'text-navy-900 hover:text-leaf-700',
                )}
              >
                Experiences
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className={cn(
                    'h-3 w-3 transition-transform duration-200',
                    megaOpen && 'rotate-180',
                  )}
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <AnimatePresence>
                {megaOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.99 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="absolute top-full left-0 pt-3"
                  >
                    <div className="w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-line bg-cream-50 p-3 shadow-lift">
                      <p className="label-caps px-3 pt-2 pb-3 text-ink-400">
                        The AFhomes Experience
                      </p>
                      <ul className="grid grid-cols-3 gap-2">
                        {experiences.map((experience) => (
                          <li key={experience.id}>
                            <NavLink
                              to={`/experiences/${experience.slug}`}
                              className="group block overflow-hidden rounded-xl"
                              onClick={() => setMegaOpen(false)}
                            >
                              <span className="relative block aspect-[4/5] overflow-hidden">
                                <SmartImage
                                  spec={experience.image}
                                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  sizes="240px"
                                />
                                <span className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-transparent to-transparent" />
                                <span className="absolute right-2 bottom-2 left-2 flex flex-col">
                                  <span className="flex items-center gap-1.5 text-[0.58rem] font-semibold tracking-[0.18em] text-cream-100 uppercase">
                                    <span
                                      className={cn(
                                        'h-1.5 w-1.5 rounded-full',
                                        statusDot[experience.status],
                                      )}
                                      aria-hidden="true"
                                    />
                                    {experience.statusLabel}
                                  </span>
                                  <span className="mt-1 font-display text-sm font-semibold text-cream-50">
                                    {experience.shortName}
                                  </span>
                                </span>
                              </span>
                              <span className="mt-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-navy-900">
                                View
                                <ArrowRight className="h-3 w-3 text-leaf-600 transition-transform duration-300 group-hover:translate-x-1" />
                              </span>
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                      <NavLink
                        to="/experiences"
                        onClick={() => setMegaOpen(false)}
                        className="mt-3 flex items-center justify-between rounded-xl border border-line px-4 py-3 text-sm font-semibold text-navy-900 transition-colors hover:border-pine-800 hover:bg-pine-800 hover:text-cream-50"
                      >
                        Explore all experiences
                        <ArrowRight className="h-4 w-4" />
                      </NavLink>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {desktopLinks.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'link-underline text-sm font-semibold',
                    lightText
                      ? isActive
                        ? 'link-underline-active text-leaf-300'
                        : 'text-cream-100 hover:text-leaf-300'
                      : isActive
                        ? 'link-underline-active text-leaf-700'
                        : 'text-navy-900 hover:text-leaf-700',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {isDesktop && (
              <Button to="/customer/login" variant="primary" size="md" className="px-8">
                Login
              </Button>
            )}

            {/* Mobile toggle */}
            <div className="lg:hidden">
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                onClick={() => setMenuOpen((open) => !open)}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                  lightText
                    ? 'bg-cream-50/15 text-cream-50'
                    : 'border border-line bg-white/70 text-navy-900',
                )}
              >
                <span className="relative block h-3 w-5" aria-hidden="true">
                  <span
                    className={cn(
                      'absolute left-0 h-[1.5px] w-full bg-current transition-all duration-300',
                      menuOpen ? 'top-1.5 rotate-45' : 'top-0',
                    )}
                  />
                  <span
                    className={cn(
                      'absolute left-0 top-1.5 h-[1.5px] w-full bg-current transition-all duration-300',
                      menuOpen && 'opacity-0',
                    )}
                  />
                  <span
                    className={cn(
                      'absolute left-0 h-[1.5px] w-full bg-current transition-all duration-300',
                      menuOpen ? 'top-1.5 -rotate-45' : 'top-3',
                    )}
                  />
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            ref={mobilePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className="fixed inset-0 z-40 flex flex-col bg-cream-100 pt-20 sm:pt-24"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuPanel}
          >
            <nav
              className="mx-auto w-full max-w-[var(--container-site)] flex-1 overflow-y-auto px-5 pb-10"
              aria-label="Mobile"
            >
              <ul className="flex flex-col divide-y divide-line">
                <motion.li variants={menuItem}>
                  <NavLink
                    to="/"
                    className={({ isActive }) =>
                      cn(
                        'flex items-center justify-between py-5',
                        isActive ? 'text-leaf-700' : 'text-navy-900',
                      )
                    }
                  >
                    <span className="font-display text-3xl font-medium">Home</span>
                  </NavLink>
                </motion.li>

                <motion.li variants={menuItem}>
                  <p className="label-caps pt-6 pb-1 text-ink-400">Experiences</p>
                  <ul className="divide-y divide-line">
                    {experiences.map((experience) => (
                      <li key={experience.id}>
                        <NavLink
                          to={`/experiences/${experience.slug}`}
                          className="group flex items-center gap-4 py-4"
                        >
                          <span className="flex flex-col">
                            <span className="font-display text-2xl font-medium text-navy-900 group-hover:text-leaf-700">
                              {experience.shortName}
                            </span>
                            <span className="flex items-center gap-1.5 text-[0.62rem] font-semibold tracking-[0.18em] text-ink-400 uppercase">
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  statusDot[experience.status],
                                )}
                                aria-hidden="true"
                              />
                              {experience.statusLabel}
                            </span>
                          </span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </motion.li>

                {siteConfig.nav.main
                  .filter((item) => item.path !== '/' && item.path !== '/experiences')
                  .map((item) => (
                    <motion.li key={item.path} variants={menuItem}>
                      <NavLink
                        to={item.path}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center justify-between py-5',
                            isActive ? 'text-leaf-700' : 'text-navy-900',
                          )
                        }
                      >
                        <span className="font-display text-3xl font-medium">{item.label}</span>
                      </NavLink>
                    </motion.li>
                  ))}
              </ul>

              <motion.div variants={menuItem} className="mt-8 flex flex-col gap-3">
                <Button to="/customer/login" variant="primary" size="lg" className="w-full">
                  Login
                </Button>
                <a
                  href={`mailto:${siteConfig.email}`}
                  className="text-center text-sm font-semibold text-navy-900 underline-offset-4 break-words hover:text-leaf-700"
                >
                  {siteConfig.email}
                </a>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
