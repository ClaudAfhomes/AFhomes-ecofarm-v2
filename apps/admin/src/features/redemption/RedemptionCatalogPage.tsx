import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
} from '@jad/ui';
import {
  createRedemptionItemRequestSchema,
  type CreateRedemptionItemRequest,
  type RedemptionItem,
} from '@jad/contracts';

import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  createRedemptionItem,
  getRedemptionItems,
  updateRedemptionItem,
} from './services';
import styles from './RedemptionCatalog.module.css';

const EMPTY: CreateRedemptionItemRequest = {
  code: '',
  name: '',
  description: '',
  category: 'general',
  pointsCost: 0,
  sortOrder: 0,
};

/**
 * Redemption catalog administration.
 *
 * The catalog is DATABASE-BACKED, so no item is ever hardcoded in a component.
 * Editing an item's name or price changes what FUTURE redemptions cost and
 * nothing else: every redemption carries its own snapshot of the item, so history
 * cannot be rewritten from this screen.
 *
 * Items are DEACTIVATED, never deleted. A historical redemption must always be
 * able to resolve the item it was priced from, which is why there is no delete
 * control here at all.
 *
 * Requires `operations.catalog`; a redemption operator without it sees the list
 * and nothing else.
 */
export function RedemptionCatalogPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const [editing, setEditing] = useState<RedemptionItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [visibility, setVisibility] = useState<'active' | 'inactive' | 'all'>('all');
  // Live search: the catalog follows the settled term; submit applies instantly.
  void useDebouncedValue(search.trim(), 300, (term) => setAppliedSearch(term));

  const canManage =
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'operations.catalog' && (p.canCreate || p.canUpdate),
    ) === true;

  const items = useQuery({
    queryKey: ['redemption', 'items', 'all', appliedSearch, visibility],
    queryFn: () => getRedemptionItems(visibility, appliedSearch),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateRedemptionItem(id, { isActive }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['redemption', 'items'] }),
  });

  if (items.isLoading)
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)' }} role="status" aria-label="Loading the catalog">
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
        <Skeleton style={{ height: 48 }} />
      </div>
    );
  if (items.isError)
    return <ErrorState title="The catalog could not be loaded" onRetry={() => items.refetch()} />;

  return (
    <>
      <PageHeader
        title="Redemption Catalog"
        description="Items and services members can redeem with points. Prices are whole points, not currency."
        actions={
          canManage ? <Button onClick={() => setCreating(true)}>Add item</Button> : undefined
        }
      />

      {!canManage && (
        <p className={styles.readOnly}>
          You can view the catalog but not change it. Catalog management is a separate permission.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedSearch(search.trim());
        }}
      >
        <FilterBar
          search={
            <SearchField
              label="Search catalog items"
              placeholder="Name, code or category"
              value={search}
              onChange={setSearch}
            />
          }
          filters={
            <Select
              aria-label="Filter by status"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'active' | 'inactive' | 'all')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
          actions={
            <Button type="submit" variant="secondary">
              Search
            </Button>
          }
        />
      </form>

      {(items.data ?? []).length === 0 ? (
        <EmptyState
          title={appliedSearch || visibility !== 'all' ? 'No items match' : 'The catalog is empty'}
          description={
            appliedSearch || visibility !== 'all'
              ? 'Adjust the search or status filter.'
              : 'Add the first item members can redeem.'
          }
        />
      ) : (
        <div className="table-scroll">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col" className={styles.numeric}>
                Points cost
              </th>
              <th scope="col">Status</th>
              <th scope="col" className={styles.numeric}>
                Display order
              </th>
              {canManage && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((item) => (
              <tr key={item.id} className={item.isActive ? undefined : styles.inactive}>
                <td className={styles.mono}>{item.code}</td>
                <td>
                  {item.name}
                  {item.description && <span className={styles.description}>{item.description}</span>}
                </td>
                <td>{item.category}</td>
                <td className={styles.numeric}>{item.pointsCost.toLocaleString('en-PH')}</td>
                <td>
                  <StatusChip
                    label={item.isActive ? 'Active' : 'Inactive'}
                    tone={item.isActive ? 'success' : 'neutral'}
                  />
                </td>
                <td className={styles.numeric}>{item.sortOrder}</td>
                {canManage && (
                  <td>
                    <div className={styles.actions}>
                      <Button variant="secondary" onClick={() => setEditing(item)}>
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: item.id, isActive: !item.isActive })}
                      >
                        {item.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {creating && (
        <ItemDialog
          title="Add a redemption item"
          initial={EMPTY}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await createRedemptionItem(input);
            await client.invalidateQueries({ queryKey: ['redemption', 'items'] });
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <ItemDialog
          title={`Edit ${editing.name}`}
          initial={{
            code: editing.code,
            name: editing.name,
            description: editing.description ?? '',
            category: editing.category,
            pointsCost: editing.pointsCost,
            sortOrder: editing.sortOrder,
          }}
          codeLocked
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await updateRedemptionItem(editing.id, {
              name: input.name,
              description: input.description,
              category: input.category,
              pointsCost: input.pointsCost,
              sortOrder: input.sortOrder,
            });
            await client.invalidateQueries({ queryKey: ['redemption', 'items'] });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ItemDialog({
  title,
  initial,
  codeLocked = false,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: CreateRedemptionItemRequest;
  codeLocked?: boolean;
  onClose: () => void;
  onSubmit: (input: CreateRedemptionItemRequest) => Promise<void>;
}) {
  const [form, setForm] = useState<CreateRedemptionItemRequest>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: onSubmit,
    onSuccess: onClose,
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save.'),
  });
  const set = <K extends keyof CreateRedemptionItemRequest>(
    key: K,
    value: CreateRedemptionItemRequest[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open onClose={onClose} title={title} footer={<Button onClick={onClose}>Close</Button>}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          // Parse through the shared contract before sending, so the manager gets
          // the same validation the server will apply - and the code is normalised
          // to upper case on the wire rather than only in the database. The server
          // still re-validates: this is convenience, never the authority.
          const parsed = createRedemptionItemRequestSchema.safeParse(form);
          if (!parsed.success) {
            const first = parsed.error.issues[0];
            setError(
              first?.path.join('.') === 'pointsCost'
                ? 'An item must cost at least one point.'
                : (first?.message ?? 'Check the item details.'),
            );
            return;
          }
          setForm(parsed.data);
          save.mutate(parsed.data);
        }}
      >
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <label className={styles.label} htmlFor="item-code">
          Code
        </label>
        <input
          id="item-code"
          name="item-code"
          className={styles.input}
          value={form.code}
          disabled={codeLocked}
          onChange={(event) => set('code', event.target.value)}
          required
          minLength={2}
          maxLength={40}
        />
        {codeLocked && (
          <p className={styles.hint}>
            The code cannot change: historical redemptions reference it.
          </p>
        )}

        <label className={styles.label} htmlFor="item-name">
          Name
        </label>
        <input
          id="item-name"
          name="item-name"
          className={styles.input}
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          required
          minLength={2}
          maxLength={120}
        />

        <label className={styles.label} htmlFor="item-description">
          Description
        </label>
        <textarea
          id="item-description"
          name="item-description"
          className={styles.textarea}
          value={form.description ?? ''}
          onChange={(event) => set('description', event.target.value)}
          maxLength={500}
        />

        <label className={styles.label} htmlFor="item-category">
          Category
        </label>
        <input
          id="item-category"
          name="item-category"
          className={styles.input}
          value={form.category}
          onChange={(event) => set('category', event.target.value)}
          required
          maxLength={40}
        />

        <label className={styles.label} htmlFor="item-cost">
          Points cost
        </label>
        <input
          id="item-cost"
          name="item-cost"
          className={styles.input}
          type="number"
          min={1}
          max={1_000_000_000}
          step={1}
          value={form.pointsCost}
          onChange={(event) => set('pointsCost', Number(event.target.value) || 0)}
          required
        />
        <p className={styles.hint}>
          Whole points only. Changing this affects future redemptions; past ones keep the price they
          were charged.
        </p>

        <label className={styles.label} htmlFor="item-sort">
          Sort order
        </label>
        <input
          id="item-sort"
          name="item-sort"
          className={styles.input}
          type="number"
          min={0}
          max={9999}
          step={1}
          value={form.sortOrder}
          onChange={(event) => set('sortOrder', Number(event.target.value) || 0)}
        />

        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save item'}
        </Button>
      </form>
    </Dialog>
  );
}
