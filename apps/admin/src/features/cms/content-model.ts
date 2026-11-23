import type { CmsDocument, CmsDocumentKey } from '@afhomes/contracts';
import { websiteDefaults } from '@afhomes/ui/website-content';

export const cmsGroups: Record<CmsDocumentKey, string> = {site:'Site Settings',pageContent:'Website Pages',experiences:'Experiences',stories:'Stories',faq:'FAQ',vip:'VIP Website Content',mediaBlocks:'Media Placement'};
export const vipMarketingFields = ['id','name','image','featured','archived'];
export const cmsEditableFields = (key: CmsDocumentKey) => key === 'vip' ? vipMarketingFields : [];
export function initialCmsValue(document: CmsDocument | undefined, key: CmsDocumentKey): unknown {
  if(document?.draftValue !== undefined && document.draftValue !== null) return structuredClone(document.draftValue);
  if(document?.publishedValue !== undefined && document.publishedValue !== null) return structuredClone(document.publishedValue);
  if(key === 'vip') return websiteDefaults.vip.map(v => Object.fromEntries(Object.entries(v).filter(([k])=>vipMarketingFields.includes(k))));
  return structuredClone(websiteDefaults[key]);
}
export function cmsDisplayState(document?: CmsDocument): string {
  if(!document) return 'Draft';
  if(document.status !== 'published') return 'Draft';
  return JSON.stringify(document.draftValue) === JSON.stringify(document.publishedValue) ? 'Published' : 'Unpublished Changes';
}
export const fieldLabel = (key: string) => ({lede:'Introduction',src:'Media URL',alt:'Alternative text',href:'Link',seo:'SEO',pageSeo:'Page SEO',heroPrimaryCta:'Primary button label',heroSecondaryCta:'Secondary button label'}[key] ?? key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase()));
export const lockedField = (key: string) => ['id','slug','path','accent','accentText','accentBg','theme','ghost','ring','line','sortOrder','textColor'].includes(key);
/** DOM id of the fieldset rendered for a content path (`site.theme` -> `cms-site-theme`). */
export const cmsFieldId = (path: string) => 'cms-' + path.replace(/\./g, '-');
/** Human name of a list entry, matching the editor's disclosure summaries. */
export function entryLabel(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const v = value as Record<string, unknown>;
  const name = v.title ?? v.name ?? v.label ?? v.question;
  return typeof name === 'string' && name.trim() ? name : fallback;
}
const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
const listSummary = (verb: string, labels: string[]) =>
  labels.length ? `${verb} ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` and ${labels.length - 3} more` : ''}` : '';
/** Plain-words change summary from the saved value to the edited value; '' when unchanged. */
export function summarizeChanges(before: unknown, after: unknown): string {
  if (!changed(before, after)) return '';
  if (Array.isArray(before) && Array.isArray(after)) {
    const diff = after.length - before.length;
    if (diff) return `${diff > 0 ? 'Added' : 'Removed'} ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'entry' : 'entries'}`;
    return listSummary('Updated', after.flatMap((item, i) => (changed(item, before[i]) ? [entryLabel(item, `Entry ${i + 1}`)] : [])));
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return listSummary('Updated', keys.filter((k) => changed(a[k], b[k])).map(fieldLabel));
  }
  return 'Updated content';
}
