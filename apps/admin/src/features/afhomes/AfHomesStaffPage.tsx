import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  Icon,
  notifySuccess,
  PageHeader,
  Pagination,
  PasswordField,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import { PERSON_NAME_RE, groupedModuleCatalog, type AfHomesStaff } from '@afhomes/contracts';
import { normalizeLiveHumanField } from '../../lib/normalize';
import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './AfHomesStaffPage.module.css';
import {
  createAfHomesStaff,
  deactivateAfHomesStaff,
  deleteAfHomesStaff,
  getAfHomesDepartments,
  getAfHomesRoles,
  getAfHomesStaff,
  isTestStaffEmail,
  purgeTestAfHomesStaff,
  updateAfHomesStaff,
} from './services';

const PAGE_SIZE = 10;

type Restriction = AfHomesStaff['restrictions'][number];

function statusTone(status: AfHomesStaff['status']): 'success' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral';
}

export function AfHomesStaffPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const staff = useQuery({
    queryKey: ['afhomes', 'staff'],
    queryFn: getAfHomesStaff,
    // Refetches keep the previous directory visible instead of blanking it.
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({
    queryKey: ['afhomes', 'roles'],
    queryFn: getAfHomesRoles,
    placeholderData: keepPreviousData,
  });
  const departments = useQuery({
    queryKey: ['afhomes', 'departments'],
    queryFn: getAfHomesDepartments,
    placeholderData: keepPreviousData,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editing, setEditing] = useState<AfHomesStaff | null>(null);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  // Same disclosure pattern as the role access dialog: group dropdowns, opened
  // for groups where an override is already set (and reset per member below).
  const [expandedRestrictionGroups, setExpandedRestrictionGroups] = useState<Set<string>>(
    new Set(),
  );
  const toggleRestrictionGroup = (group: string) =>
    setExpandedRestrictionGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete';
    staff: AfHomesStaff;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<AfHomesStaff | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const canPurgeTest = user?.roleSlug === 'super_admin' && user.testPurgeEnabled === true;

  const resetCreate = () => {
    setFullName('');
    setEmail('');
    setRoleId('');
    setDepartmentId('');
    setTemporaryPassword('');
    setConfirmPassword('');
  };

  const createErrors = useMemo(() => {
    const errors: {
      fullName?: string;
      email?: string;
      temporaryPassword?: string;
      confirmPassword?: string;
    } = {};
    if (fullName && !PERSON_NAME_RE.test(fullName.trim()))
      errors.fullName = 'Use letters, spaces, apostrophes and hyphens only - no numbers.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = 'Enter a valid email address.';
    if (temporaryPassword && temporaryPassword.length < 8)
      errors.temporaryPassword = 'Use at least 8 characters.';
    if (confirmPassword && temporaryPassword !== confirmPassword)
      errors.confirmPassword = 'Passwords do not match.';
    return errors;
  }, [fullName, email, temporaryPassword, confirmPassword]);
  const createValid =
    fullName.trim().length > 0 &&
    PERSON_NAME_RE.test(fullName.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    roleId.length > 0 &&
    temporaryPassword.length >= 8 &&
    temporaryPassword === confirmPassword;

  const create = useBusinessMutation({
    mutationFn: () =>
      createAfHomesStaff({
        fullName: fullName.trim(),
        email: email.trim(),
        roleId,
        departmentId: departmentId || null,
        temporaryPassword,
      }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setCreateOpen(false);
      resetCreate();
      notifySuccess({
        title: 'Staff member created',
        message: `${created.fullName} was added with an ACTIVE status.`,
      });
    },
  });
  const update = useBusinessMutation({
    mutationFn: () => updateAfHomesStaff(editing!.id, { restrictions }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setEditing(null);
    },
  });
  const changeAccount = useBusinessMutation({
    mutationFn: async () => {
      if (accountAction?.kind === 'delete') await deleteAfHomesStaff(accountAction.staff.id);
      else await deactivateAfHomesStaff(accountAction!.staff.id);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setAccountAction(null);
      setConfirmation('');
    },
  });
  const purgeTestAccount = useBusinessMutation({
    mutationFn: () => purgeTestAfHomesStaff(purgeTarget!.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['afhomes', 'staff'] });
      setPurgeTarget(null);
      setPurgeConfirmation('');
    },
  });
  const filtered = useMemo(
    () =>
      staff.data?.filter(
        (item) =>
          (status === 'all' || item.status === status) &&
          (roleFilter === 'all' || item.roleId === roleFilter) &&
          `${item.fullName} ${item.email} ${item.employeeNumber ?? ''} ${item.salesNumber ?? ''}`
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()),
      ) ?? [],
    [staff.data, status, roleFilter, debouncedSearch],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeRoles = roles.data?.filter((role) => role.isActive && role.slug !== 'customer') ?? [];
  const selectedRole = activeRoles.find((role) => role.id === roleId);
  const selectedRoleDescription = selectedRole
    ? selectedRole.description?.trim() || `${selectedRole.assignedCount} staff hold this role.`
    : null;
  const filtersActive = search !== '' || status !== 'all' || roleFilter !== 'all';
  const openRestrictions = (member: AfHomesStaff) => {
    const role = roles.data?.find((item) => item.id === member.roleId);
    const next = (role?.permissions ?? [])
      .filter((p) => p.canView)
      .map(
        (p) =>
          member.restrictions.find((r) => r.moduleKey === p.moduleKey) ?? {
            moduleKey: p.moduleKey,
            denyView: false,
            denyCreate: false,
            denyUpdate: false,
            denyDelete: false,
          },
      );
    setRestrictions(next);
    // Open exactly the groups this member already overrides, so the dialog
    // shows current overrides immediately and keeps the rest tidy.
    const denied = new Set(
      next
        .filter((r) => r.denyView || r.denyCreate || r.denyUpdate || r.denyDelete)
        .map((r) => r.moduleKey),
    );
    setExpandedRestrictionGroups(
      new Set(
        groupedModuleCatalog()
          .filter((bucket) => bucket.modules.some((module) => denied.has(module.key)))
          .map((bucket) => bucket.group),
      ),
    );
    setEditing(member);
  };
  /**
   * The ONE deny control per page. Checking denies the page outright
   * (denyView, which the server resolves as removing every action too);
   * clearing it removes every deny flag, restoring exactly what the role
   * grants. A page already carrying a finer deny reads as checked and clears
   * the same way, so the single control is always the whole truth.
   */
  const toggle = (key: string) =>
    setRestrictions((current) =>
      current.map((item) => {
        if (item.moduleKey !== key) return item;
        const denied = item.denyView || item.denyCreate || item.denyUpdate || item.denyDelete;
        return denied
          ? {
              moduleKey: item.moduleKey,
              denyView: false,
              denyCreate: false,
              denyUpdate: false,
              denyDelete: false,
            }
          : { ...item, denyView: true };
      }),
    );
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setRoleFilter('all');
    setPage(1);
  };
  return (
    <section className={styles.page}>
      <PageHeader
        title="Staff"
        description="Staff accounts and assigned roles."
        actions={
          <Button
            onClick={() => {
              resetCreate();
              setRoleId(activeRoles[0]?.id ?? '');
              setCreateOpen(true);
            }}
          >
            New Staff
          </Button>
        }
      />
      <FilterBar
        search={
          <SearchField
            label="Search staff"
            placeholder="Search name, email or AF ID"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            busy={staff.isFetching && !staff.isPending}
          />
        }
        filters={
          <>
            <Select
              aria-label="Filter role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All roles' },
                ...activeRoles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <Select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={['all', 'invited', 'active', 'inactive', 'suspended'].map((value) => ({
                value,
                label: value[0]!.toUpperCase() + value.slice(1),
              }))}
            />
            {filtersActive ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </>
        }
      />
      {staff.isPending ? (
        <div role="status" aria-label="Loading staff" className={styles.tableWrap}>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={staff.refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No staff found"
          description={
            filtersActive ? 'No staff match these filters.' : 'Add the first staff member.'
          }
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`View staff member ${item.fullName}`}
                    onClick={() => navigate(`/admin/staff/${item.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/admin/staff/${item.id}`);
                    }}
                    className={styles.clickable}
                  >
                    <td data-label="Name">
                      <span className={styles.identityCell}>
                        <span className={styles.identityAvatar} aria-hidden="true">
                          {(item.fullName.trim().charAt(0) || '-').toUpperCase()}
                        </span>
                        <span>
                          <span className={styles.identityName}>{item.fullName}</span>
                          <small className={styles.identityMeta}>{item.email}</small>
                          {item.employeeNumber ? (
                            <small className={styles.identityMeta}>{item.employeeNumber}</small>
                          ) : null}
                          {item.salesNumber ? (
                            <small className={styles.identityMeta}>{item.salesNumber}</small>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td data-label="Role">
                      <StatusChip label={item.roleName} tone="neutral" />
                    </td>
                    <td data-label="Status">
                      <StatusChip label={item.status} tone={statusTone(item.status)} />
                    </td>
                    <td data-label="Added">
                      <small>{item.createdAt ? formatDate(item.createdAt) : '-'}</small>
                    </td>
                    <td
                      data-label="Actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="secondary" onClick={() => openRestrictions(item)}>
                        Restrictions
                      </Button>
                      {item.id !== user?.id && item.status !== 'inactive' ? (
                        <>
                          {' '}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setAccountAction({ kind: 'deactivate', staff: item })}
                          >
                            Deactivate
                          </Button>
                        </>
                      ) : null}
                      {user?.roleSlug === 'super_admin' && item.id !== user.id ? (
                        <>
                          {' '}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setAccountAction({ kind: 'delete', staff: item })}
                          >
                            Delete Permanently
                          </Button>
                        </>
                      ) : null}
                      {canPurgeTest && item.id !== user?.id && isTestStaffEmail(item.email) ? (
                        <>
                          {' '}
                          <Button size="sm" variant="danger" onClick={() => setPurgeTarget(item)}>
                            Purge Test Account
                          </Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <Pagination
              page={safePage}
              pageCount={pageCount}
              onChange={setPage}
              label="Staff pagination"
            />
          </div>
        </>
      )}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New staff member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!createValid || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create staff'}
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Identity</legend>
            <p className={styles.sectionHint}>Who this account belongs to.</p>
            <div className={styles.formFields}>
              <TextField
                id="staff-name"
                name="staff-name"
                label="Full name"
                value={fullName}
                suggestName
                normalize={(value) => normalizeLiveHumanField('fullName', value)}
                onChange={setFullName}
                error={createErrors.fullName}
                autoComplete="name"
              />
              <TextField
                id="staff-email"
                name="staff-email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                error={createErrors.email}
              />
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>Assignment</legend>
            <p className={styles.sectionHint}>Exactly one role and one department.</p>
            <div className={styles.formFields}>
              <label className={styles.fieldLabel}>
                Department
                <Select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...(departments.data ?? [])
                      .filter((d) => d.isActive)
                      .map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </label>
              <label className={styles.fieldLabel}>
                Role
                <Select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  options={activeRoles.map((r) => ({ value: r.id, label: r.name }))}
                />
              </label>
              {selectedRoleDescription ? (
                <p className={styles.roleHint}>{selectedRoleDescription}</p>
              ) : null}
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend className={styles.sectionTitle}>First sign-in</legend>
            <p className={styles.sectionHint}>Member sets own password later.</p>
            <div className={styles.formFields}>
              <PasswordField
                id="staff-temp-password"
                label="Temporary password"
                value={temporaryPassword}
                onChange={setTemporaryPassword}
                autoComplete="new-password"
                hint="At least 8 characters. Share it privately only."
                error={createErrors.temporaryPassword}
              />
              <PasswordField
                id="staff-temp-password-confirm"
                label="Confirm temporary password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                error={createErrors.confirmPassword}
              />
            </div>
          </fieldset>
          <Alert variant="info" title="First login">
            First sign-in needs password change.
          </Alert>
          {create.error ? <p role="alert">{create.error.message}</p> : null}
        </div>
      </Dialog>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Restrict ${editing?.fullName ?? 'staff access'}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={update.isPending} onClick={() => update.mutate()}>
              Save restrictions
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <Alert variant="info" title="Deny-only overrides">
            Overrides remove access only. Nothing grants access here.
          </Alert>
          {/* Same shape as the role access dialog: one "Deny access" control per
              page, grouped into dropdowns. Denying removes the page AND every
              action right on it; clearing the box restores whatever the role
              already grants. */}
          <ul className={styles.moduleList}>
            {groupedModuleCatalog().map((bucket) => {
              const byKey = new Map(restrictions.map((r) => [r.moduleKey, r]));
              const entries = bucket.modules
                .map((module) => ({ module, restriction: byKey.get(module.key) }))
                .filter((entry) => entry.restriction);
              if (entries.length === 0) return null;
              const isDenied = (restriction: Restriction) =>
                restriction.denyView ||
                restriction.denyCreate ||
                restriction.denyUpdate ||
                restriction.denyDelete;
              const deniedCount = entries.filter((entry) => isDenied(entry.restriction!)).length;
              const singleModule = entries.length === 1;
              const expanded = singleModule || expandedRestrictionGroups.has(bucket.group);
              return (
                <li key={bucket.group} className={styles.groupBlock}>
                  {singleModule ? null : (
                    <button
                      type="button"
                      className={styles.groupToggleButton}
                      aria-expanded={expanded}
                      onClick={() => toggleRestrictionGroup(bucket.group)}
                    >
                      <span className={styles.chevron} data-open={expanded}>
                        <Icon name="chevron-right" size={14} />
                      </span>
                      <span className={styles.groupName}>{bucket.group}</span>
                      <span
                        className={deniedCount > 0 ? styles.groupCountOn : styles.groupCount}
                        title={`${deniedCount} of ${entries.length} pages denied`}
                      >
                        {deniedCount}/{entries.length}
                      </span>
                    </button>
                  )}
                  {expanded ? (
                    <ul className={styles.moduleRows}>
                      {entries.map(({ module, restriction }) => (
                        <li key={module.key} className={styles.moduleRow}>
                          <label className={styles.moduleCheck}>
                            <input
                              aria-label={`${module.label} deny access`}
                              type="checkbox"
                              checked={isDenied(restriction!)}
                              onChange={() => toggle(module.key)}
                            />
                            <span className={styles.moduleName}>{module.label}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {update.error ? <p role="alert">{update.error.message}</p> : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={accountAction !== null}
        onCancel={() => {
          setAccountAction(null);
          setConfirmation('');
        }}
        onConfirm={() => changeAccount.mutate()}
        title={
          accountAction?.kind === 'delete'
            ? 'Permanently Delete Staff Account'
            : 'Deactivate Staff Account'
        }
        message={
          <div>
            <p>
              {accountAction?.kind === 'delete'
                ? 'Remove login if records allow. This cannot be undone.'
                : 'Block staff access now. Keep history records intact.'}
            </p>
            {accountAction?.kind === 'delete' ? (
              <TextField
                id="staff-delete-confirm"
                name="deleteConfirm"
                label="Type DELETE to confirm staff deletion"
                value={confirmation}
                onChange={setConfirmation}
              />
            ) : null}
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel={accountAction?.kind === 'delete' ? 'Delete Permanently' : 'Confirm'}
        confirmDisabled={accountAction?.kind === 'delete' && confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        onCancel={() => {
          setPurgeTarget(null);
          setPurgeConfirmation('');
        }}
        onConfirm={() => purgeTestAccount.mutate()}
        title="Purge Test Account"
        message={
          <div>
            <p>Delete test account now. Real data never purged.</p>
            <TextField
              id="staff-purge-confirm"
              name="purgeConfirm"
              label="Type PURGE to confirm purge"
              value={purgeConfirmation}
              onChange={setPurgeConfirmation}
            />
            {purgeTestAccount.error ? <p role="alert">{purgeTestAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel="Purge Test Account"
        confirmDisabled={purgeConfirmation !== 'PURGE'}
        confirmLoading={purgeTestAccount.isPending}
      />
    </section>
  );
}
