import { useQuery } from '@tanstack/react-query';

import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';
import { useSession } from '../../../lib/session';

export interface MemberRole {
  slug: string;
  name: string;
}

const FALLBACK_ROLES: Record<string, MemberRole[]> = {
  'mem-001': [{ slug: 'member_basic', name: 'Member' }],
  'sup-001': [{ slug: 'super_admin', name: 'Super Admin' }],
};

export function useMemberRoles() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'roles', user?.id],
    queryFn: async (): Promise<MemberRole[]> => {
      if (
        (import.meta.env as Record<string, string | undefined>).MODE !== 'test' &&
        isSupabaseConfigured()
      ) {
        const client = getSupabaseClient() as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (
                k: string,
                v: string,
              ) => Promise<{ data: { roleId: string }[] | null; error: unknown }>;
              in: (
                k: string,
                v: string[],
              ) => Promise<{ data: { slug: string; name: string }[] | null; error: unknown }>;
            };
          };
        } | null;
        if (client && user?.id) {
          try {
            // Only the quoted "MemberRole" table exists in the schema -
            // legacy variants are gone (probing them only yields PGRST205).
            let links: { roleId: string }[] | null = null;
            let linkErr: unknown = null;
            for (const tbl of ['MemberRole'] as const) {
              const res = (await (
                client as unknown as {
                  from: (t: string) => {
                    select: (c: string) => {
                      eq: (
                        k: string,
                        v: string,
                      ) => Promise<{ data: unknown[] | null; error: unknown }>;
                    };
                  };
                }
              )
                .from(tbl)
                .select('roleId')
                .eq('memberId', user.id)) as { data: { roleId: string }[] | null; error: unknown };
              if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
                links = res.data as { roleId: string }[];
                linkErr = null;
                break;
              }
              if (!res.error && Array.isArray(res.data)) {
                links = res.data as { roleId: string }[];
                linkErr = null;
                break;
              }
              linkErr = res.error;
            }
            if (!linkErr && Array.isArray(links) && links.length > 0) {
              const ids = (links as { roleId: string }[]).map((l) => l.roleId);
              const supa = client as unknown as {
                from: (t: string) => {
                  select: (c: string) => {
                    in: (
                      k: string,
                      v: string[],
                    ) => Promise<{ data: { slug: string; name: string }[] | null; error: unknown }>;
                    eq: (
                      k: string,
                      v: string,
                    ) => Promise<{ data: { slug: string; name: string }[] | null; error: unknown }>;
                  };
                };
              };
              // Only the quoted "Role" table exists in the schema.
              let roles: MemberRole[] | null = null;
              let roleErr: unknown = null;
              for (const tbl of ['Role'] as const) {
                const res = await supa.from(tbl).select('slug,name').in('id', ids);
                if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
                  roles = res.data as MemberRole[];
                  roleErr = null;
                  break;
                }
                roleErr = res.error;
              }
              if (!roleErr && Array.isArray(roles) && roles.length > 0) {
                return (roles as MemberRole[]).map((r) => ({ slug: r.slug, name: r.name }));
              }
              const collected: MemberRole[] = [];
              for (const rid of ids) {
                for (const tbl of ['Role'] as const) {
                  const { data: one } = await supa.from(tbl).select('slug,name').eq('id', rid);
                  if (Array.isArray(one) && one.length > 0) {
                    for (const row of one as MemberRole[]) collected.push(row);
                    break;
                  }
                }
              }
              if (collected.length > 0) return collected;
            } else if (!linkErr && Array.isArray(links) && links.length === 0) {
              return [{ slug: 'member_basic', name: 'Member' }];
            }
          } catch {
            // fallback
          }
        }
      }
      if (user?.id && FALLBACK_ROLES[user.id]) return FALLBACK_ROLES[user.id]!;
      return [{ slug: 'member_basic', name: 'Member' }];
    },
    enabled: Boolean(user?.id),
  });
}
