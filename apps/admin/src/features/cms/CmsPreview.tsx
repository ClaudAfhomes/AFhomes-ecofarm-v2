import { useEffect, useRef, useState } from 'react';
import { Button } from '@afhomes/ui';
import type { CmsDocument, CmsPage } from '@afhomes/contracts';
import { env } from '../../lib/env';
import styles from './cms.module.css';

/** Only saved authorized data crosses the bridge; no auth token or draft enters a URL/storage. */
export function CmsPreview({document,page,onClose}:{document?:CmsDocument;page?:CmsPage;onClose:()=>void}) {
  const frame=useRef<HTMLIFrameElement>(null);
  const [session]=useState(()=>crypto.randomUUID());
  const [path,setPath]=useState(page ? '/'+page.slug : document?.key==='stories'?'/stories':document?.key==='experiences'?'/experiences':document?.key==='vip'?'/vip':document?.key==='faq'?'/faq':'/');
  const url=new URL(path,env.VITE_WEB_URL);url.searchParams.set('cmsPreview',session);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==url.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='afhomes-cms-preview-ready'||event.data.session!==session)return;
      frame.current.contentWindow?.postMessage({type:'afhomes-cms-preview-content',session,document,page},url.origin);setReady(true);
    };
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[document,page,session,url.origin]);
  return <section className={styles.panel} aria-label="Saved draft preview"><h2>Preview Saved Draft</h2><p>Private preview of saved version {document?.version??page?.version}. Unsaved edits are excluded.</p>{!page&&<label>Preview page<select value={path} onChange={e=>{setReady(false);setPath(e.target.value)}}>{['/','/about','/contact','/faq','/vip','/experiences','/stories','/compliance','/experiences/smart-wellness-hotel','/experiences/alm-japanese-restaurant','/experiences/hotspring-ecofarm-resort'].map(p=><option key={p} value={p}>{p}</option>)}</select></label>}{!ready&&<p role="status">Waiting for the public website preview. The configured public app must be running.</p>}<Button variant="secondary" onClick={onClose}>Close preview</Button><iframe ref={frame} title="Saved draft website preview" src={url.href} className={styles.previewFrame}/></section>;
}
