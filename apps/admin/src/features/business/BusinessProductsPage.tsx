import styles from './WorkflowCards.module.css';
import { tierArtwork } from '../../../../web/src/features/customer/tierArtwork';
import { useState } from 'react';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  StatusChip,
} from '@afhomes/ui';

import { formatMoney, formatPoints, formatRate } from './format';
import {
  createCardCategory,
  createCardProduct,
  getCardCategories,
  getCardProducts,
  updateCardCategory,
  updateCardProduct,
  type CardPlanVisibility,
} from './services';

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

function validatePlanForm(form: PlanForm): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (!form.code.trim()) return 'Code is required';
  if (!form.categoryId) return 'Category is required';
  if (!MONEY_RE.test(form.price) || Number(form.price) <= 0)
    return 'Spot cash price must be greater than zero';
  if (!/^\d+$/.test(form.points)) return 'Yearly points must be a whole number';
  if (!RATE_RE.test(form.rate) || Number(form.rate) < 0 || Number(form.rate) > 1)
    return 'Commission rate must be between 0 and 1 (0.04 = 4%)';
  if (!MONEY_RE.test(form.installment) || Number(form.installment) <= 0)
    return 'Installment price must be greater than zero';
  if (!MONEY_RE.test(form.reservation)) return 'Reservation fee must be a valid amount';
  if (Number(form.reservation) > Number(form.price))
    return 'Reservation fee cannot exceed the spot cash price';
  if (Number(form.reservation) > Number(form.installment))
    return 'Reservation fee cannot exceed the installment price';
  if (!/^\d+$/.test(form.spotDays) || Number(form.spotDays) <= 0)
    return 'Spot cash days must be a positive whole number';
  if (!/^\d+$/.test(form.installMonths) || Number(form.installMonths) <= 0)
    return 'Standard installment months must be a positive whole number';
  if (!/^\d+$/.test(form.validityYears) || Number(form.validityYears) <= 0)
    return 'Validity years must be a positive whole number';
  if (!/^-?\d+$/.test(form.sortOrder)) return 'Display order must be a whole number';
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

  const plans = useQuery({
    queryKey: ['business', 'card-products', appliedSearch, visibility],
    queryFn: () =>
      getCardProducts({
        search: appliedSearch || undefined,
        active: visibility === 'active' ? undefined : visibility,
      }),
  });
  const categories = useQuery({
    queryKey: ['business', 'card-categories'],
    queryFn: () => getCardCategories({ active: 'all' }),
  });
  const activeCategories = (categories.data ?? []).filter((c) => c.isActive);

  const invalidatePlans = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'card-products'] });
  };
  const invalidateCategories = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'card-categories'] });
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

  const createPlan = useMutation({
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

  const savePlan = useMutation({
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

  const togglePlan = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      updateCardProduct(input.id, { isActive: input.isActive }),
    onSuccess: invalidatePlans,
  });

  const createCategory = useMutation({
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

  const saveCategory = useMutation({
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

  const toggleCategory = useMutation({
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

  return (
    <section>
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

      <div
        role="tablist"
        aria-label="Card catalogue"
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
      >
        <Button variant={tab === 'plans' ? 'primary' : 'secondary'} onClick={() => setTab('plans')}>
          Plans
        </Button>
        <Button
          variant={tab === 'categories' ? 'primary' : 'secondary'}
          onClick={() => setTab('categories')}
        >
          Categories
        </Button>
      </div>

      {detailPlan ? (
        <Dialog
          open
          title={detailPlan.name}
          onClose={() => setDetailPlan(null)}
          footer={
            <Button variant="secondary" onClick={() => setDetailPlan(null)}>
              Close
            </Button>
          }
        >
          <section>
            <h2>Pricing</h2>
            <dl className={styles.facts}>
              <div>
                <dt>Spot Cash</dt>
                <dd>{formatMoney(detailPlan.cashPrice)}</dd>
              </div>
              <div>
                <dt>Installment</dt>
                <dd>{formatMoney(detailPlan.installmentPrice)}</dd>
              </div>
              <div>
                <dt>Reservation</dt>
                <dd>{formatMoney(detailPlan.reservationFee)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h2>Membership</h2>
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
                  {formatPoints(detailPlan.yearlyPoints)} × {detailPlan.annualPointsTranches}
                </dd>
              </div>
              <div>
                <dt>Total loyalty value</dt>
                <dd>{formatMoney(detailPlan.totalLoyaltyValue)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h2>Benefits</h2>
            <p>
              {detailPlan.discountPercent}% discount ·{' '}
              {detailPlan.priorityReservation ? 'Priority reservation' : 'Standard reservation'} ·{' '}
              {detailPlan.noMonthlyAnnualDues ? 'No monthly/annual dues' : 'Dues apply'}
            </p>
            <p>{detailPlan.description}</p>
          </section>
          <section>
            <h2>Payment options</h2>
            <p>
              Spot Cash ({detailPlan.spotCashDays} days) · Standard (
              {detailPlan.standardInstallmentMonths} months)
              {detailPlan.moveAEnabled ? ' · Move A' : ''}
              {detailPlan.moveB1Enabled ? ' · B1' : ''}
              {detailPlan.moveB2Enabled ? ' · B2' : ''}
            </p>
          </section>
          <section>
            <h2>Commission</h2>
            <p>
              Plan default: {formatRate(detailPlan.commissionRate)}. Effective rules are resolved by
              the server when a sale is created.
            </p>
          </section>
          <section>
            <h2>Status / Display order</h2>
            <StatusChip label={detailPlan.isActive ? 'Active' : 'Inactive'} />
            <p>Display order: {detailPlan.sortOrder}</p>
          </section>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                openEditPlan(detailPlan);
                setDetailPlan(null);
              }}
            >
              Edit plan
            </Button>
            <Button
              variant="secondary"
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
          </div>
        </Dialog>
      ) : null}
      {tab === 'plans' ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedSearch(search.trim());
            }}
          >
            <FilterBar
              search={
                <SearchField
                  label="Search card plans"
                  placeholder="Name or code"
                  value={search}
                  onChange={setSearch}
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
              actions={
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              }
            />
          </form>

          {plans.isPending ? (
            <p role="status">Loading card plans…</p>
          ) : plans.isError ? (
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
                    <img className={styles.artwork} {...tierArtwork(product.code)} />
                  ) : null}
                  <h2>{product.name}</h2>
                  <StatusChip label={product.isActive ? 'Active' : 'Inactive'} />
                  <dl className={styles.facts}>
                    <div>
                      <dt>Spot Cash</dt>
                      <dd>{formatMoney(product.cashPrice)}</dd>
                    </div>
                    <div>
                      <dt>Installment</dt>
                      <dd>{formatMoney(product.installmentPrice)}</dd>
                    </div>
                    <div>
                      <dt>Discount</dt>
                      <dd>{product.discountPercent}%</dd>
                    </div>
                    <div>
                      <dt>Points / Year</dt>
                      <dd>{formatPoints(product.yearlyPoints)}</dd>
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
                  <div className={styles.actions}>
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
          {categories.isPending ? (
            <p role="status">Loading categories…</p>
          ) : categories.isError ? (
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
              className="table-scroll"
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
                      <td>{category.name}</td>
                      <td>{category.slug}</td>
                      <td>{category.description ?? '—'}</td>
                      <td>
                        <StatusChip
                          label={category.isActive ? 'Active' : 'Inactive'}
                          tone={category.isActive ? 'success' : 'neutral'}
                        />
                      </td>
                      <td>{category.sortOrder}</td>
                      <td>{category.planCount ?? '—'}</td>
                      <td>
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
        <div style={{ display: 'grid', gap: 12 }}>
          <p>
            Changing these values affects only <strong>future</strong> sales. Existing sales retain
            their frozen pricing: scheme, total, reservation, schedule, validity and commission stay
            exactly as created. MASTER CONFIGURATION below never rewrites TRANSACTION SNAPSHOTS.
            Benefit edits require Admin/Super Admin, are audited before/after, and apply
            prospectively only.
          </p>
          <label>
            Name
            <input
              value={planForm.name}
              onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
            />
          </label>
          <label>
            Code
            <input
              value={planForm.code}
              onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })}
            />
          </label>
          <label>
            Category
            <select
              value={planForm.categoryId}
              onChange={(e) => setPlanForm({ ...planForm, categoryId: e.target.value })}
            >
              <option value="">Select a category</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              {planCategoryInactive ? (
                <option value={planForm.categoryId} disabled>
                  {editingPlan?.categoryName ?? 'Inactive category'} (inactive)
                </option>
              ) : null}
            </select>
          </label>
          {planCategoryInactive ? (
            <p role="note">
              This plan sits under an inactive category. Reactivate the category first to move other
              plans into it.
            </p>
          ) : null}
          <label>
            Description
            <input
              value={planForm.description}
              onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
            />
          </label>
          <label>
            Spot cash price
            <input
              value={planForm.price}
              onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
              inputMode="decimal"
            />
          </label>
          <label>
            4-month installment price
            <input
              value={planForm.installment}
              onChange={(e) => setPlanForm({ ...planForm, installment: e.target.value })}
              inputMode="decimal"
            />
          </label>
          <label>
            Reservation fee (included in every total)
            <input
              value={planForm.reservation}
              onChange={(e) => setPlanForm({ ...planForm, reservation: e.target.value })}
              inputMode="decimal"
            />
          </label>
          <label>
            Spot cash days
            <input
              value={planForm.spotDays}
              onChange={(e) =>
                setPlanForm({ ...planForm, spotDays: e.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
            />
          </label>
          <label>
            Standard installment months
            <input
              value={planForm.installMonths}
              onChange={(e) =>
                setPlanForm({ ...planForm, installMonths: e.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
            />
          </label>
          <label>
            Validity years
            <input
              value={planForm.validityYears}
              onChange={(e) =>
                setPlanForm({ ...planForm, validityYears: e.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
            />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Allowed internal moves</legend>
            <label>
              <input
                type="checkbox"
                checked={planForm.moveA}
                onChange={(e) => setPlanForm({ ...planForm, moveA: e.target.checked })}
              />{' '}
              Move A: pay over 4 months
            </label>
            <label>
              <input
                type="checkbox"
                checked={planForm.moveB1}
                onChange={(e) => setPlanForm({ ...planForm, moveB1: e.target.checked })}
              />{' '}
              Move B1: 40% DP + 12 months
            </label>
            <label>
              <input
                type="checkbox"
                checked={planForm.moveB2}
                onChange={(e) => setPlanForm({ ...planForm, moveB2: e.target.checked })}
              />{' '}
              Move B2: 25% DP + 12 months
            </label>
          </fieldset>
          <label>
            Yearly points
            <input
              value={planForm.points}
              onChange={(e) =>
                setPlanForm({ ...planForm, points: e.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
            />
          </label>
          <label>
            Commission rate (0.04 = 4%)
            <input
              value={planForm.rate}
              onChange={(e) => setPlanForm({ ...planForm, rate: e.target.value })}
              inputMode="decimal"
            />
          </label>
          <label>
            Display order
            <input
              value={planForm.sortOrder}
              onChange={(e) =>
                setPlanForm({ ...planForm, sortOrder: e.target.value.replace(/[^0-9-]/g, '') })
              }
              inputMode="numeric"
            />
          </label>
          {creatingPlan ? (
            <label>
              <input
                type="checkbox"
                checked={planForm.isActive}
                onChange={(e) => setPlanForm({ ...planForm, isActive: e.target.checked })}
              />{' '}
              Active (available for new applications)
            </label>
          ) : null}
          {planError ? <p role="alert">{planError}</p> : null}
          {planMutation.isError ? <p role="alert">{planMutation.error.message}</p> : null}
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
        <div style={{ display: 'grid', gap: 12 }}>
          <p>
            Categories organise plans. Deactivating a category removes its plans from new
            applications but never deletes plans, sales or history.
          </p>
          <label>
            Name
            <input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
            />
          </label>
          <label>
            Slug
            <input
              value={categoryForm.slug}
              onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}
            />
          </label>
          <label>
            Description
            <input
              value={categoryForm.description}
              onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
            />
          </label>
          <label>
            Sort order
            <input
              value={categoryForm.sortOrder}
              onChange={(e) =>
                setCategoryForm({
                  ...categoryForm,
                  sortOrder: e.target.value.replace(/[^0-9-]/g, ''),
                })
              }
              inputMode="numeric"
            />
          </label>
          {creatingCategory ? (
            <label>
              <input
                type="checkbox"
                checked={categoryForm.isActive}
                onChange={(e) => setCategoryForm({ ...categoryForm, isActive: e.target.checked })}
              />{' '}
              Active
            </label>
          ) : null}
          {categoryError ? <p role="alert">{categoryError}</p> : null}
          {categoryMutation.isError ? <p role="alert">{categoryMutation.error.message}</p> : null}
        </div>
      </Dialog>
    </section>
  );
}
