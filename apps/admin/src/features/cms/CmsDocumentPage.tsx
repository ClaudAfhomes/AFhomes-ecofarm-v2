import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { cmsContentSchemas, type CmsDocument, type CmsDocumentKey } from '@afhomes/contracts';
import { Button, ConfirmDialog, ErrorState, PageHeader, Skeleton, TextField, StatusChip } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getCmsDocuments, publishCmsDocument, saveCmsDocument } from './services';
import { ContentFields } from './ContentFields';
import { initialCmsValue,cmsDisplayState,vipMarketingFields,summarizeChanges } from './content-model';
import { cmsSections } from './sections';
import { CmsSectionNav } from './CmsSectionNav';
import { CmsPreview } from './CmsPreview';
import { ThemeEditor } from './ThemeEditor';
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
  const [saved,setSaved]=useState(()=>JSON.stringify(value));const [preview,setPreview]=useState(false);const [message,setMessage]=useState('');
  const [summary,setSummary]=useState('');const [summaryEdited,setSummaryEdited]=useState(false);
  const [confirmPublish,setConfirmPublish]=useState(false);const [query,setQuery]=useState('');
  const dirty=JSON.stringify(value)!==saved;const unsaved=useCmsUnsaved(dirty);
  const savedValue=useMemo(()=>JSON.parse(saved) as unknown,[saved]);
  // The summary writes itself from the edit until the editor types their own.
  const changeSummary=summaryEdited?summary:summarizeChanges(savedValue,value);
  const valid=cmsContentSchemas[documentKey].safeParse(value);
  const accept=async(next:CmsDocument)=>{unsaved.onCancel();setDocument(next);setValue(next.draftValue);setSaved(JSON.stringify(next.draftValue));setSummary('');setSummaryEdited(false);setMessage('Draft saved. The public website is unchanged until you publish.');await client.invalidateQueries({queryKey:['cms']});};
  const assertValid=()=>{if(!valid.success)throw Error(valid.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('\n'));};
  const save=useBusinessMutation({mutationFn:async()=>{assertValid();return saveCmsDocument(documentKey,value,document?.version??1,changeSummary)},onSuccess:accept});
  const publish=useBusinessMutation({mutationFn:(publishing:boolean)=>publishCmsDocument(documentKey,publishing,document!.version),onSuccess:async(next)=>{await accept(next);setMessage(next.status==='published'?'Saved draft published.':'Unpublished. The website uses its existing fallback content.')}});
  // One confirmed step: save the draft, then publish exactly that saved version.
  const saveAndPublish=useBusinessMutation({mutationFn:async()=>{
    assertValid();
    const draft=await saveCmsDocument(documentKey,value,document?.version??1,changeSummary);
    try{return await publishCmsDocument(documentKey,true,draft.version);}
    catch(error){await accept(draft);throw new Error(`Draft saved, but publishing failed: ${error instanceof Error?error.message:'unknown error'}`,{cause:error});}
  },onSuccess:async(next)=>{await accept(next);setMessage('Saved and published.')}});
  const busy=save.isPending||publish.isPending||saveAndPublish.isPending;
  const allSchema=cmsContentSchemas[documentKey];let schema:z.ZodType=allSchema;let displayed=value;
  const obj=(value??{}) as Record<string,unknown>;
  if(documentKey==='site'){
    const fields=Object.keys(cmsContentSchemas.site.shape).filter(k=>mode==='seo'?['seo','pageSeo'].includes(k):!['seo','pageSeo','social','theme'].includes(k));
    schema=cmsContentSchemas.site.pick(Object.fromEntries(fields.map(k=>[k,true])) as never);displayed=Object.fromEntries(fields.map(k=>[k,obj[k]]));
  }
  const sections=[...(mode==='site'?[{id:'cms-site-theme',label:'Theme & colours',fieldLabels:['Colours','Primary','Accent','Background','Text','Dark sections','Preset']}]:[]),...cmsSections(schema,displayed,documentKey)];
  const canSave=canUpdate&&valid.success&&!busy&&changeSummary.trim().length>=3;
  const state=dirty?'Unsaved changes':cmsDisplayState(document)==='Published'?'Published':document?'All changes saved':'No saved draft yet';
  return <section className={styles.page}><PageHeader title={title} description={description} actions={<StatusChip label={valid.success?cmsDisplayState(document):'Needs Review'} tone={valid.success?'neutral':'warning'}/>}/>
    <p>{document?`Saved version ${document.version}.`:'No saved draft yet. Current website content is shown; opening this editor makes no changes.'}</p>
    {documentKey==='vip'&&<p>Marketing name and imagery only. Prices, discounts, validity, Annual Welcome Gifts and Loyalty Stay Points are managed by the operational card plans.</p>}
    {mode==='site'&&<p>Official payment instructions and verification support details remain in <a href="/admin/settings/public-verification">Public Verification Settings</a>. This editor does not change them.</p>}
    {!valid.success&&<div role="alert"><p>Content needs review. The original data is preserved; correct the fields below before saving.</p><ul>{valid.error.issues.slice(0,15).map((issue,i)=><li key={i}>{issue.path.join(' / ')}: {issue.message}</li>)}</ul></div>}
    <div className={styles.editorLayout}>
      {sections.length>1&&<CmsSectionNav sections={sections} query={query} onQuery={setQuery}/>}
      <div className={styles.editorMain}>
        {mode==='site'&&<ThemeEditor value={obj.theme} disabled={!canUpdate||busy} onChange={theme=>{const next={...obj};if(theme)next.theme=theme;else delete next.theme;setValue(next);}}/>}
        <ContentFields schema={schema} value={displayed} path={documentKey} label={title} disabled={!canUpdate||busy} allowed={documentKey==='vip'?vipMarketingFields:undefined} onChange={next=>setValue(documentKey==='site'?{...obj,...next as object}:next)}/>
        <TextField id="cms-document-summary" name="summary" label="Change summary" hint="Written for you from your edits; change it if you like." value={changeSummary} onChange={next=>{setSummaryEdited(true);setSummary(next);}} disabled={!canUpdate} maxLength={500}/>
      </div>
    </div>
    {message&&<p role="status">{message}</p>}{save.error&&<p role="alert">{save.error.message}</p>}{publish.error&&<p role="alert">{publish.error.message}</p>}{saveAndPublish.error&&<p role="alert">{saveAndPublish.error.message}</p>}
    <div className={`${styles.actionBar} ${dirty?styles.actionBarDirty:''}`}>
      <span className={dirty?styles.stateDirty:styles.state} aria-live="polite">{state}</span>
      <div className={styles.actions}>
        {document&&<Button variant="secondary" onClick={()=>setPreview(!preview)}>Preview Saved Draft</Button>}
        {canUpdate&&document?.status==='published'&&<Button variant="secondary" disabled={dirty||busy} onClick={()=>publish.mutate(false)}>Unpublish</Button>}
        {canUpdate&&document&&<Button variant="secondary" disabled={dirty||!valid.success||busy} onClick={()=>publish.mutate(true)}>Publish Saved Draft</Button>}
        {canUpdate&&<Button variant="secondary" disabled={!canSave} onClick={()=>save.mutate()}>Save Draft</Button>}
        {canUpdate&&<Button disabled={!canSave} onClick={()=>setConfirmPublish(true)}>Save &amp; Publish</Button>}
      </div>
    </div>
    {preview&&document&&<CmsPreview document={document} onClose={()=>setPreview(false)}/>}
    <ConfirmDialog open={confirmPublish} title="Publish to the public website?" message={<>This saves your edits ({changeSummary||'no summary'}) and makes them live on the public website right away.</>} confirmLabel="Publish now" onCancel={()=>setConfirmPublish(false)} onConfirm={()=>{setConfirmPublish(false);saveAndPublish.mutate();}}/>
    <ConfirmDialog {...unsaved} title="Leave this editor?" message="Your unsaved changes will be lost." confirmLabel="Leave editor"/>
  </section>;
}
