import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { cmsRepository } from "../../lib/cms";
import { useCmsRevision } from "../../hooks/useCmsRevision";
import logo from "../../assets/logo.png";

interface LogoProps {
  className?: string;
  to?: string;
}

/** AFhomes brand mark, rendered from the official logo asset. */
export function Logo({ className, to = "/" }: LogoProps) {
  useCmsRevision();
  const siteConfig = cmsRepository.getSiteConfig();
  return (
    <Link
      to={to}
      className={cn("group inline-flex shrink-0 items-center", className)}
      aria-label="AFhomes — Home Away From Home"
    >
      <img
        src={siteConfig.logo?.src || logo}
        alt={siteConfig.logo?.alt || "AFhomes"}
        width={1480}
        height={855}
        className="h-8 w-auto sm:h-9 lg:h-10"
      />
    </Link>
  );
}