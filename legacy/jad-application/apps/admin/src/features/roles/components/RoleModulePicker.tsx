import { useCallback } from 'react';

import { STAFF_MODULE_LABEL } from '@jad/contracts';
import type { StaffModule } from '@jad/contracts';

import { MODULE_GROUPS } from '../modules';

type Props = {
  selected: StaffModule[];
  onChange: (next: StaffModule[]) => void;
  disabled?: boolean;
  showGlobalActions?: boolean;
  /**
   * Modules the picker must never select (governance on custom roles - the
   * server rejects them, and their endpoints are super_admin-only). Rendered
   * disabled and excluded from the select-all actions.
   */
  lockedModules?: readonly StaffModule[];
};

function toggle(list: StaffModule[], module: StaffModule): StaffModule[] {
  return list.includes(module) ? list.filter((m) => m !== module) : [...list, module];
}

const ALL_MODULES: StaffModule[] = MODULE_GROUPS.flatMap((g) => g.modules);

/** Grouped module checkbox grid for role create/edit forms. */
export function RoleModulePicker({
  selected,
  onChange,
  disabled,
  showGlobalActions,
  lockedModules,
}: Props) {
  const locked = new Set<StaffModule>(lockedModules ?? []);
  const selectable = ALL_MODULES.filter((m) => !locked.has(m));
  // Indeterminate state cannot be set via JSX props - sync it on mount/update.
  const groupToggleRef = useCallback(
    (groupModules: StaffModule[]) => (el: HTMLInputElement | null) => {
      if (!el) return;
      const count = groupModules.filter((m) => selected.includes(m)).length;
      el.indeterminate = count > 0 && count < groupModules.length;
    },
    [selected],
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {showGlobalActions ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onChange([...selectable])}
            disabled={disabled || selectable.every((m) => selected.includes(m))}
            aria-label="Select all modules"
            style={{
              padding: '6px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-pill)',
              background: 'transparent',
              fontSize: 'var(--text-body-s)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled || selected.length === 0}
            aria-label="Clear all modules"
            style={{
              padding: '6px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-pill)',
              background: 'transparent',
              fontSize: 'var(--text-body-s)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
      {MODULE_GROUPS.map((group) => {
        const groupSelected = group.modules.filter((m) => selected.includes(m));
        const groupSelectable = group.modules.filter((m) => !locked.has(m));
        const allChecked =
          groupSelectable.length > 0 && groupSelectable.every((m) => selected.includes(m));
        return (
          <fieldset
            key={group.label}
            disabled={disabled}
            style={{
              margin: 0,
              padding: 'var(--space-3) var(--space-4)',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <legend
              style={{
                padding: '0 var(--space-2)',
                fontSize: 'var(--text-body-s)',
                fontWeight: 600,
              }}
            >
              <label
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  ref={groupToggleRef(group.modules)}
                  checked={allChecked}
                  onChange={() => {
                    const rest = selected.filter((m) => !group.modules.includes(m));
                    onChange(allChecked ? rest : [...rest, ...groupSelectable]);
                  }}
                  aria-label={`Select all ${group.label} modules`}
                  style={{ width: 16, height: 16 }}
                />
                {group.label} · {groupSelected.length} of {group.modules.length}
              </label>
            </legend>
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}
            >
              {group.modules.map((module) => (
                <label
                  key={module}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(module)}
                    disabled={locked.has(module)}
                    onChange={() => onChange(toggle(selected, module))}
                    aria-label={STAFF_MODULE_LABEL[module]}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: 'var(--text-body-s)' }}>
                    {STAFF_MODULE_LABEL[module]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
