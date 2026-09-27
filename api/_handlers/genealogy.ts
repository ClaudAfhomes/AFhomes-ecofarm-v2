/** PHASE 7 authorized VD -> SSM -> SM -> OST genealogy reads. */
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { deny, fail, list, method, subPath, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest,VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';

const sellerRoles=['vice_director','senior_sales_manager','sales_manager','ost'] as const;
type SellerRole=(typeof sellerRoles)[number];
type Node={staffId:string;fullName:string;role:SellerRole;status:'invited'|'active'|'inactive'|'suspended';ostStatus:'active'|'inactive'|'suspended'|null;uplineStaffId:string|null;directDownlineCount:number;totalDescendantCount:number};

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(method(req)!=='GET') return fail(res,'NOT_FOUND','Genealogy endpoint not found',404);
  const auth=await authorizeAfHomes(req,'network.genealogy'); if('error' in auth) return deny(res,auth);
  const db=serviceClient() as Db; if(!db) return fail(res,'INTERNAL','Supabase server configuration is incomplete',500);
  try{
    const [{data:staff,error:se},{data:assign,error:ae},{data:roles,error:re},{data:rels,error:ge},{data:ost,error:oe}]=await Promise.all([
      db.from('staff_users').select('id,full_name,status'),db.from('staff_role_assignments').select('staff_id,role_id'),
      db.from('roles').select('id,slug').eq('is_active',true),db.from('referral_relationships').select('subject_staff_id,upline_staff_id').eq('is_active',true),
      db.from('ost_members').select('id,status'),
    ]); if(se||ae||re||ge||oe) throw se||ae||re||ge||oe;
    const roleById=new Map<string,string>((roles??[]).map((r:{id:string;slug:string})=>[r.id,r.slug]));
    const roleByStaff=new Map<string,string|undefined>((assign??[]).map((a:{staff_id:string;role_id:string})=>[a.staff_id,roleById.get(a.role_id)]));
    const parent=new Map<string,string>((rels??[]).map((r:{subject_staff_id:string;upline_staff_id:string})=>[r.subject_staff_id,r.upline_staff_id]));
    const children=new Map<string,string[]>(); for(const [child,p] of parent){children.set(p,[...(children.get(p)??[]),child]);}
    const descendants=(id:string)=>{const out:string[]=[];const seen=new Set([id]);const q=[...(children.get(id)??[])];while(q.length&&out.length<10000){const x=q.shift()!;if(seen.has(x))continue;seen.add(x);out.push(x);q.push(...(children.get(x)??[]));}return out;};
    const ancestors=(id:string)=>{const out:string[]=[];const seen=new Set([id]);let x=parent.get(id);while(x&&out.length<4&&!seen.has(x)){seen.add(x);out.push(x);x=parent.get(x);}return out;};
    const ownRole=auth.roleSlug; const seller=sellerRoles.includes(ownRole as SellerRole);
    const visible=new Set<string>(seller?(ownRole==='ost'?[auth.userId,...ancestors(auth.userId)]:[auth.userId,...ancestors(auth.userId),...descendants(auth.userId)]):(staff??[]).map((s:{id:string})=>s.id));
    const ostById=new Map((ost??[]).map((o:{id:string;status:Node['ostStatus']})=>[o.id,o.status]));
    const nodes:Node[]=(staff??[]).flatMap((s:{id:string;full_name:string;status:Node['status']})=>{const role=roleByStaff.get(s.id);if(!visible.has(s.id)||!sellerRoles.includes(role as SellerRole))return[];return [{staffId:s.id,fullName:s.full_name,role:role as SellerRole,status:s.status,ostStatus:ostById.get(s.id)??null,uplineStaffId:parent.get(s.id)??null,directDownlineCount:(children.get(s.id)??[]).length,totalDescendantCount:descendants(s.id).length}];});
    const path=subPath(req); if(path==='') return list(res,nodes);
    const match=path.match(/^([0-9a-f-]+)(?:\/(upline|downline|summary))?$/); if(!match)return fail(res,'NOT_FOUND','Genealogy endpoint not found',404);
    const id=match[1]!; if(!visible.has(id))return fail(res,'FORBIDDEN','Genealogy record is outside your authorized scope',403);
    const node=nodes.find(n=>n.staffId===id); if(!node)return fail(res,'NOT_FOUND','Seller not found',404);
    if(match[2]==='upline')return list(res,ancestors(id).map(x=>nodes.find(n=>n.staffId===x)).filter(Boolean));
    if(match[2]==='downline')return list(res,descendants(id).filter(x=>visible.has(x)).map(x=>nodes.find(n=>n.staffId===x)).filter(Boolean));
    if(match[2]==='summary'){const ids=descendants(id).filter(x=>visible.has(x));const members=ids.map(x=>nodes.find(n=>n.staffId===x)).filter((n):n is Node=>!!n);const roleCounts={vice_director:0,senior_sales_manager:0,sales_manager:0,ost:0};for(const n of members)roleCounts[n.role]++;return res.status(200).json({staffId:id,totalDirectDownline:node.directDownlineCount,totalDescendants:members.length,activeSellerCount:members.filter(n=>n.status==='active'&&(n.ostStatus===null||n.ostStatus==='active')).length,inactiveSellerCount:members.filter(n=>n.status!=='active'||(n.ostStatus!==null&&n.ostStatus!=='active')).length,roleCounts});}
    return res.status(200).json(node);
  }catch(error){console.error('[api] genealogy:',error instanceof Error?error.message:error);return fail(res,'INTERNAL','Internal server error',500);}
}
