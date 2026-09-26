import type { ProgramAdmin } from '@jad/contracts';

import { MOCK_PROGRAMS } from './data';

/**
 * In-memory mock store for admin Programs (FR-PRG-001). Public `GET /programs`
 * returns active rows only; `/admin/programs` (super_admin) returns all rows so
 * a retired program can be reactivated. Production reads/writes the real
 * endpoint - this is a test double only.
 */
export const MOCK_ADMIN_PROGRAMS: ProgramAdmin[] = MOCK_PROGRAMS.map((program) => ({
  ...program,
  isActive: true,
}));

let programSeq = MOCK_ADMIN_PROGRAMS.length + 1;

export const programStore: { items: ProgramAdmin[] } = {
  items: MOCK_ADMIN_PROGRAMS.map((program) => ({ ...program })),
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetProgramStore(): void {
  programStore.items = MOCK_ADMIN_PROGRAMS.map((program) => ({ ...program }));
  programSeq = MOCK_ADMIN_PROGRAMS.length + 1;
}

export function createStoreProgram(input: {
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
}): ProgramAdmin {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new Error('A program code is required.');
  if (!name) throw new Error('A program name is required.');
  if (programStore.items.some((p) => p.code === code)) {
    throw new Error('A program with that code already exists.');
  }
  const item: ProgramAdmin = {
    id: `prg-mock-${Date.now().toString(36)}-${programSeq++}`,
    code,
    name,
    ...(input.description?.trim() && { description: input.description.trim() }),
    isActive: input.isActive ?? true,
  };
  programStore.items.push(item);
  return item;
}

export function updateStoreProgram(
  id: string,
  patch: { code?: string; name?: string; description?: string; isActive?: boolean },
): ProgramAdmin | undefined {
  const item = programStore.items.find((p) => p.id === id);
  if (!item) return undefined;
  if (typeof patch.code === 'string' && patch.code.trim()) {
    const code = patch.code.trim().toUpperCase();
    if (programStore.items.some((p) => p.id !== id && p.code === code)) {
      throw new Error('A program with that code already exists.');
    }
    item.code = code;
  }
  if (typeof patch.name === 'string' && patch.name.trim()) item.name = patch.name.trim();
  if (typeof patch.description === 'string')
    item.description = patch.description.trim() || undefined;
  if (typeof patch.isActive === 'boolean') item.isActive = patch.isActive;
  return item;
}
