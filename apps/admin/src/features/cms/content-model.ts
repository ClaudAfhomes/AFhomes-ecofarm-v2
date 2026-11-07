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
