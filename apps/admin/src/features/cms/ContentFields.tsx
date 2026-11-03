import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button, TextField, TextAreaField, Select } from '@afhomes/ui';
import { siteMediaCatalog } from '@afhomes/ui/website-content';
import { getCmsMedia } from './services';
import { fieldLabel, lockedField } from './content-model';
import styles from './cms.module.css';

export function baseSchema(schema: z.ZodType): z.ZodType {
  while(schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) schema=schema.unwrap() as z.ZodType;
  return schema;
}
export function blankContent(schema: z.ZodType): unknown {
  const node=baseSchema(schema);
  if(node instanceof z.ZodObject) return Object.fromEntries(Object.entries(node.shape).filter(([,s])=>!(s as z.ZodType).isOptional()).map(([k,s])=>[k,k==='id'||k==='slug' ? crypto.randomUUID():blankContent(s as z.ZodType)]));
  if(node instanceof z.ZodArray)return [];
  if(node instanceof z.ZodBoolean)return false;
  if(node instanceof z.ZodNumber)return 0;
  if(node instanceof z.ZodLiteral)return [...node.values][0];
  if(node instanceof z.ZodUnion)return blankContent(node.options[0] as z.ZodType);
  return '';
}
function MediaPicker({onPick,disabled,kind}:{onPick:(src:string,alt:string)=>void;disabled:boolean;kind?:string}) {
  const [open,setOpen]=useState(false);
  const media=useQuery({queryKey:['cms','media'],queryFn:getCmsMedia,enabled:open});
  return <><Button variant="secondary" disabled={disabled} onClick={()=>setOpen(!open)}>{open?'Close media picker':'Choose from Media Library'}</Button>{open&&<div className={styles.mediaPicker} aria-label="Media selection">
    {media.isError&&<p role="alert">Media Library could not be loaded. Bundled website images are still available.</p>}
    {[...siteMediaCatalog.map(m=>({id:m.id,name:m.name,publicUrl:m.src,altText:m.alt,mediaType:'image'})),...(media.data??[])].filter(m=>!kind||m.mediaType===kind).map(m=><button type="button" className={styles.mediaChoice} key={m.id} onClick={()=>{onPick(m.publicUrl,m.altText);setOpen(false)}}>{m.mediaType==='image'?<img src={m.publicUrl} alt={m.altText}/>:<span>Video</span>}<span>{m.name}</span><small>{m.mediaType} � {m.altText||'No alternative text'}</small></button>)}
  </div>}</>;
}
export function ContentFields({schema,value,onChange,label='Content',disabled=false,path='',allowed}:{schema:z.ZodType;value:unknown;onChange:(v:unknown)=>void;label?:string;disabled?:boolean;path?:string;allowed?:string[]}) {
  const id=useId();const node=baseSchema(schema);
  if(node instanceof z.ZodObject){
    const obj=(value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Record<string,unknown>;
    const image='src' in node.shape && 'alt' in node.shape;
    return <fieldset className={styles.contentGroup} disabled={disabled}><legend>{label}</legend>{/compliance|privacy|terms|notice|copyright|businessName/i.test(path)&&<p>Protected legal or company wording. Preserve the approved text unless an authorized change is intended.</p>}
      {image&&<>{typeof obj.src==='string'&&obj.src&&<img className={styles.selectedMedia} src={obj.src} alt={String(obj.alt??'')}/>}<MediaPicker disabled={disabled} kind="image" onPick={(src,alt)=>onChange({...obj,src,alt})}/></>}
      {Object.entries(node.shape).filter(([key])=>!lockedField(key)&&(!allowed||allowed.includes(key))).map(([key,child])=><ContentFields key={key} schema={child as z.ZodType} value={obj[key]} path={`${path}.${key}`} label={fieldLabel(key)} disabled={disabled} onChange={v=>onChange({...obj,[key]:v})}/>)}
    </fieldset>;
  }
  if(node instanceof z.ZodArray){
    const list=Array.isArray(value)?value:[];
    const element=node.element as z.ZodType;
    const fixed=/^(experiences|vip)$/.test(path);
    return <fieldset className={styles.contentGroup} disabled={disabled}><legend>{label}</legend>{!list.length&&<p>No entries.</p>}{list.map((v,i)=><details key={i} open={list.length<4} className={styles.listItem}><summary>{typeof v==='object'&&v ? String(v.title??v.name??v.label??v.question??`${label} ${i+1}`):`${label} ${i+1}`}</summary><ContentFields schema={element} value={v} path={`${path}.${i}`} label={`${label} ${i+1}`} disabled={disabled} allowed={allowed} onChange={next=>onChange(list.map((old,n)=>n===i?next:old))}/><div className={styles.actions}>{!fixed&&<><Button variant="secondary" disabled={disabled||i===0} onClick={()=>{const next=[...list];[next[i-1],next[i]]=[next[i],next[i-1]];onChange(next)}}>Move up</Button><Button variant="secondary" disabled={disabled||i===list.length-1} onClick={()=>{const next=[...list];[next[i+1],next[i]]=[next[i],next[i+1]];onChange(next)}}>Move down</Button><Button variant="secondary" disabled={disabled} onClick={()=>onChange(list.filter((_,n)=>n!==i))}>Remove entry</Button></>}</div></details>)}{!fixed&&<Button variant="secondary" disabled={disabled} onClick={()=>onChange([...list,blankContent(element)])}>Add {label.toLowerCase()} entry</Button>}</fieldset>;
  }
  const update=(next:string)=>onChange(node instanceof z.ZodNumber?(next===''?0:Number(next)):next);
  if(node instanceof z.ZodBoolean)return <label className={styles.check}><input type="checkbox" checked={value===true} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>{label}</label>;
  const options=node instanceof z.ZodEnum?node.options:node instanceof z.ZodUnion?node.options.flatMap(o=>o instanceof z.ZodLiteral?[...o.values]:[]):[];
  if(options.length)return <label htmlFor={id}>{label}<Select id={id} value={String(value??options[0])} disabled={disabled} options={options.map(v=>({label:fieldLabel(String(v)),value:String(v)}))} onChange={e=>update(e.target.value)}/></label>;
  const text=typeof value==='string'||typeof value==='number'?String(value):'';
  const multiline=/body|description|lede|summary|excerpt|answer|notice|quote|paragraph|mission|vision/i.test(path)||text.length>130;
  return multiline?<TextAreaField id={id} name={path} label={label} value={text} onChange={update} disabled={disabled} rows={4} optional/>:<TextField id={id} name={path} label={label} value={text} onChange={update} disabled={disabled} type="text" inputMode={node instanceof z.ZodNumber?'decimal':'text'} optional/>;
}
