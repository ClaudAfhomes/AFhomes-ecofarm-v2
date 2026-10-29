import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { cmsContentSchemas, type CmsDocument, type CmsDocumentKey } from '@afhomes/contracts';
import { Button, ErrorState, PageHeader, Skeleton, TextField, StatusChip } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getCmsDocuments, publishCmsDocument, saveCmsDocument } from './services';
import { ContentFields } from './ContentFields';
import { initialCmsValue,cmsDisplayState,vipMarketingFields } from './content-model';
import { CmsPreview } from './CmsPreview';
import { useCmsUnsaved } from './useCmsUnsaved';
import styles from './cms.module.css';

export function CmsDocumentPage({title,description,documentKey,mode}:{title:string;description:string;documentKey:CmsDocumentKey;mode?:'seo'|'site'}) {
  const {user}=useSession();const documents=useQuery({queryKey:['cms','documents'],queryFn:getCmsDocuments});
  const document=documents.data?.find(d=>d.key===documentKey);
  const canUpdate=user?.afHomesPermissions.some(p=>p.moduleKey===(documentKey==='site'?'cms.settings':'cms.pages')&&p.canUpdate)===true;
  if(documents.isPending)return <Skeleton style={{height:300}}/>;
  if(documents.isError)return <ErrorState error={documents.error} onRetry={()=>void documents.refetch()}/>;
  return <DocumentEditor key={documentKey+':'+mode} title={title} description={description} documentKey={documentKey} document={document} canUpdate={canUpdate} mode={mode}/>;
}
function DocumentEditor({title,description,documentKey,document:loaded,canUpdate,mode}:{title:string;description:string;documentKey:CmsDocumentKey;document?:CmsDocument;canUpdate:boolean;mode?:'seo'|'site'}) {
  const client=useQueryClient();const [document,setDocument]=useState(loaded);
  const [value,setValue]=useState(()=>initialCmsValue(loaded,documentKey));
  const [saved,setSaved]=useState(()=>JSON.stringify(value));const [summary,setSummary]=useState('');const [preview,setPreview]=useState(false);const [message,setMessage]=useState('');
  const dirty=JSON.stringify(value)!==saved;useCmsUnsaved(dirty);
  const valid=cmsContentSchemas[documentKey].safeParse(value);
  const accept=async(next:CmsDocument)=>{setDocument(next);setValue(next.draftValue);setSaved(JSON.stringify(next.draftValue));setSummary('');setMessage('Draft saved. The public website is unchanged until you publish.');await client.invalidateQueries({queryKey:['cms']});};
  const save=useBusinessMutation({mutationFn:async()=>{if(!valid.success)throw Error(valid.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('\n'));return saveCmsDocument(documentKey,value,document?.version??1,summary)},onSuccess:accept});
  const publish=useBusinessMutation({mutationFn:(publishing:boolean)=>publishCmsDocument(documentKey,publishing,document!.version),onSuccess:async(next)=>{await accept(next);setMessage(next.status==='published'?'Saved draft published.':'Unpublished. The website uses its existing fallback content.')}});
  const allSchema=cmsContentSchemas[documentKey];let schema:z.ZodType=allSchema;let displayed=value;
  const obj=(value??{}) as Record<string,unknown>;
  if(documentKey==='site'){
    const fields=Object.keys(cmsContentSchemas.site.shape).filter(k=>mode==='seo'?['seo','pageSeo'].includes(k):!['seo','pageSeo','social'].includes(k));
    schema=cmsContentSchemas.site.pick(Object.fromEntries(fields.map(k=>[k,true])) as never);displayed=Object.fromEntries(fields.map(k=>[k,obj[k]]));
  }
  return <section className={styles.page}><PageHeader title={title} description={description} actions={<StatusChip label={valid.success?cmsDisplayState(document):'Needs Review'} tone={valid.success?'neutral':'warning'}/>}/>
    <p>{document?`Saved version ${document.version}.`:'No saved draft yet. Current website content is shown; opening this editor makes no changes.'} {dirty?'You have unsaved changes.':''}</p>
    {documentKey==='vip'&&<p>Marketing name and imagery only. Prices, discounts, validity, Annual Welcome Gifts and Loyalty Stay Points are managed by the operational card plans.</p>}
    {mode==='site'&&<p>Official payment instructions and verification support details remain in <a href="/admin/settings/public-verification">Public Verification Settings</a>. This editor does not change them.</p>}
    {!valid.success&&<div role="alert"><p>Content needs review. The original data is preserved; correct the fields below before saving.</p><ul>{valid.error.issues.slice(0,15).map((issue,i)=><li key={i}>{issue.path.join(' / ')}: {issue.message}</li>)}</ul></div>}
    <ContentFields schema={schema} value={displayed} path={documentKey} label={title} disabled={!canUpdate||save.isPending||publish.isPending} allowed={documentKey==='vip'?vipMarketingFields:undefined} onChange={next=>setValue(documentKey==='site'?{...obj,...next as object}:next)}/>
    <TextField id="cms-document-summary" name="summary" label="Change summary" value={summary} onChange={setSummary} disabled={!canUpdate} optional maxLength={500}/>
    {message&&<p role="status">{message}</p>}{save.error&&<p role="alert">{save.error.message}</p>}{publish.error&&<p role="alert">{publish.error.message}</p>}
    <div className={styles.actions}>{canUpdate&&<Button disabled={!valid.success||save.isPending||publish.isPending||summary.trim().length<3} onClick={()=>save.mutate()}>Save Draft</Button>}{document&&<><Button variant="secondary" onClick={()=>setPreview(!preview)}>Preview Saved Draft</Button>{canUpdate&&<><Button disabled={dirty||!valid.success||publish.isPending||save.isPending} onClick={()=>publish.mutate(true)}>Publish Saved Draft</Button>{document.status==='published'&&<Button variant="secondary" disabled={dirty||publish.isPending||save.isPending} onClick={()=>publish.mutate(false)}>Unpublish</Button>}</>}</>}</div>
    {preview&&document&&<CmsPreview document={document} onClose={()=>setPreview(false)}/>}
  </section>;
}
