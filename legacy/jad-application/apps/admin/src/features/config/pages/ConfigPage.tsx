import { useState } from 'react';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Icon,
  PageHeader,
  Skeleton,
} from '@jad/ui';
import { formatMoney } from '@jad/shared';
import type { ProgramAdmin, SystemConfigEntry } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { useConfig } from '../hooks/useConfig';
import { useUpdateConfig } from '../hooks/useUpdateConfig';
import { usePrograms } from '../hooks/usePrograms';
import { useAdminPrograms } from '../hooks/useAdminPrograms';
import { ProgramFormDialog } from '../components/ProgramFormDialog';
import styles from './ConfigPage.module.css';

/**
 * Config value kinds. Most parameters are numeric, but list-valued rows such
 * as Gender Options (`GENDERS`, a JSON array) must stay editable as text -
 * forcing `Number()` on every row disables Save for them (reported bug).
 */
function isGenderOptionsKey(key: string): boolean {
  return key === 'GENDERS';
}

function isNumericKey(key: string): boolean {
  return (
    key.includes('COMMISSION') ||
    key.includes('RATE') ||
    key.includes('WITHDRAWAL_AMOUNT') ||
    key.includes('MIN_AGE') ||
    key.includes('SALES') ||
    key.includes('ATTEMPTS') ||
    key.includes('EXPIRY')
  );
}

/** Parse a stored JSON string list (e.g. `["Male","Female","Others"]`); null when malformed. */
function parseJsonList(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed as string[];
    }
    return null;
  } catch {
    return null;
  }
}

/** Split a comma-separated edit into trimmed, non-empty items. */
function parseCommaList(rawValue: string): string[] {
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formatValue(key: string, value: string): string {
  if (isGenderOptionsKey(key)) {
    return parseJsonList(value)?.join(', ') ?? value;
  }
  if (key.includes('COMMISSION') || key.includes('RATE')) {
    const num = Number(value);
    if (!Number.isNaN(num)) return `${(num * 100).toFixed(2)}%`;
  }
  if (key.includes('WITHDRAWAL_AMOUNT')) {
    const num = Number(value);
    if (!Number.isNaN(num)) return formatMoney(value);
  }
  if (key.includes('EXPIRY')) return `${value} days`;
  return value;
}

function parseDisplayValue(key: string, value: string): string {
  if (isGenderOptionsKey(key)) {
    return parseJsonList(value)?.join(', ') ?? value;
  }
  if (key.includes('COMMISSION') || key.includes('RATE')) {
    const num = Number(value);
    if (!Number.isNaN(num)) return (num * 100).toFixed(2);
  }
  return value;
}

function validateEntry(key: string, rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return 'Value is required';

  if (isGenderOptionsKey(key)) {
    if (parseCommaList(trimmed).length === 0) return 'Enter at least one option';
    return null;
  }

  // Unknown keys are plain text - only the known numeric parameters require numbers.
  if (!isNumericKey(key)) return null;

  const num = Number(trimmed);
  if (Number.isNaN(num)) return 'Must be a number';

  if (key.includes('COMMISSION') || key.includes('RATE')) {
    if (num < 0 || num > 100) return 'Rate must be between 0 and 100';
  }
  if (key.includes('WITHDRAWAL_AMOUNT')) {
    if (num < 0) return 'Amount cannot be negative';
  }
  if (key.includes('MIN_AGE')) {
    if (!Number.isInteger(num) || num < 1) return 'Must be a positive integer';
  }
  if (key.includes('SALES') || key.includes('ATTEMPTS')) {
    if (!Number.isInteger(num) || num < 1) return 'Must be a positive integer';
  }
  if (key.includes('EXPIRY')) {
    if (!Number.isInteger(num) || num < 1) return 'Must be a positive integer';
  }
  return null;
}

function formatSaveValue(key: string, rawValue: string): string {
  if (isGenderOptionsKey(key)) {
    return JSON.stringify(parseCommaList(rawValue.trim()));
  }
  const num = Number(rawValue.trim());
  if (key.includes('COMMISSION') || key.includes('RATE')) {
    return (num / 100).toFixed(4);
  }
  if (key.includes('WITHDRAWAL_AMOUNT')) {
    return num.toFixed(2);
  }
  return rawValue.trim();
}

const CATEGORY_ICONS: Record<string, 'wallet' | 'user-check' | 'check' | 'info'> = {
  Commissions: 'wallet',
  Withdrawals: 'wallet',
  Qualification: 'user-check',
  Registration: 'user-check',
  Sales: 'check',
  Vouchers: 'info',
};

function ConfigSkeleton() {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={styles.categoryCard}>
          <Skeleton className={styles.skeletonTitle} />
          {Array.from({ length: 3 }, (_, j) => (
            <Skeleton key={j} className={styles.skeletonRow} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ProgramsSkeleton() {
  return (
    <div className={styles.programsGrid}>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className={styles.programCard}>
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonRow} />
        </div>
      ))}
    </div>
  );
}

export function ConfigPage() {
  const { data, isPending, isError, error, refetch } = useConfig();
  const { user } = useSession();
  const updateMutation = useUpdateConfig();

  // Config writes are super_admin-only server-side (PATCH /admin/config/:key);
  // other staff roles get a read-only view.
  const canEdit = user?.roleId === 'super_admin';

  // Super admins see every program (incl. retired) so they can reactivate;
  // other roles get the public active-only list.
  const adminProgramsQuery = useAdminPrograms({ enabled: canEdit });
  const publicProgramsQuery = usePrograms({ enabled: !canEdit });
  const programs = canEdit ? adminProgramsQuery.data : publicProgramsQuery.data;
  const programsPending = canEdit ? adminProgramsQuery.isPending : publicProgramsQuery.isPending;

  const [editing, setEditing] = useState<SystemConfigEntry | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<ProgramAdmin | null>(null);

  const entries = data ?? [];

  const categories = (() => {
    const grouped = new Map<string, SystemConfigEntry[]>();
    for (const entry of entries) {
      const list = grouped.get(entry.category) ?? [];
      list.push(entry);
      grouped.set(entry.category, list);
    }
    return Array.from(grouped.entries());
  })();

  function openEdit(entry: SystemConfigEntry) {
    setEditing(entry);
    setEditValue(parseDisplayValue(entry.key, entry.value));
    setEditError(null);
    setSaveError(null);
    setHasInteracted(false);
  }

  function closeEdit() {
    setEditing(null);
    setSaveError(null);
    updateMutation.reset();
  }

  async function handleSave() {
    if (!editing) return;
    const error = validateEntry(editing.key, editValue);
    if (error) {
      setEditError(error);
      return;
    }
    setSaveError(null);
    try {
      await updateMutation.mutateAsync({
        key: editing.key,
        value: formatSaveValue(editing.key, editValue),
      });
      setEditing(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  return (
    <section>
      <PageHeader
        title="System Configuration"
        description="Manage platform parameters, commission rates, and qualification programs."
      />

      {isPending ? (
        <ConfigSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No configuration"
          description="No system parameters have been configured yet."
        />
      ) : (
        <div className={styles.grid}>
          {categories.map(([category, categoryEntries]) => (
            <div key={category} className={styles.categoryCard}>
              <div className={styles.categoryHeader}>
                <Icon
                  name={CATEGORY_ICONS[category] ?? 'info'}
                  size={18}
                  className={styles.categoryIcon}
                  aria-hidden="true"
                />
                <h2 className={styles.categoryTitle}>{category}</h2>
              </div>
              <dl className={styles.definitionList}>
                {categoryEntries.map((entry) => (
                  <div key={entry.key} className={styles.entry}>
                    <div className={styles.entryRow}>
                      <div className={styles.entryContent}>
                        <dt className={styles.entryLabel}>{entry.label}</dt>
                        <dd className={styles.entryValue}>{formatValue(entry.key, entry.value)}</dd>
                      </div>
                      {canEdit ? (
                        <IconButton
                          icon="pencil"
                          label={`Edit ${entry.label}`}
                          onClick={() => openEdit(entry)}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Programs</h2>
            <p className={styles.sectionDescription}>
              Qualification programs that define registration tracks and member eligibility. They
              appear publicly on the Contact form, registration, and policy pages.
            </p>
          </div>
          {canEdit ? (
            <Button
              onClick={() => {
                setEditingProgram(null);
                setProgramDialogOpen(true);
              }}
            >
              New program
            </Button>
          ) : null}
        </div>

        {programsPending ? (
          <ProgramsSkeleton />
        ) : programs && programs.length > 0 ? (
          <div className={styles.programsGrid}>
            {programs.map((program) => (
              <div key={program.id} className={styles.programCard}>
                <div className={styles.programHeader}>
                  <h3 className={styles.programName}>{program.name}</h3>
                  <span className={styles.programCode}>{program.code}</span>
                </div>
                {program.description && (
                  <p className={styles.programDescription}>{program.description}</p>
                )}
                {canEdit && 'isActive' in program && !program.isActive ? (
                  <span className={styles.programInactive}>
                    Inactive - hidden from the public site
                  </span>
                ) : null}
                {canEdit ? (
                  <div className={styles.programActions}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingProgram(program as ProgramAdmin);
                        setProgramDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No programs"
            description="No qualification programs have been configured."
          />
        )}
      </div>

      <ProgramFormDialog
        open={programDialogOpen}
        program={editingProgram}
        onClose={() => {
          setProgramDialogOpen(false);
          setEditingProgram(null);
        }}
      />

      <Dialog
        open={editing !== null}
        onClose={closeEdit}
        title={`Edit ${editing?.label ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={closeEdit}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={hasInteracted && editError !== null}
              loading={updateMutation.isPending}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <label className={styles.editField}>
            <span className={styles.editLabel}>Value</span>
            <input
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                setHasInteracted(true);
                setEditError(validateEntry(editing.key, e.target.value));
              }}
              className={styles.editInput}
              data-autofocus
            />
            {editError && <span className={styles.editError}>{editError}</span>}
            {saveError && (
              <span role="alert" className={styles.editError}>
                {saveError}
              </span>
            )}
            <span className={styles.editHint}>
              {isGenderOptionsKey(editing.key)
                ? 'Comma-separated gender options (e.g. Male, Female, Others)'
                : editing.key.includes('COMMISSION') || editing.key.includes('RATE')
                  ? 'Enter as percentage (e.g. 8 for 8%)'
                  : editing.key.includes('WITHDRAWAL_AMOUNT')
                    ? 'Enter amount in PHP'
                    : 'Enter the numeric value'}
            </span>
          </label>
        )}
      </Dialog>
    </section>
  );
}
