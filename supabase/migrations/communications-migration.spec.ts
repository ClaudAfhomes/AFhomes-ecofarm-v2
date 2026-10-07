/**
 * Text-level pins for the AF Homes communications foundation migration.
 *
 * This spec lives beside the migration it guards, not in the `api` workspace,
 * because its subject IS the SQL file: column names, partial unique indexes,
 * the exact permission tuples, the widened idempotency registry, and the
 * privilege revokes. Those are properties of the file's text, so reading the
 * text is the only honest way to assert them - and it needs no database, so a
 * case can never pass because a database happened to be in the expected state.
 *
 * Run from the repository root (the api workspace has no vitest config and
 * cannot see this path):
 *   corepack pnpm --filter api exec vitest run --root .. \
 *     supabase/migrations/communications-migration.spec.ts
 *
 * The SQL itself is proven by EXECUTION in `pnpm test:db:local`, which applies
 * every migration to a disposable PostgreSQL. This file is the cheap guard
 * against a silent edit that would only fail there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '20261031000001_afhomes_communications_foundation.sql';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(HERE, MIGRATION), 'utf8');
/** SQL with `--` line comments stripped, so assertions judge code, not prose. */
const code = sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
/**
 * Whitespace-free view. Structural shapes (index definitions, CHECK arms, GRANT
 * signatures, tuple lists) are matched against this, because whether a space
 * follows a comma or an `=` is formatting, not meaning - and a test that fails
 * on a reformat is a test that gets deleted instead of fixed.
 */
const squash = (text: string): string => text.replace(/\s+/g, '');
/** True when `needle` appears in the migration up to whitespace. */
const declares = (needle: string): boolean => squash(code).includes(squash(needle));
/** Escape a literal for use inside a RegExp. */
const re = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TABLES = [
  'communication_conversations',
  'communication_conversation_members',
  'communication_messages',
  'communication_announcements',
  'communication_announcement_audiences',
  'communication_announcement_recipients',
  'notifications',
] as const;

const DISCOLUMNS = ['role_slug', 'department_id', 'staff_id'] as const;

/** Exact column list per table, in the order the migration declares them. */
const COLUMNS: Record<(typeof TABLES)[number], string[]> = {
  communication_conversations: [
    'id',
    'kind',
    'title',
    'created_by',
    'status',
    'direct_lowest',
    'direct_highest',
    'current_sequence',
    'created_at',
    'archived_at',
  ],
  communication_conversation_members: [
    'id',
    'conversation_id',
    'staff_id',
    'is_manager',
    'joined_sequence',
    'left_sequence',
    'last_read_sequence',
    'last_read_at',
    'joined_at',
    'left_at',
  ],
  communication_messages: [
    'id',
    'conversation_id',
    'sender_staff_id',
    'sender_full_name',
    'body',
    'sequence',
    'created_at',
  ],
  communication_announcements: [
    'id',
    'title',
    'body',
    'status',
    'created_by',
    'updated_by',
    'created_at',
    'updated_at',
    'published_at',
    'archived_at',
  ],
  communication_announcement_audiences: [
    'id',
    'announcement_id',
    'audience_kind',
    'role_slug',
    'department_id',
    'staff_id',
  ],
  communication_announcement_recipients: ['announcement_id', 'staff_id', 'published_at', 'read_at'],
  notifications: [
    'id',
    'recipient_staff_id',
    'notification_type',
    'title',
    'summary',
    'entity_type',
    'entity_id',
    'created_at',
    'read_at',
  ],
};

/** The one `create table if not exists` body for a table, or '' when absent. */
const tableBody = (name: string): string => {
  const start = code.search(new RegExp(`create table if not exists public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) return '';
  let depth = 0;
  for (let i = code.indexOf('(', start); i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return '';
};

/** Every `create or replace function` block, keyed by its declared name. */
const FN = (() => {
  const bodies = new Map<string, string>();
  const decl = /create or replace function public\.(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(code)) !== null) {
    const dollar = code.indexOf('$$', m.index);
    const end = dollar < 0 ? code.length : code.indexOf('$$', dollar + 2);
    bodies.set(m[1]!.toLowerCase(), code.slice(m.index, end < 0 ? code.length : end + 2));
  }
  return bodies;
})();

/** One SQL function body: header plus `$$ ... $$` payload. */
function fn(name: string): string {
  const body = FN.get(name);
  expect(body, `function public.${name} is missing`).toBeDefined();
  return body!;
}

/**
 * The parenthesised argument list of a function header, with any `default`
 * clauses stripped: GRANT takes the bare types, never the defaults.
 */
const argsOf = (name: string): string => {
  const header = fn(name);
  return (
    header
      .slice(header.indexOf('(') + 1, header.search(/\)\s*returns/))
      // GRANT names types, never parameter names or defaults.
      .split(',')
      .map((arg) =>
        arg
          .replace(/\s+default\s+[\s\S]*$/i, '')
          .trim()
          .split(/\s+/)
          .pop()!
          // `int` is an alias; GRANT is written with the canonical name.
          .replace(/^int$/i, 'integer'),
      )
      .join(',')
  );
};

const READ_FUNCTIONS = [
  'communication_visible_messages',
  'communication_unread_counts',
  'communication_announcement_feed',
] as const;
const MUTATING_FUNCTIONS = [
  'communication_create_conversation',
  'communication_add_member',
  'communication_remove_member',
  'communication_archive_conversation',
  'communication_send_message',
  'communication_mark_read',
  'communication_save_announcement',
  'communication_publish_announcement',
  'communication_archive_announcement',
  'communication_mark_announcement_read',
  'communication_mark_notification_read',
  'communication_mark_all_notifications_read',
] as const;

describe('the migration creates the seven tables with their exact columns', () => {
  it.each(TABLES)('declares public.%s idempotently', (table) => {
    expect(code).toMatch(new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'));
  });

  it.each(TABLES)('public.%s carries exactly the agreed columns', (table) => {
    const body = tableBody(table);
    expect(body, `no create table for ${table}`).not.toBe('');
    // Column definitions only. A table-level constraint shares the same
    // indentation, so those leading keywords are excluded by name.
    const TABLE_CONSTRAINTS = /^(constraint|primary|unique|check|foreign|exclude)$/;
    const declared = [...body.matchAll(/^\s{2}(\w+)\s+\w/gm)]
      .map((m) => m[1]!)
      .filter((name) => !TABLE_CONSTRAINTS.test(name));
    expect(declared).toEqual(COLUMNS[table]);
  });

  it('never cascades and never leaves a recipient unowned', () => {
    for (const table of TABLES) {
      for (const m of tableBody(table).matchAll(/on delete\s+(\w+)/gi)) {
        expect(m[1]!.toLowerCase(), `${table} must not cascade`).toBe('restrict');
      }
    }
    expect(tableBody('notifications')).toMatch(
      /recipient_staff_id\s+uuid\s+not null\s+references public\.staff_users\(id\)\s+on delete restrict/i,
    );
  });
});

describe('the invariants that make the model safe are real constraints', () => {
  it('has a direct-pair unique index and a one-open-interval unique index', () => {
    expect(
      declares(
        'create unique index if not exists communication_conversations_direct_pair_idx ' +
          "on public.communication_conversations (direct_lowest, direct_highest) where kind = 'direct'",
      ),
      'direct-pair partial unique',
    ).toBe(true);
    expect(
      declares(
        'create unique index if not exists communication_conversation_members_one_open_idx ' +
          'on public.communication_conversation_members (conversation_id, staff_id) where left_sequence is null',
      ),
      'one-open-interval partial unique',
    ).toBe(true);
  });

  it('keys messages by (conversation_id, sequence) and by a stable keyset', () => {
    expect(declares('unique (conversation_id, sequence)')).toBe(true);
    expect(
      declares(
        'create index if not exists communication_messages_keyset_idx ' +
          'on public.communication_messages (conversation_id, created_at desc, id desc)',
      ),
      'message keyset index',
    ).toBe(true);
    // The display snapshot is denormalized on purpose: a message must still
    // read correctly after a staff member is renamed.
    expect(tableBody('communication_messages')).toMatch(/sender_full_name\s+text\s+not null/i);
  });

  it('requires exactly one audience discriminator on every row', () => {
    const arms: Record<string, string[]> = {
      all_staff: [],
      role: ['role_slug'],
      department: ['department_id'],
      staff: ['staff_id'],
    };
    for (const [kind, present] of Object.entries(arms)) {
      const arm =
        `audience_kind = '${kind}' and ` +
        DISCOLUMNS.map((c) => (present.includes(c) ? `${c} is not null` : `${c} is null`)).join(
          ' and ',
        );
      expect(declares(arm), `audience_kind '${kind}' arm`).toBe(true);
    }
    expect(
      declares('unique (announcement_id, audience_kind, role_slug, department_id, staff_id)'),
    ).toBe(true);
  });

  it('makes a conversation either a direct pair or a titled group, never both', () => {
    expect(
      declares(
        "kind = 'direct' and direct_lowest is not null and direct_highest is not null " +
          'and direct_lowest < direct_highest and title is null',
      ),
      'direct arm',
    ).toBe(true);
    expect(
      declares(
        "kind = 'group' and direct_lowest is null and direct_highest is null and title is not null",
      ),
      'group arm',
    ).toBe(true);
    expect(tableBody('communication_conversations')).toMatch(
      /check \(title is null or char_length\(btrim\(title\)\) between 1 and 200\)/i,
    );
  });

  it('freezes announcement recipients and never lets a draft carry a publish stamp', () => {
    expect(declares("status = 'draft' and published_at is null")).toBe(true);
    expect(declares("status in ('published','archived') and published_at is not null")).toBe(true);
    expect(declares("status <> 'archived' or archived_at is not null")).toBe(true);
    expect(tableBody('communication_announcements')).toMatch(
      /check \(char_length\(btrim\(body\)\) between 1 and 10000\)/i,
    );
    expect(tableBody('communication_announcement_recipients')).toMatch(
      /published_at\s+timestamptz\s+not null/i,
    );
  });

  it('deduplicates notifications per recipient, type and entity, and indexes unread', () => {
    expect(declares('unique (recipient_staff_id, notification_type, entity_id)')).toBe(true);
    expect(
      declares(
        'create index if not exists notifications_unread_idx on public.notifications ' +
          '(recipient_staff_id) where read_at is null',
      ),
      'unread partial index',
    ).toBe(true);
    expect(
      declares(
        'create index if not exists notifications_recipient_idx on public.notifications ' +
          '(recipient_staff_id, created_at desc)',
      ),
      'recipient recency index',
    ).toBe(true);
    expect(tableBody('notifications')).toMatch(
      /notification_type text not null check \(notification_type in \('message','announcement','group_removal'\)\)/i,
    );
  });
});

describe('the modules and the approved permission matrix are installed', () => {
  it('upserts the three module rows under one Communications group', () => {
    expect(code).toMatch(/insert into public\.modules \(key, name, group_name, sort_order\)/i);
    for (const [key, name, order] of [
      ['communications.messages', 'Communications Messages', 110],
      ['communications.announcements', 'Communications Announcements', 111],
      ['communications.notifications', 'Communications Notifications', 112],
    ] as const) {
      expect(
        declares(`('${key}', '${name}', 'Communications', ${order})`),
        `module row ${key}`,
      ).toBe(true);
    }
    expect(declares('on conflict (key) do update set')).toBe(true);
  });

  it('installs exactly the 24 approved tuples and no others', () => {
    const expected = [
      ...['admin'].map((r) => [
        [r, 'messages', true, true, true],
        [r, 'announcements', true, true, true],
        [r, 'notifications', true, false, true],
      ]),
      ...['finance', 'hr', 'ost', 'employee'].map((r) => [
        [r, 'messages', true, true, false],
        [r, 'announcements', true, false, false],
        [r, 'notifications', true, false, true],
      ]),
      ...['vice_director', 'senior_sales_manager', 'sales_manager'].map((r) => [
        [r, 'messages', true, true, true],
        [r, 'announcements', true, false, false],
        [r, 'notifications', true, false, true],
      ]),
    ]
      .flat()
      .map(([r, m, v, c, u]) => `('${r}', 'communications.${m}', ${v}, ${c}, ${u}, false)`)
      .sort();

    // One tuple per line, exactly as the baseline file writes them. Anchored on
    // a role slug so the module rows above it are not mistaken for grants.
    const ROLES = 'admin|finance|hr|vice_director|senior_sales_manager|sales_manager|ost|employee';
    const actual = code
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter((line) =>
        new RegExp(`^\\('(?:${ROLES})', 'communications\\.\\w+', (?:true|false),`).test(line),
      )
      .map((line) => line.replace(/,$/, ''))
      .sort();
    expect(actual).toEqual(expected);
    expect(declares('on conflict (role_id, module_id) do update set')).toBe(true);
  });
});

describe('the idempotency registry is widened forward, never forked', () => {
  it('replaces the operation CHECK with a strict superset', () => {
    expect(
      declares(
        "check (operation in ('payment.create', 'application.create', 'reservation.create', " +
          "'conversation.create', 'message.send', 'announcement.publish'))",
      ),
      'widened operation check',
    ).toBe(true);
    expect(code).toMatch(/alter table private\.mutation_requests drop constraint/i);
    expect(
      declares(
        'alter table private.mutation_requests add constraint mutation_requests_operation_check',
      ),
    ).toBe(true);
    // Exactly one registry, unchanged shape: this file alters it and never
    // creates or extends it. The single create lives in 20261022000001.
    expect(code).not.toMatch(/create table[^;]*mutation_requests/i);
    expect(code).not.toMatch(/alter table private\.mutation_requests\s+add column/i);
    expect(
      code.match(/alter table private\.mutation_requests/gi),
      'the registry is altered, never rebuilt',
    ).toHaveLength(2);
  });
});

describe('browser roles hold nothing here', () => {
  it.each(TABLES)('public.%s has RLS on and zero privileges', (table) => {
    expect(
      declares(
        `alter table public.${table} enable row level security; ` +
          `revoke all on public.${table} from public, anon, authenticated;`,
      ),
      `public.${table} RLS + revoke`,
    ).toBe(true);
    expect(
      new RegExp(`grant [^;]* on public\\.${re(table)}[, ]`, 'i').test(code),
      `public.${table} must be granted to nobody`,
    ).toBe(false);
  });

  it.each([...READ_FUNCTIONS, ...MUTATING_FUNCTIONS])(
    'public.%s is security definer, path-pinned and service_role only',
    (name) => {
      const body = fn(name);
      expect(body, `${name} must be security definer`).toMatch(/security definer/i);
      expect(body, `${name} must pin its search_path`).toMatch(
        /set search_path\s*=\s*public,\s*private/i,
      );
      const args = argsOf(name);
      expect(
        declares(
          `revoke all on function public.${name}(${args}) from public, anon, authenticated; ` +
            `grant execute on function public.${name}(${args}) to service_role;`,
        ),
        `${name} grant pair`,
      ).toBe(true);
    },
  );

  it('never grants execute or privilege in bulk', () => {
    expect(code).not.toMatch(/execute\s+on\s+all\s+functions/i);
    expect(code).not.toMatch(/grant\s+all\b/i);
    expect(code).not.toMatch(/alter\s+default\s+privileges/i);
  });
});

describe('every mutating entry point re-validates the actor in SQL before writing', () => {
  it.each(MUTATING_FUNCTIONS.filter((n) => n !== 'communication_mark_read'))(
    'public.%s authorizes before its first write',
    (name) => {
      const body = fn(name);
      const guard = body.indexOf('private.mutation_actor_role');
      expect(guard, `${name} must call private.mutation_actor_role`).toBeGreaterThan(0);
      const firstWrite = body.search(/\b(insert\s+into|update\s+public|delete\s+from)\b/i);
      expect(firstWrite, `${name} writes before it authorizes`).toBeGreaterThan(guard);
    },
  );

  it('marks the conversation read only through its own membership row', () => {
    const body = squash(fn('communication_mark_read'));
    // The write is scoped to the actor's OWN open membership row, so one
    // member can never advance another member's read marker.
    expect(body).toContain(
      'updatepublic.communication_conversation_membersmemsetlast_read_sequence=greatest(mem.last_read_sequence,v_message.sequence)',
    );
    expect(body).toContain(
      'wheremem.conversation_id=p_conversationandmem.staff_id=p_actorandmem.left_sequenceisnull',
    );
    expect(body, 'read marking is not audited').not.toContain('auditevents');
  });

  it('takes the conversation lock first, before any other row lock', () => {
    for (const name of [
      'communication_add_member',
      'communication_remove_member',
      'communication_archive_conversation',
      'communication_send_message',
    ]) {
      const body = fn(name);
      const lock = body.search(
        /from public\.communication_conversations \w+\s+where \w+\.id = p_conversation for update/i,
      );
      expect(lock, `${name} must lock the conversation FOR UPDATE`).toBeGreaterThan(0);
      expect(
        body.search(/\binsert\s+into\b/i),
        `${name} must not insert before the conversation lock`,
      ).toBeGreaterThan(lock);
    }
    expect(fn('communication_publish_announcement')).toMatch(
      /from public\.communication_announcements \w+\s+where \w+\.id = p_announcement for update/i,
    );
  });

  it('filters message visibility by membership interval, then pages on the keyset', () => {
    const body = fn('communication_visible_messages');
    // The interval predicate lives in the WHERE of the paged CTE, so it
    // excludes messages BEFORE any row is numbered.
    const cte = body.slice(body.indexOf('page as ('), body.indexOf(')\n  select page.id'));
    expect(cte).toMatch(/mem\.joined_sequence <= m\.sequence/);
    expect(cte).toMatch(/\(mem\.left_sequence is null or m\.sequence < mem\.left_sequence\)/);
    // row_number is assigned inside the same CTE, over the interval-filtered set.
    expect(cte).toMatch(/row_number\(\) over \(order by m\.created_at desc, m\.id desc\)/);
    // has_more comes from over-fetching one row past the clamped page size.
    expect(body).toMatch(/page\.rn <= \(select n from lim\)/);
    expect(body).toMatch(/greatest\(1, *least\(100, *coalesce\(p_limit, *50\)\)\)/i);
  });

  it('freezes recipients at publish time and refuses an empty audience', () => {
    const body = fn('communication_publish_announcement');
    expect(body).toMatch(/insert into public\.communication_announcement_recipients/i);
    expect(body).toMatch(/on conflict \(announcement_id, staff_id\) do nothing/i);
    expect(body).toMatch(/raise exception 'ANNOUNCEMENT_NO_RECIPIENTS'/i);
    expect(body).toMatch(/s\.status = 'active'/i);
    expect(body).toMatch(/private\.mutation_result\(p_actor, *'announcement\.publish'/i);
    expect(body).toMatch(/private\.complete_mutation\(p_actor, *'announcement\.publish'/i);
  });

  it('closes the interval and raises exactly one removal notification', () => {
    const body = fn('communication_remove_member');
    expect(body).toMatch(
      /left_sequence = v_conversation\.current_sequence \+ 1, *left_at = now\(\)/i,
    );
    expect(body).toMatch(/insert into public\.notifications/i);
    expect(body).toMatch(/'group_removal', *'Removed from a conversation'/i);
    expect(body).toMatch(
      /on conflict \(recipient_staff_id, notification_type, entity_id\) do nothing/i,
    );
  });

  it('never lets a published or archived announcement be edited', () => {
    const body = fn('communication_save_announcement');
    expect(body).toMatch(/raise exception 'ANNOUNCEMENT_IMMUTABLE'/i);
    expect(body).toMatch(/insert into public\.communication_announcement_audiences/i);
    // Audiences are normalized rows: one insert, never a joined string.
    expect(body).not.toMatch(/string_agg/i);
  });
});

describe('auditing is bounded, append-only and complete for consequential writes', () => {
  const AUDITED = [
    'CONVERSATION_CREATED',
    'CONVERSATION_ARCHIVED',
    'CONVERSATION_MEMBER_ADDED',
    'CONVERSATION_MEMBER_REMOVED',
    'ANNOUNCEMENT_CREATED',
    'ANNOUNCEMENT_UPDATED',
    'ANNOUNCEMENT_PUBLISHED',
    'ANNOUNCEMENT_ARCHIVED',
  ] as const;

  it.each(AUDITED)('records %s from inside an audit_events insert', (action) => {
    // Only the write site counts: the same words appear as an exception name
    // (a refusal), so the assertion is on the VALUES list of the insert.
    const site = new RegExp(`insert into public\\.audit_events[^;]*'${action}'`, 'i');
    expect(site.test(code), `${action} must be written to audit_events`).toBe(true);
  });

  it('never audits a read, a message send or a notification read', () => {
    for (const name of [
      ...READ_FUNCTIONS,
      'communication_mark_read',
      'communication_mark_announcement_read',
      'communication_mark_notification_read',
      'communication_mark_all_notifications_read',
      'communication_send_message',
    ]) {
      expect(fn(name), `${name} must not audit`).not.toMatch(/audit_events/i);
    }
  });

  it('stores ids and bounded counts only, never content', () => {
    for (const name of [
      'communication_create_conversation',
      'communication_publish_announcement',
      'communication_save_announcement',
    ]) {
      for (const m of fn(name).matchAll(/insert into public\.audit_events[\s\S]*?;/gi)) {
        // A message body or announcement body in an audit payload would put
        // staff-authored content into the permanent append-only log.
        expect(m[0], `${name} audit payload`).not.toMatch(/\bp_body\b/i);
        expect(m[0], `${name} audit payload`).not.toMatch(/\bv_body\b/i);
      }
    }
  });
});

describe('nothing dangerous slipped in', () => {
  it('never cascades in the communications schema', () => {
    for (const m of code.matchAll(/on delete cascade/gi)) {
      expect(code.slice(Math.max(0, m.index - 200), m.index)).not.toMatch(
        /communication_|notifications/i,
      );
    }
  });

  it('never leaves a communications relation unqualified inside a returns-table function', () => {
    // A bare relation name inside a `returns table` function is exactly how
    // the verify_card_payment ambiguity bug happened in this repository: an
    // OUT parameter collided with a column and the predicate failed on every
    // call. Every reference must be schema-qualified and aliased.
    for (const [name, body] of FN) {
      if (!/returns table/i.test(body)) continue;
      for (const relation of [...TABLES, 'staff_users', 'roles', 'modules'] as const) {
        const stripped = body.replace(/public\.\w+/gi, 'QUALIFIED');
        expect(
          new RegExp(`\\b${relation}\\b`, 'i').test(stripped),
          `${name} references ${relation} unqualified`,
        ).toBe(false);
      }
      expect(body, `${name} must alias every base relation`).toMatch(/\bfrom public\.\w+ \w+/i);
    }
  });

  it('deletes only a draft audience it is replacing, never history', () => {
    expect(code).not.toMatch(/^\s*truncate\b/im);
    for (const m of code.matchAll(/delete\s+from\s+(public\.\w+)/gi)) {
      expect(m[1], `history table ${m[1]} must never be deleted from`).toBe(
        'public.communication_announcement_audiences',
      );
    }
  });

  it('keeps every statement idempotent', () => {
    expect(code).not.toMatch(/\bcreate table (?!if not exists)/i);
    expect(code).not.toMatch(/\bcreate (unique )?index (?!if not exists)/i);
    // Reconciliation inserts must name a conflict target, so re-applying the
    // file converges instead of duplicating.
    for (const m of code.matchAll(
      /insert into (public|private)\.(modules|role_permissions|communication_conversation_members|communication_announcement_audiences|communication_announcement_recipients|notifications)\b[\s\S]*?;/gi,
    )) {
      expect(m[0], `insert without a conflict clause: ${m[1]}`).toMatch(/on conflict/i);
    }
    // Creation inserts must NOT swallow a conflict: a second direct pair or a
    // reused message sequence is a real error the caller has to see, and the
    // request registry (not ON CONFLICT) is what makes those writes idempotent.
    for (const m of code.matchAll(
      /insert into public\.(communication_conversations|communication_messages|communication_announcements)\b[\s\S]*?;/gi,
    )) {
      expect(m[0], `insert must not hide a conflict: ${m[1]}`).not.toMatch(/on conflict/i);
    }
  });
});
