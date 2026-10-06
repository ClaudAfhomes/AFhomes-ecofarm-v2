import { useQuery } from '@tanstack/react-query';
import { cmsPageSchema, type CmsSection } from '@afhomes/contracts';
import { Navigate, useParams } from 'react-router';

import { request } from '../../lib/api/client';
import { safeHref, safeSrc } from '../lib/safeUrl';
import { Container } from '../components/ui/Container';
import { PageHeader } from '../components/ui/PageHeader';
import NotFound from './NotFound';

const reserved = new Set(['admin', 'api', 'customer', 'health', 'experiences', 'stories']);

function Section({ section }: { section: CmsSection }) {
  const content = section.content;
  const title = typeof content.title === 'string' ? content.title : '';
  const text = typeof content.text === 'string' ? content.text : '';
  const url = safeSrc(typeof content.url === 'string' ? content.url : '');
  const alt = typeof content.alt === 'string' ? content.alt : title;
  if (section.blockType === 'divider') return <hr />;
  // An unsafe or missing source degrades to nothing: no broken-image icon and
  // no attacker-controlled bytes in a loading context.
  if (section.blockType === 'image') return url ? <img src={url} alt={alt} loading="lazy" /> : null;
  if (section.blockType === 'video')
    return url ? <video src={url} controls aria-label={title || 'Video'} /> : null;
  if (section.blockType === 'cta') {
    const href = safeHref(typeof content.href === 'string' ? content.href : '') ?? '#';
    const label = typeof content.label === 'string' ? content.label : 'Learn more';
    return (
      <section>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
        <a href={href} rel="noopener noreferrer">
          {label}
        </a>
      </section>
    );
  }
  return (
    <section>
      <>
        {title && <h2>{title}</h2>}
        {text && text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
      </>
    </section>
  );
}

export default function CmsPage() {
  const slug = useParams().slug ?? '';
  const page = useQuery({
    queryKey: ['cms', 'public-page', slug],
    queryFn: () => request(`/cms/public/pages/${encodeURIComponent(slug)}`, cmsPageSchema),
    enabled: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !reserved.has(slug),
    retry: false,
  });
  if (reserved.has(slug)) return <Navigate to="/" replace />;
  if (page.isLoading)
    return (
      <Container>
        <p role="status">Loading page…</p>
      </Container>
    );
  if (!page.data) return <NotFound />;
  return (
    <>
      <PageHeader eyebrow="AF Homes" title={page.data.title} />
      <Container className="py-16">
        {page.data.sections.map((section) => (
          <Section key={section.id ?? section.sortOrder} section={section} />
        ))}
      </Container>
    </>
  );
}
