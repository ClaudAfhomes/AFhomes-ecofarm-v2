import { useMemo,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState,ErrorState,FilterBar,PageHeader,SearchField,Select,StatusChip } from '@jad/ui';
import { getGenealogy } from './services';

export function GenealogyPage(){
 const query=useQuery({queryKey:['genealogy'],queryFn:getGenealogy}); const [search,setSearch]=useState('');const [role,setRole]=useState('all');const [status,setStatus]=useState('all');
 const rows=useMemo(()=>(query.data??[]).filter(n=>(role==='all'||n.role===role)&&(status==='all'||n.status===status)&&n.fullName.toLowerCase().includes(search.toLowerCase())),[query.data,search,role,status]);
 return <section><PageHeader title="Sales Network" description="Authorized VD to SSM to SM to OST genealogy. Historical sales attribution is unchanged."/><FilterBar search={<SearchField label="Search genealogy" placeholder="Search seller" value={search} onChange={setSearch}/>} filters={<><Select aria-label="Filter role" value={role} onChange={e=>setRole(e.target.value)} options={['all','vice_director','senior_sales_manager','sales_manager','ost'].map(v=>({value:v,label:v.replace(/_/g,' ')}))}/><Select aria-label="Filter status" value={status} onChange={e=>setStatus(e.target.value)} options={['all','active','inactive','invited','suspended'].map(v=>({value:v,label:v}))}/></>}/>{query.isPending?<p role="status">Loading genealogy…</p>:query.isError?<ErrorState error={query.error} onRetry={query.refetch}/>:rows.length===0?<EmptyState title="No sellers found" description="Adjust the current filters."/>:<div className="table-scroll"><table><thead><tr><th>Seller</th><th>Role</th><th>Status</th><th>Direct</th><th>Total</th></tr></thead><tbody>{rows.map(n=><tr key={n.staffId}><td><Link to={`/admin/genealogy/${n.staffId}`}>{n.fullName}</Link></td><td>{n.role.replace(/_/g,' ')}</td><td><StatusChip label={n.ostStatus??n.status} tone={n.status==='active'&&(n.ostStatus===null||n.ostStatus==='active')?'success':'neutral'}/></td><td>{n.directDownlineCount}</td><td>{n.totalDescendantCount}</td></tr>)}</tbody></table></div>}</section>;
}
