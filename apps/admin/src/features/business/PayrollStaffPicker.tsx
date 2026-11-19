import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PayrollRosterEntry } from '@afhomes/contracts';
import { SearchField, StatusChip } from '@afhomes/ui';

import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { getPayrollRoster, payrollKeys } from './services-payroll';
import styles from './IstPayrollPage.module.css';

interface Props {
  /** Staff already added; they stay visible but cannot be picked twice. */
  selectedIds: ReadonlySet<string>;
  onSelect: (entry: PayrollRosterEntry) => void;
}

/** Why an entry cannot be picked, or null. The server re-checks eligibility on run. */
const blockReason = (e: PayrollRosterEntry, selected: ReadonlySet<string>): string | null =>
  selected.has(e.id) ? 'Already added' : e.eligible ? null : (e.ineligibleReason ?? 'Not eligible');

/** Searchable IST staff picker (name, staff ID or AA number). Enter picks the first eligible match. */
export function PayrollStaffPicker({ selectedIds, onSelect }: Props) {
  const listId = useId();
  const [term, setTerm] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const q = useDebouncedValue(term.trim());
  const roster = useQuery({ queryKey: payrollKeys.roster(q), queryFn: () => getPayrollRoster(q) });

  const entries = roster.data ?? [];
  const pickable = entries.filter((e) => blockReason(e, selectedIds) === null);
  const active = pickable.find((e) => e.id === activeId) ?? pickable[0];

  const choose = (e: PayrollRosterEntry) => {
    if (blockReason(e, selectedIds) !== null) return;
    onSelect(e);
    setTerm('');
    setActiveId(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (active) choose(active);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (pickable.length === 0) return;
      const i = active ? pickable.indexOf(active) : 0;
      const next = (i + (event.key === 'ArrowDown' ? 1 : -1) + pickable.length) % pickable.length;
      setActiveId(pickable[next]!.id);
    }
  };

  return (
    <div className={styles.picker}>
      <SearchField
        id="sim-staff-search"
        label="Add staff"
        placeholder="Search name, staff ID or AA number"
        value={term}
        onChange={setTerm}
        busy={roster.isFetching}
        combobox={{
          controlsId: listId,
          expanded: true,
          activeOptionId: active ? `${listId}-${active.id}` : undefined,
          onKeyDown,
        }}
      />
      {roster.isError ? (
        <p className={styles.muted}>Could not load staff. Try again.</p>
      ) : roster.isSuccess && entries.length === 0 ? (
        <p className={styles.muted}>No matching staff.</p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Staff matches" className={styles.options}>
          {entries.map((e) => {
            const reason = blockReason(e, selectedIds);
            return (
              <li
                key={e.id}
                id={`${listId}-${e.id}`}
                role="option"
                aria-selected={active?.id === e.id}
                aria-disabled={reason !== null}
                className={styles.option}
                onClick={() => choose(e)}
              >
                <strong>{e.name ?? 'Unnamed staff'}</strong>
                <StatusChip label={e.rank} tone="neutral" />
                {e.aaNumber ? <span className={styles.muted}>{e.aaNumber}</span> : null}
                {reason ? <span className={styles.muted}>{reason}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
