import { genealogyNodeSchema,genealogySummarySchema } from '@afhomes/contracts';
import { protectedRequest as request,protectedRequestList as requestList } from '../../lib/api/client';
export const getGenealogy=()=>requestList('/genealogy',genealogyNodeSchema);
export const getGenealogyNode=(id:string)=>request(`/genealogy/${id}`,genealogyNodeSchema);
export const getGenealogyUpline=(id:string)=>requestList(`/genealogy/${id}/upline`,genealogyNodeSchema);
export const getGenealogyDownline=(id:string)=>requestList(`/genealogy/${id}/downline`,genealogyNodeSchema);
export const getGenealogySummary=(id:string)=>request(`/genealogy/${id}/summary`,genealogySummarySchema);
