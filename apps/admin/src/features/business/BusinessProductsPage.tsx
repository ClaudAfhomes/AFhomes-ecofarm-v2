import styles from './BusinessProductsPage.module.css';
import { tierArtwork } from '@afhomes/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import type { CardCategory, CardProduct } from '@afhomes/contracts';
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
  TextAreaField,
  TextField,
} from '@afhomes/ui';

import { formatRate } from './format';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import {
  createCardCategory,
  createCardProduct,
  getCardCategories,
  getCardProducts,
  updateCardCategory,
  updateCardProduct,
  type CardPlanVisibility,
} from './services';
import { businessKeys } from './queryKeys';

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const RATE_RE = /^\d+(\.\d{1,4})?$/;

type PlanForm = {
  name: string;
  code: string;
  description: string;
  categoryId: string;
  price: string;
  installment: string;
  reservation: string;
  spotDays: string;
  installMonths: string;
  validityYears: string;
  moveA: boolean;
  moveB1: boolean;
  moveB2: boolean;
  points: string;
  rate: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_PLAN_FORM: PlanForm = {
  name: '',
  code: '',
  description: '',
  categoryId: '',
  price: '',
  installment: '',
  reservation: '10000.00',
  spotDays: '7',
  installMonths: '4',
  validityYears: '1',
  moveA: true,
  moveB1: true,
  moveB2: true,
  points: '',
  rate: '0.04',
  sortOrder: '0',
  isActive: true,
};

type CategoryForm = {
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_CATEGORY_FORM: CategoryForm = {
  name: '',
  slug: '',
  description: '',
  sortOrder: '0',
  isActive: true,
};

const planFormFromProduct = (product: CardProduct): PlanForm => ({
  name: product.name,
  code: product.code,
  description: product.description ?? '',
  categoryId: product.categoryId,
  price: product.cashPrice,
  installment: product.installmentPrice,
  reservation: product.reservationFee,
  spotDays: String(product.spotCashDays),
  installMonths: String(product.standardInstallmentMonths),
  validityYears: String(product.validityYears),
  moveA: product.moveAEnabled,
  moveB1: product.moveB1Enabled,
  moveB2: product.moveB2Enabled,
  points: String(product.yearlyPoints),
  rate: product.commissionRate,
  sortOrder: String(product.sortOrder),
  isActive: product.isActive,
});

const categoryFormFromCategory = (category: CardCategory): CategoryForm => ({
  name: category.name,
  slug: category.slug,
  description: category.description ?? '',
  sortOrder: String(category.sortOrder),
  isActive: category.isActive,
});

/**
 * Results-region placeholder: the card grid or the table, shaped exactly like
 * the real results so nothing jumps when they arrive.
 */
function CatalogResultsSkeleton({ variant }: { variant: 'cards' | 'table' }) {
  if (variant === 'table') {
    return (
      <div className={styles.skeletonTable} aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className={`${styles.skeletonRow} ${index === 0 ? styles.skeletonRowHead : ''}`}
          >
            {Array.from({ length: 6 }, (__, cell) => (
              <Skeleton key={cell} style={{ height: 16 }} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <Skeleton style={{ height: 148, borderRadius: 0 }} />
          <div className={styles.skeletonCardBody}>
            <Skeleton style={{ height: 24, maxWidth: '60%' }} />
            <Skeleton style={{ height: 20, maxWidth: '35%' }} />
            <div className={styles.skeletonFacts}>
              {Array.from({ length: 6 }, (__, fact) => (
                <div key={fact} style={{ display: 'grid', gap: 6 }}>
                  <Skeleton style={{ height: 10, maxWidth: '70%' }} />
                  <Skeleton style={{ height: 16, maxWidth: '55%' }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
            <Skeleton style={{ height: 40 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Full-screen skeleton for a tab's FIRST load.
 *
 * Mirrors the real layout (header, actions, switcher, toolbar, results) so
 * nothing pops in and reflows when the data lands. It owns the single
 * `role="status"` for the pending state and announces which tab is loading,
 * because a screen of silent grey blocks gives no clue what is arriving.
 */
function CatalogSkeleton({
  label,
  variant,
  switcher,
}: {
  label: string;
  variant: 'cards' | 'table';
  switcher: ReactNode;
}) {
  return (
    <div className={styles.skeletonShell} role="status" aria-label={label}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonHeaderText}>
          <Skeleton style={{ height: 30, maxWidth: 240 }} />
          <Skeleton style={{ height: 16, maxWidth: 460 }} />
        </div>
        <Skeleton style={{ height: 40, width: 148 }} />
      </div>
      {switcher}
      <div className={styles.skeletonToolbar} aria-hidden="true">
        <Skeleton style={{ height: 40 }} />
        <Skeleton style={{ height: 40 }} />
      </div>
      <CatalogResultsSkeleton variant={variant} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function validatePlanForm(form: PlanForm): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (!form.code.trim()) return 'Code is required';
  if (!form.categoryId) return 'Category is required';
  if (!MONEY_RE.test(form.price) || Number(form.price) <= 0) return 'Spot price must exceed zero.';
  if (!/^\d+$/.test(form.points)) return 'Points must be whole.';
  if (!RATE_RE.test(form.rate) || Number(form.rate) < 0 || Number(form.rate) > 1)
    return 'Rate stays within 0-1.';
  if (!MONEY_RE.test(form.installment) || Number(form.installment) <= 0)
    return 'Installment must exceed zero.';
  if (!MONEY_RE.test(form.reservation)) return 'Reservation must be valid.';
  if (Number(form.reservation) > Number(form.price)) return 'Reservation cannot exceed spot.';
  if (Number(form.reservation) > Number(form.installment))
    return 'Reservation cannot exceed installment.';
  if (!/^\d+$/.test(form.spotDays) || Number(form.spotDays) <= 0) return 'Spot days stay positive.';
  if (!/^\d+$/.test(form.installMonths) || Number(form.installMonths) <= 0)
    return 'Installment months stay positive.';
  if (!/^\d+$/.test(form.validityYears) || Number(form.validityYears) <= 0)
    return 'Validity stays positive whole.';
  if (!/^-?\d+$/.test(form.sortOrder)) return 'Order must be whole.';
  return null;
}

function validateCategoryForm(form: CategoryForm): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(form.slug.trim().toLowerCase()))
    return 'Slug must start with a letter and contain only letters, digits and -';
  if (!/^-?\d+$/.test(form.sortOrder)) return 'Sort order must be a whole number';
  return null;
}

/**
 * Card plans and their category vocabulary. Prices are database-backed: this
 * screen reads and writes `/card-products` and `/card-categories` and never
 * hardcodes Bronze/Silver/Gold economics or the category list.
 *
 * Editing a plan or category does NOT rewrite history. Every sale stores its
 * own commercial snapshot, so a change here only affects future sales.
 * Deactivated plans and categories stay in history but disappear from new
 * applications (a plan is selectable only when both are active).
 */
export function BusinessProductsPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<'plans' | 'categories'>('plans');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  void useDebouncedValue(search.trim(), 300, setAppliedSearch);
  const [visibility, setVisibility] = useState<CardPlanVisibility>('active');

  const [detailPlan, setDetailPlan] = useState<CardProduct | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CardProduct | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(EMPTY_PLAN_FORM);

  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CardCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(EMPTY_CATEGORY_FORM);

  /**
   * Why only the FIRST load may replace the screen with skeletons.
   *
   * Searching re-keys the query, so a brand-new key with no cached rows is
   * `pending` again while the operator is still typing. Swapping the page for
   * skeletons at that moment unmounts the search box itself, dropping focus and
   * silently swallowing the next keystroke.
   *
   * `keepPreviousData` removes the ambiguity at the source: a refetch carries
   * the previous rows forward, so the query stays successful and `isPending`
   * only ever describes a genuine first load. The chrome therefore never
   * disappears mid-interaction, the previous results stay on screen instead of
   * blanking, and `busy` tells the operator the list is being updated.
   */
  const plans = useQuery({
    queryKey: businessKeys.cardProducts(appliedSearch, visibility),
    queryFn: () =>
      getCardProducts({
        search: appliedSearch || undefined,
        active: visibility === 'active' ? undefined : visibility,
      }),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: businessKeys.cardCategories,
    queryFn: () => getCardCategories({ active: 'all' }),
    placeholderData: keepPreviousData,
  });
  const activeCategories = (categories.data ?? []).filter((c) => c.isActive);

  const invalidatePlans = async () => {
    await client.invalidateQueries({ queryKey: businessKeys.cardProductsScope });
  };
  const invalidateCategories = async () => {
    await client.invalidateQueries({ queryKey: businessKeys.cardCategories });
  };

  const closePlanDialogs = () => {
    setCreatingPlan(false);
    setEditingPlan(null);
    setPlanForm(EMPTY_PLAN_FORM);
  };
  const closeCategoryDialogs = () => {
    setCreatingCategory(false);
    setEditingCategory(null);
    setCategoryForm(EMPTY_CATEGORY_FORM);
  };

  const createPlan = useBusinessMutation({
    mutationFn: () =>
      createCardProduct({
        name: planForm.name.trim(),
        code: planForm.code.trim(),
        description: planForm.description.trim() || undefined,
        categoryId: planForm.categoryId,
        cashPrice: planForm.price,
        installmentPrice: planForm.installment,
        reservationFee: planForm.reservation,
        spotCashDays: Number(planForm.spotDays),
        standardInstallmentMonths: Number(planForm.installMonths),
        validityYears: Number(planForm.validityYears),
        moveAEnabled: planForm.moveA,
        moveB1Enabled: planForm.moveB1,
        moveB2Enabled: planForm.moveB2,
        yearlyPoints: Number(planForm.points),
        commissionRate: planForm.rate,
        sortOrder: Number(planForm.sortOrder),
        isActive: planForm.isActive,
      }),
    onSuccess: async () => {
      await invalidatePlans();
      closePlanDialogs();
    },
  });

  const savePlan = useBusinessMutation({
    mutationFn: () =>
      updateCardProduct(editingPlan!.id, {
        name: planForm.name.trim(),
        code: planForm.code.trim(),
        description: planForm.description.trim() ? planForm.description.trim() : null,
        categoryId: planForm.categoryId,
        cashPrice: planForm.price,
        installmentPrice: planForm.installment,
        reservationFee: planForm.reservation,
        spotCashDays: Number(planForm.spotDays),
        standardInstallmentMonths: Number(planForm.installMonths),
        validityYears: Number(planForm.validityYears),
        moveAEnabled: planForm.moveA,
        moveB1Enabled: planForm.moveB1,
        moveB2Enabled: planForm.moveB2,
        yearlyPoints: Number(planForm.points),
        commissionRate: planForm.rate,
        sortOrder: Number(planForm.sortOrder),
      }),
    onSuccess: async () => {
      await invalidatePlans();
      closePlanDialogs();
    },
  });

  const togglePlan = useBusinessMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      updateCardProduct(input.id, { isActive: input.isActive }),
    onSuccess: invalidatePlans,
  });

  const createCategory = useBusinessMutation({
    mutationFn: () =>
      createCardCategory({
        name: categoryForm.name.trim(),
        slug: categoryForm.slug.trim(),
        description: categoryForm.description.trim() || undefined,
        sortOrder: Number(categoryForm.sortOrder),
        isActive: categoryForm.isActive,
      }),
    onSuccess: async () => {
      await invalidateCategories();
      closeCategoryDialogs();
    },
  });

  const saveCategory = useBusinessMutation({
    mutationFn: () =>
      updateCardCategory(editingCategory!.id, {
        name: categoryForm.name.trim(),
        slug: categoryForm.slug.trim(),
        description: categoryForm.description.trim() ? categoryForm.description.trim() : null,
        sortOrder: Number(categoryForm.sortOrder),
      }),
    onSuccess: async () => {
      await invalidateCategories();
      closeCategoryDialogs();
    },
  });

  const toggleCategory = useBusinessMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      updateCardCategory(input.id, { isActive: input.isActive }),
    onSuccess: async () => {
      await invalidateCategories();
      await invalidatePlans();
    },
  });

  const openCreatePlan = () => {
    setPlanForm({ ...EMPTY_PLAN_FORM, categoryId: activeCategories[0]?.id ?? '' });
    setEditingPlan(null);
    setCreatingPlan(true);
  };
  const openEditPlan = (product: CardProduct) => {
    setPlanForm(planFormFromProduct(product));
    setCreatingPlan(false);
    setEditingPlan(product);
  };
  const openCreateCategory = () => {
    setCategoryForm(EMPTY_CATEGORY_FORM);
    setEditingCategory(null);
    setCreatingCategory(true);
  };
  const openEditCategory = (category: CardCategory) => {
    setCategoryForm(categoryFormFromCategory(category));
    setCreatingCategory(false);
    setEditingCategory(category);
  };

  const planMutation = creatingPlan ? createPlan : savePlan;
  const planError = validatePlanForm(planForm);
  const planDialogOpen = creatingPlan || editingPlan !== null;
  const planCategoryInactive =
    editingPlan !== null &&
    !creatingPlan &&
    !activeCategories.some((c) => c.id === planForm.categoryId);

  const categoryMutation = creatingCategory ? createCategory : saveCategory;
  const categoryError = validateCategoryForm(categoryForm);
  const categoryDialogOpen = creatingCategory || editingCategory !== null;

  // The skeleton follows the ACTIVE tab, so switching tabs re-skeletons that
  // tab instead of leaving the previous tab's content on screen.
  // With `keepPreviousData`, `isPending` only ever describes a genuine FIRST
  // load: a refetch that carries previous rows is successful, not pending.
  const firstLoad = tab === 'plans' ? plans.isPending : categories.isPending;
  // Any fetch in flight, including a background refetch driven by the search box.
  const refreshing = tab === 'plans' ? plans.isFetching : categories.isFetching;
  const loadingLabel = tab === 'plans' ? 'Loading card plans…' : 'Loading categories…';

  /**
   * Rendered in both states and in the same position, so it never shifts and
   * never disappears behind a skeleton. The switcher is navigation, not data:
   * an operator must be able to move between tabs while one of them is still
   * loading, so it is deliberately excluded from the loading placeholder.
   */
  const tabSwitcher = (
    <div role="tablist" aria-label="Card catalogue" className={styles.tabs}>
      <Button
        className={styles.tab}
        variant={tab === 'plans' ? 'primary' : 'secondary'}
        onClick={() => setTab('plans')}
      >
        Plans
      </Button>
      <Button
        className={styles.tab}
        variant={tab === 'categories' ? 'primary' : 'secondary'}
        onClick={() => setTab('categories')}
      >
        Categories
      </Button>
    </div>
  );

  return (
    <section className={styles.pageShell}>
      {firstLoad ? (
        <CatalogSkeleton
          label={loadingLabel}
          variant={tab === 'plans' ? 'cards' : 'table'}
          switcher={tabSwitcher}
        />
      ) : (
        <>
          <PageHeader
            title="Card Plans"
            description="Catalogue economics and vocabulary. Existing sales keep the terms snapshotted when they were created."
            actions={
              tab === 'plans' ? (
                <Button onClick={openCreatePlan}>Add Card Plan</Button>
              ) : (
                <Button onClick={openCreateCategory}>Add Category</Button>
              )
            }
          />

          {tabSwitcher}

          {detailPlan ? (
            <Dialog
              open
              title={detailPlan.name}
              onClose={() => setDetailPlan(null)}
              footer={
                <div className={styles.dialogActions}>
                  <Button
                    onClick={() => {
                      openEditPlan(detailPlan);
                      setDetailPlan(null);
                    }}
                  >
                    Edit plan
                  </Button>
                  <Button
                    variant={detailPlan.isActive ? 'danger' : 'secondary'}
                    disabled={togglePlan.isPending}
                    onClick={() =>
                      togglePlan.mutate(
                        { id: detailPlan.id, isActive: !detailPlan.isActive },
                        { onSuccess: () => setDetailPlan(null) },
                      )
                    }
                  >
                    {detailPlan.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <span className={styles.dialogActionsSpacer} />
                  <Button variant="ghost" onClick={() => setDetailPlan(null)}>
                    Close
                  </Button>
                </div>
              }
            >
              <div className={styles.dialogHero}>
                {['GOLD', 'SILVER', 'BRONZE'].includes(detailPlan.code.trim().toUpperCase()) ? (
                  <div className={styles.dialogHeroArt}>
                    <img className={styles.dialogHeroImage} {...tierArtwork(detailPlan.code)} />
                  </div>
                ) : null}
                <div className={styles.dialogHeroBody}>
                  <div className={styles.chipRow}>
                    <span className={`${styles.chip} ${styles.chipStrong}`}>{detailPlan.code}</span>
                    <StatusChip
                      label={detailPlan.isActive ? 'Active' : 'Inactive'}
                      tone={detailPlan.isActive ? 'success' : 'neutral'}
                    />
                  </div>
                  <p className={styles.dialogHeroName}>{detailPlan.name}</p>
                  <p className={styles.detailNote}>
                    {detailPlan.categoryName || 'Uncategorised'}
                    {detailPlan.description ? ` · ${detailPlan.description}` : ''}
                  </p>
                </div>
              </div>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Pricing</h2>
                <dl className={styles.facts}>
                  <div>
                    <dt>Spot Cash</dt>
                    <dd>{formatMoneyOrDash(detailPlan.cashPrice)}</dd>
                  </div>
                  <div>
                    <dt>Installment</dt>
                    <dd>{formatMoneyOrDash(detailPlan.installmentPrice)}</dd>
                  </div>
                  <div>
                    <dt>Reservation</dt>
                    <dd>{formatMoneyOrDash(detailPlan.reservationFee)}</dd>
                  </div>
                </dl>
              </section>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Membership</h2>
                <dl className={styles.facts}>
                  <div>
                    <dt>Validity</dt>
                    <dd>
                      {detailPlan.validityYears} years ({detailPlan.baseValidityYears} +{' '}
                      {detailPlan.validityExtensionYears})
                    </dd>
                  </div>
                  <div>
                    <dt>Cardholder limit</dt>
                    <dd>{detailPlan.cardholderLimit}</dd>
                  </div>
                  <div>
                    <dt>Yearly points</dt>
                    <dd>
                      {formatCountOrDash(detailPlan.yearlyPoints)} ×{' '}
                      {detailPlan.annualPointsTranches}
                    </dd>
                  </div>
                  <div>
                    <dt>Total loyalty value</dt>
                    <dd>{formatMoneyOrDash(detailPlan.totalLoyaltyValue)}</dd>
                  </div>
                </dl>
              </section>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Benefits</h2>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>{detailPlan.discountPercent}% discount</span>
                  <span className={styles.chip}>
                    {detailPlan.priorityReservation
                      ? 'Priority reservation'
                      : 'Standard reservation'}
                  </span>
                  <span className={styles.chip}>
                    {detailPlan.noMonthlyAnnualDues ? 'No monthly/annual dues' : 'Dues apply'}
                  </span>
                </div>
              </section>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Payment options</h2>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>Spot Cash · {detailPlan.spotCashDays} days</span>
                  <span className={styles.chip}>
                    Standard · {detailPlan.standardInstallmentMonths} months
                  </span>
                  {detailPlan.moveAEnabled ? <span className={styles.chip}>Move A</span> : null}
                  {detailPlan.moveB1Enabled ? (
                    <span className={styles.chip}>B1 · 40% DP</span>
                  ) : null}
                  {detailPlan.moveB2Enabled ? (
                    <span className={styles.chip}>B2 · 25% DP</span>
                  ) : null}
                </div>
              </section>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Commission</h2>
                <p className={styles.detailNote}>
                  Plan default: {formatRate(detailPlan.commissionRate)}. Effective rules are
                  resolved by the server when a sale is created.
                </p>
              </section>
              <section className={styles.detailSection}>
                <h2 className={styles.detailTitle}>Status / Display order</h2>
                <div>
                  <StatusChip label={detailPlan.isActive ? 'Active' : 'Inactive'} />
                </div>
                <p className={styles.detailNote}>Display order: {detailPlan.sortOrder}</p>
              </section>
            </Dialog>
          ) : null}
          {tab === 'plans' ? (
            <>
              {/* Live search: the debounced term drives the query directly, so there
              is no submit button to press and the form wrapper has no job. */}
              <FilterBar
                search={
                  <SearchField
                    label="Search card plans"
                    placeholder="Name or code"
                    value={search}
                    onChange={setSearch}
                    busy={refreshing}
                  />
                }
                filters={
                  <Select
                    aria-label="Filter by status"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as CardPlanVisibility)}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                      { value: 'all', label: 'All' },
                    ]}
                  />
                }
              />

              {plans.isError ? (
                <ErrorState error={plans.error} onRetry={plans.refetch} />
              ) : plans.data?.length === 0 ? (
                <EmptyState
                  title={appliedSearch ? 'No matching records.' : 'No card plans'}
                  description={
                    appliedSearch || visibility !== 'active'
                      ? 'No card plans match the current filters.'
                      : 'Create the first plan to start selling.'
                  }
                />
              ) : (
                <div className={styles.grid} aria-label="VIP card plans">
                  {plans.data?.map((product) => (
                    <article key={product.id} className={styles.card}>
                      {['GOLD', 'SILVER', 'BRONZE'].includes(product.code.trim().toUpperCase()) ? (
                        <div className={styles.cardArtworkWrap}>
                          <img className={styles.artwork} {...tierArtwork(product.code)} />
                        </div>
                      ) : null}
                      <div className={styles.cardBody}>
                        <div className={styles.cardHead}>
                          <h2 className={styles.cardTitle}>{product.name}</h2>
                          <StatusChip label={product.isActive ? 'Active' : 'Inactive'} />
                        </div>
                        <dl className={styles.facts}>
                          <div>
                            <dt>Spot Cash</dt>
                            <dd>{formatMoneyOrDash(product.cashPrice)}</dd>
                          </div>
                          <div>
                            <dt>Installment</dt>
                            <dd>{formatMoneyOrDash(product.installmentPrice)}</dd>
                          </div>
                          <div>
                            <dt>Discount</dt>
                            <dd>{product.discountPercent}%</dd>
                          </div>
                          <div>
                            <dt>Points / Year</dt>
                            <dd>{formatCountOrDash(product.yearlyPoints)}</dd>
                          </div>
                          <div>
                            <dt>Validity</dt>
                            <dd>{product.validityYears} years</dd>
                          </div>
                          <div>
                            <dt>Cardholders</dt>
                            <dd>{product.cardholderLimit}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className={styles.cardFooter}>
                        <Button variant="secondary" onClick={() => setDetailPlan(product)}>
                          View details
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {togglePlan.isError ? <p role="alert">{togglePlan.error.message}</p> : null}
            </>
          ) : (
            <>
              {categories.isError ? (
                <ErrorState error={categories.error} onRetry={categories.refetch} />
              ) : categories.data?.length === 0 ? (
                <EmptyState
                  title="No card categories"
                  description="Create the first category to organise plans."
                />
              ) : (
                <div
                  role="region"
                  aria-label="Scrollable records"
                  tabIndex={0}
                  className={`table-scroll ${styles.categoriesWrap}`}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Slug</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Sort Order</th>
                        <th>Plans</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.data?.map((category) => (
                        <tr key={category.id}>
                          <td data-label="Name">{category.name}</td>
                          <td data-label="Slug">{category.slug}</td>
                          <td data-label="Description">{category.description ?? '—'}</td>
                          <td data-label="Status">
                            <StatusChip
                              label={category.isActive ? 'Active' : 'Inactive'}
                              tone={category.isActive ? 'success' : 'neutral'}
                            />
                          </td>
                          <td data-label="Sort Order">{category.sortOrder}</td>
                          <td data-label="Plans">{category.planCount ?? '—'}</td>
                          <td data-label="Actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditCategory(category)}
                            >
                              Edit
                            </Button>{' '}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={toggleCategory.isPending}
                              onClick={() =>
                                toggleCategory.mutate({
                                  id: category.id,
                                  isActive: !category.isActive,
                                })
                              }
                            >
                              {category.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {toggleCategory.isError ? <p role="alert">{toggleCategory.error.message}</p> : null}
            </>
          )}
        </>
      )}

      <Dialog
        open={planDialogOpen}
        onClose={closePlanDialogs}
        title={creatingPlan ? 'Add Card Plan' : `Edit ${editingPlan?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={closePlanDialogs}>
              Cancel
            </Button>
            <Button
              disabled={planError !== null || planMutation.isPending}
              onClick={() => planMutation.mutate()}
            >
              {creatingPlan ? 'Create plan' : 'Save'}
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <p className={styles.formNote}>
            Affects future sales only. Existing snapshots stay frozen.
          </p>
          <fieldset className={styles.formSection}>
            <legend>Identity</legend>
            <p className={styles.sectionHint}>Name, code and category.</p>
            <div className={styles.sectionGrid}>
              <TextField
                id="plan-name"
                name="planName"
                label="Name"
                optional
                value={planForm.name}
                onChange={(value) => setPlanForm({ ...planForm, name: value })}
              />
              <TextField
                id="plan-code"
                name="planCode"
                label="Code"
                optional
                value={planForm.code}
                onChange={(value) => setPlanForm({ ...planForm, code: value })}
              />
            </div>
            <label className={styles.field}>
              Category
              <Select
                value={planForm.categoryId}
                onChange={(e) => setPlanForm({ ...planForm, categoryId: e.target.value })}
                options={[
                  { value: '', label: 'Select a category' },
                  ...activeCategories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                  ...(planCategoryInactive
                    ? [
                        {
                          value: planForm.categoryId,
                          label: `${editingPlan?.categoryName ?? 'Inactive category'} (inactive)`,
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
              />
            </label>
            {planCategoryInactive ? (
              <p role="note" className={styles.formNote}>
                Category is inactive. Reactivate it to proceed.
              </p>
            ) : null}
            <TextAreaField
              id="plan-description"
              name="planDescription"
              label="Description"
              optional
              rows={3}
              value={planForm.description}
              onChange={(value) => setPlanForm({ ...planForm, description: value })}
            />
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend>Pricing</legend>
            <p className={styles.sectionHint}>Totals include reservation fee.</p>
            <div className={styles.sectionGrid}>
              <TextField
                id="plan-price"
                name="price"
                label="Spot cash price"
                optional
                inputMode="decimal"
                value={planForm.price}
                onChange={(value) => setPlanForm({ ...planForm, price: value })}
              />
              <TextField
                id="plan-installment"
                name="installment"
                label="4-month installment price"
                optional
                inputMode="decimal"
                value={planForm.installment}
                onChange={(value) => setPlanForm({ ...planForm, installment: value })}
              />
              <TextField
                id="plan-reservation"
                name="reservation"
                label="Reservation fee (in every total)"
                optional
                inputMode="decimal"
                value={planForm.reservation}
                onChange={(value) => setPlanForm({ ...planForm, reservation: value })}
              />
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend>Terms</legend>
            <p className={styles.sectionHint}>Windows and validity periods.</p>
            <div className={styles.sectionGrid}>
              <TextField
                id="plan-spot-days"
                name="spotDays"
                label="Spot cash days"
                optional
                inputMode="numeric"
                value={planForm.spotDays}
                onChange={(value) =>
                  setPlanForm({ ...planForm, spotDays: value.replace(/\D/g, '') })
                }
              />
              <TextField
                id="plan-install-months"
                name="installMonths"
                label="Standard installment months"
                optional
                inputMode="numeric"
                value={planForm.installMonths}
                onChange={(value) =>
                  setPlanForm({ ...planForm, installMonths: value.replace(/\D/g, '') })
                }
              />
              <TextField
                id="plan-validity-years"
                name="validityYears"
                label="Validity years"
                optional
                inputMode="numeric"
                value={planForm.validityYears}
                onChange={(value) =>
                  setPlanForm({ ...planForm, validityYears: value.replace(/\D/g, '') })
                }
              />
            </div>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend>Allowed internal moves</legend>
            <p className={styles.sectionHint}>Enable each allowed move.</p>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={planForm.moveA}
                onChange={(e) => setPlanForm({ ...planForm, moveA: e.target.checked })}
              />
              <span className={styles.moveLabel}>
                <strong>Move A</strong>
                <small className={styles.moveHint}>Pay over 4 months</small>
              </span>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={planForm.moveB1}
                onChange={(e) => setPlanForm({ ...planForm, moveB1: e.target.checked })}
              />
              <span className={styles.moveLabel}>
                <strong>Move B1</strong>
                <small className={styles.moveHint}>40% DP, 12 months</small>
              </span>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={planForm.moveB2}
                onChange={(e) => setPlanForm({ ...planForm, moveB2: e.target.checked })}
              />
              <span className={styles.moveLabel}>
                <strong>Move B2</strong>
                <small className={styles.moveHint}>25% DP, 12 months</small>
              </span>
            </label>
          </fieldset>
          <fieldset className={styles.formSection}>
            <legend>Rewards and display</legend>
            <p className={styles.sectionHint}>Points, commission and order.</p>
            <div className={styles.sectionGrid}>
              <TextField
                id="plan-points"
                name="yearlyPoints"
                label="Yearly points"
                optional
                inputMode="numeric"
                value={planForm.points}
                onChange={(value) => setPlanForm({ ...planForm, points: value.replace(/\D/g, '') })}
              />
              <TextField
                id="plan-rate"
                name="commissionRate"
                label="Commission rate (0.04 = 4%)"
                optional
                inputMode="decimal"
                value={planForm.rate}
                onChange={(value) => setPlanForm({ ...planForm, rate: value })}
              />
              <TextField
                id="plan-sort-order"
                name="planSortOrder"
                label="Display order"
                optional
                inputMode="numeric"
                value={planForm.sortOrder}
                onChange={(value) =>
                  setPlanForm({ ...planForm, sortOrder: value.replace(/[^0-9-]/g, '') })
                }
              />
            </div>
            {creatingPlan ? (
              <label className={`${styles.checkRow} ${styles.fieldWide}`}>
                <input
                  type="checkbox"
                  checked={planForm.isActive}
                  onChange={(e) => setPlanForm({ ...planForm, isActive: e.target.checked })}
                />
                Active (available for new applications)
              </label>
            ) : null}
          </fieldset>
          {planError ? (
            <p role="alert" className={styles.formAlert}>
              {planError}
            </p>
          ) : null}
          {planMutation.isError ? (
            <p role="alert" className={styles.formAlert}>
              {planMutation.error.message}
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={categoryDialogOpen}
        onClose={closeCategoryDialogs}
        title={creatingCategory ? 'Add Category' : `Edit ${editingCategory?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={closeCategoryDialogs}>
              Cancel
            </Button>
            <Button
              disabled={categoryError !== null || categoryMutation.isPending}
              onClick={() => categoryMutation.mutate()}
            >
              {creatingCategory ? 'Create category' : 'Save'}
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <p className={styles.formNote}>
            Categories organise plans. Deactivating a category removes its plans from new
            applications but never deletes plans, sales or history.
          </p>
          <TextField
            id="category-name"
            name="categoryName"
            label="Name"
            optional
            value={categoryForm.name}
            onChange={(value) => setCategoryForm({ ...categoryForm, name: value })}
          />
          <TextField
            id="category-slug"
            name="categorySlug"
            label="Slug"
            optional
            value={categoryForm.slug}
            onChange={(value) => setCategoryForm({ ...categoryForm, slug: value })}
          />
          <TextAreaField
            id="category-description"
            name="categoryDescription"
            label="Description"
            optional
            rows={3}
            value={categoryForm.description}
            onChange={(value) => setCategoryForm({ ...categoryForm, description: value })}
          />
          <TextField
            id="category-sort-order"
            name="categorySortOrder"
            label="Sort order"
            optional
            inputMode="numeric"
            value={categoryForm.sortOrder}
            onChange={(value) =>
              setCategoryForm({
                ...categoryForm,
                sortOrder: value.replace(/[^0-9-]/g, ''),
              })
            }
          />
          {creatingCategory ? (
            <label className={`${styles.checkRow} ${styles.fieldWide}`}>
              <input
                type="checkbox"
                checked={categoryForm.isActive}
                onChange={(e) => setCategoryForm({ ...categoryForm, isActive: e.target.checked })}
              />
              Active
            </label>
          ) : null}
          {categoryError ? (
            <p role="alert" className={styles.formAlert}>
              {categoryError}
            </p>
          ) : null}
          {categoryMutation.isError ? (
            <p role="alert" className={styles.formAlert}>
              {categoryMutation.error.message}
            </p>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
