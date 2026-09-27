import { useEffect } from "react";
import { cmsRepository } from "../lib/cms";
import { useCmsRevision } from "../hooks/useCmsRevision";

const FALLBACK_DESCRIPTION =
  "AFhomes hospitality, wellness, dining, nature and resort experiences in Laguna, Philippines.";

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function removeMeta(attribute: "name" | "property", key: string) {
  document.head.querySelector(`meta[${attribute}="${key}"]`)?.remove();
}

function setLink(rel: string, href: string) {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

function absoluteUrl(base: string, value: string) {
  if (!value) return "";
  try {
    return new URL(value, `${base.replace(/\/$/, "")}/`).href;
  } catch {
    return "";
  }
}

function pageTitle(title: string, template: string) {
  if (template.includes("%s")) return template.replace("%s", title);
  if (template.includes("{page}")) return template.replace("{page}", title);
  return `${title} — ${template}`;
}

interface SeoProps {
  title: string;
  description?: string;
  /** Absolute path (starting with /) used for canonical + og:url. */
  path?: string;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphImage?: string;
}

/** Applies saved global and per-page SEO data to every public route. */
export function Seo({ title, description, path = "/", openGraphTitle, openGraphDescription, openGraphImage }: SeoProps) {
  const cmsRevision = useCmsRevision();

  useEffect(() => {
    const site = cmsRepository.getSiteConfig();
    const saved = site.pageSeo.find((page) => page.path === path);
    const canonicalBase = site.seo.canonicalSiteUrl || site.siteUrl;
    const canonical = absoluteUrl(canonicalBase, path);
    const effectiveTitle = saved?.seoTitle || title;
    const documentTitle = path === "/" && !saved?.seoTitle
      ? site.seo.siteTitle
      : pageTitle(effectiveTitle, site.seo.titleTemplate);
    const effectiveDescription = saved?.metaDescription || description || site.seo.metaDescription || FALLBACK_DESCRIPTION;
    const ogTitle = saved?.openGraphTitle || openGraphTitle || effectiveTitle;
    const ogDescription = saved?.openGraphDescription || openGraphDescription || effectiveDescription;
    const ogImage = absoluteUrl(canonicalBase, saved?.openGraphImage.src || openGraphImage || site.seo.defaultSocialImage.src);

    document.title = documentTitle;
    setMeta("name", "description", effectiveDescription);
    setMeta("name", "keywords", site.seo.keywords.join(", "));
    setMeta("name", "robots", path === "/404" ? "noindex, follow" : "index, follow");
    setMeta("property", "og:type", "website");
    setMeta("property", "og:site_name", site.seo.siteTitle);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:title", ogTitle);
    setMeta("property", "og:description", ogDescription);
    setMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", ogTitle);
    setMeta("name", "twitter:description", ogDescription);
    if (ogImage) {
      setMeta("property", "og:image", ogImage);
      setMeta("name", "twitter:image", ogImage);
    } else {
      removeMeta("property", "og:image");
      removeMeta("name", "twitter:image");
    }
    setLink("canonical", canonical);
    if (site.seo.favicon.src) {
      setLink("icon", absoluteUrl(canonicalBase, site.seo.favicon.src));
    }

    const primaryOffice = site.offices.find((office) => /head|resort/i.test(office.role)) ?? site.offices[0];
    const socialUrls = site.socialLinks
      .filter((link) => link.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((link) => link.url);
    const schema = {
      "@context": "https://schema.org",
      "@type": "Resort",
      "@id": `${canonicalBase.replace(/\/$/, "")}#resort`,
      name: site.businessName,
      url: canonicalBase,
      telephone: site.phone,
      email: site.email,
      image: ogImage || undefined,
      address: primaryOffice ? {
        "@type": "PostalAddress",
        streetAddress: primaryOffice.lines.join(", "),
        addressCountry: "PH",
      } : undefined,
      hasMap: primaryOffice?.mapUrl,
      sameAs: socialUrls,
    };
    let script = document.head.querySelector<HTMLScriptElement>("#afhomes-local-business-schema");
    if (!script) {
      script = document.createElement("script");
      script.id = "afhomes-local-business-schema";
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(schema);
  }, [title, description, path, openGraphTitle, openGraphDescription, openGraphImage, cmsRevision]);

  return null;
}
