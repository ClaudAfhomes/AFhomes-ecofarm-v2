import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { Container } from "../../components/ui/Container";
import { ChevronDown } from "../../components/ui/icons";
import { cmsRepository } from "../../lib/cms";

const footerLink =
  "link-underline text-cream-200/80 transition-colors hover:text-leaf-300";

interface FooterGroupProps {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Mobile-first collapsible link group; always expanded on large screens. */
function FooterGroup({ id, title, open, onToggle, children }: FooterGroupProps) {
  const contentId = `footer-group-${id}`;
  return (
    <div>
      <h2 className="label-caps text-cream-300">
        <div className="lg:hidden">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={onToggle}
            className="flex w-full items-center justify-between gap-4 py-3.5 text-left"
          >
            {title}
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-cream-300/50 transition-transform duration-300",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
        <span className="hidden lg:block">{title}</span>
      </h2>
      <div id={contentId} className={cn(open ? "block" : "hidden", "lg:block")}>
        <ul className="mt-5 space-y-3">{children}</ul>
      </div>
    </div>
  );
}

export function Footer() {
  const siteConfig = cmsRepository.getSiteConfig();
  const experiences = cmsRepository.getExperiences();
  const explore = siteConfig.nav.main.filter((item) => item.path !== "/");
  const socialLinks = [...siteConfig.socialLinks]
    .filter((item) => item.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const year = new Date().getFullYear();
  const [openGroups, setOpenGroups] = useState<string[]>(["explore"]);

  const toggleGroup = (id: string) => {
    setOpenGroups((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <footer className="bg-pine-950 text-cream-100">
      <Container className="pt-16 pb-10 sm:pt-24">
        {/* Brand statement */}
        <div className="max-w-3xl">
          <p className="label-caps text-gold-400">{siteConfig.footerEyebrow}</p>
          <p className="font-display mt-4 whitespace-pre-line text-4xl leading-[1.05] font-medium text-balance text-cream-50 sm:text-5xl lg:text-6xl">{siteConfig.footerTitle}</p>
        </div>

        {/* Columns — collapsible groups on mobile */}
        <div className="mt-12 grid grid-cols-1 gap-10 border-t border-white/10 pt-10 sm:mt-16 sm:grid-cols-2 sm:pt-14 lg:grid-cols-4 lg:gap-12">
          <FooterGroup id="explore" title={siteConfig.footerExploreLabel} open={openGroups.includes("explore")} onToggle={() => toggleGroup("explore")}>
            {explore.map((item) => (
              <li key={item.path}>
                <Link to={item.path} className={footerLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </FooterGroup>

          <FooterGroup id="experiences" title={siteConfig.footerExperiencesLabel} open={openGroups.includes("experiences")} onToggle={() => toggleGroup("experiences")}>
            {experiences.map((experience) => (
              <li key={experience.id} className="flex flex-col">
                <Link
                  to={`/experiences/${experience.slug}`}
                  className={footerLink}
                >
                  {experience.shortName}
                </Link>
                <span className="mt-0.5 text-[0.62rem] font-semibold tracking-[0.16em] text-cream-200 uppercase">
                  {experience.statusLabel}
                </span>
              </li>
            ))}
          </FooterGroup>

          <FooterGroup id="contact" title={siteConfig.footerContactLabel} open={openGroups.includes("contact")} onToggle={() => toggleGroup("contact")}>
            <li>
              <a href={`tel:${siteConfig.phone}`} className={cn(footerLink)}>
                {siteConfig.phoneDisplay}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${siteConfig.email}`}
                className={cn(footerLink, "break-all")}
              >
                {siteConfig.email}
              </a>
            </li>
          </FooterGroup>

          <FooterGroup id="offices" title={siteConfig.footerOfficesLabel} open={openGroups.includes("offices")} onToggle={() => toggleGroup("offices")}>
            {siteConfig.offices.map((office) => (
              <li key={office.name} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-cream-100">
                  {office.name}
                </span>
                {office.lines.map((line) => (
                  <span key={line} className="text-sm leading-relaxed">
                    {line}
                  </span>
                ))}
                {office.mapUrl && <a href={office.mapUrl} target="_blank" rel="noopener noreferrer" className={cn(footerLink, "mt-1 text-sm")}>Directions</a>}
              </li>
            ))}
          </FooterGroup>
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <p className="label-caps text-cream-300">Follow AFhomes</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {socialLinks.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className={footerLink}>{item.label}</a>)}
          </div>
        </div>

        {/* Transparency / disclaimers */}
        <div className="mt-14 rounded-2xl border border-white/10 p-6 sm:mt-16 sm:p-8">
          <p className="label-caps text-cream-300">{siteConfig.footerNoticeTitle}</p>
          <p className="mt-4 max-w-4xl text-sm leading-relaxed text-cream-200/70 text-pretty">
            {siteConfig.footerNoticeBody}
          </p>
        </div>

        {/* Legal row */}
        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-sm text-cream-300/60 sm:flex-row sm:items-center">
          <p>
            © {year} {siteConfig.brand.name} — {siteConfig.footerCopyright}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/compliance#privacy" className={cn(footerLink)}>
              Privacy
            </Link>
            <Link to="/compliance#terms" className={cn(footerLink)}>
              Terms
            </Link>
            <Link to="/compliance" className={cn(footerLink)}>
              Compliance &amp; Transparency
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
