import { Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Navbar } from "../../components/layout/Navbar";
import { Footer } from "../../components/layout/Footer";
import { ScrollToTop } from "../../components/layout/ScrollToTop";
import { CursorDot } from "../../components/ui/CursorDot";
import { EASE } from "../../lib/motion";
import { CmsMediaSections } from "../../components/ui/CmsMediaSections";

export function Layout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <CursorDot />
      <a
        href="#site-content"
        className="fixed top-2 left-2 z-[200] -translate-y-24 rounded-full bg-pine-800 px-5 py-3 text-sm font-semibold text-cream-50 transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <Navbar />
      <AnimatePresence mode="wait">
        <motion.main
          id="site-content"
          key={location.pathname}
          className="min-h-[70vh] flex-1"
          initial={{ y: 8 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.4, ease: EASE } }}
          exit={{ opacity: 0, transition: { duration: 0.22, ease: "easeOut" } }}
        >
          <CmsMediaSections page={location.pathname} placement="before-page" />
          <Outlet />
          <CmsMediaSections page={location.pathname} placement="after-page" />
        </motion.main>
      </AnimatePresence>
      <Footer />
    </div>
  );
}
