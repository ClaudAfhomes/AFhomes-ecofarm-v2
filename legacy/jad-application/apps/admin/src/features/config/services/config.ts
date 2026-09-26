import { programAdminSchema, programSchema, systemConfigEntrySchema } from '@jad/contracts';
import type {
  Program,
  ProgramAdmin,
  ProgramCreateRequest,
  ProgramUpdateRequest,
  SystemConfigEntry,
} from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** GET /admin/config - full parameter list (mock server serves fixtures in dev/test). */
export function getConfig(): Promise<SystemConfigEntry[]> {
  return requestList('/admin/config', systemConfigEntrySchema);
}

/** GET /programs - shared active program list (public endpoint). */
export function getPrograms(): Promise<Program[]> {
  return requestList('/programs', programSchema);
}

/** GET /admin/programs - all programs incl. inactive (super_admin). */
export function getAdminPrograms(): Promise<ProgramAdmin[]> {
  return requestList('/admin/programs', programAdminSchema);
}

/** POST /admin/programs - create a program (super_admin). */
export function createProgram(input: ProgramCreateRequest): Promise<ProgramAdmin> {
  return request('/admin/programs', programAdminSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /admin/programs/:id - edit or retire a program (super_admin). */
export function updateProgram(id: string, patch: ProgramUpdateRequest): Promise<ProgramAdmin> {
  return request(`/admin/programs/${id}`, programAdminSchema, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** PATCH /admin/config/:key - super_admin-only parameter update (audited server-side). */
export function updateConfig(key: string, value: string): Promise<SystemConfigEntry> {
  return request(`/admin/config/${encodeURIComponent(key)}`, systemConfigEntrySchema, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}
