import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  DateField,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
  notifySuccess,
  notifyConfirm,
} from '@afhomes/ui';
import styles from './points.module.css';
import { TierBadge } from './TierBadge';

import { ServiceCatalogEditor } from './ServiceCatalogEditor';
import { useSession } from '../../lib/session';
import {
  createEarningRule,
  manageServicePolicy,
  setServicePolicyActive,
  listEarningRules,
  listTierDiscounts,
  createTierDiscount,
  listServices,
  listRedemptionRules,
  createRedemptionRule,
  updateRedemptionRule,
} from './points-services';
import { earningKeys } from './queryKeys';

/** The three VIP tiers. Narrow, not `string`, so a typo cannot reach the API. */
type Tier = 'BRONZE' | 'SILVER' | 'GOLD';

const TIERS: Tier[] = ['BRONZE', 'SILVER', 'GOLD'];

/**
 * The two tables that decide what earns points: the service catalog and the
 * earning rules.
 *
 * Both are read-heavy and written rarely, so this is a list with an inline form
 * rather than a full editor per row. What matters here is not the layout - it is
 * that a staff member can never express a rule that quietly contradicts the
 * approved policy:
 *
 *   - There is NO cap-exemption control. Every award counts toward the annual
 *     limit; there is no such concept in this release and the contract refuses the
 *     field, so adding a checkbox here would be adding a lie.
 *   - The rule states POINTS PER SERVICE. The annual cap is per TIER and lives in
 *     `tier_points_config`; it is deliberately not editable from this screen.
 *   - A rule for an inactive service is refused by the server, because a rule that
 *     points at a deactivated service would earn nothing, forever, silently.
 */
export function PointsRulesPage() {
  const client = useQueryClient();

  /**
   * Whether this viewer may CHANGE anything here.
   *
   * `employee` (the GSD) holds `operations.catalog` VIEW, because it needs the
   * catalog to sell from and to redeem against. View is enough to explain a
   * sale. It is not enough to set a price, a tier rate or an earning rule, so
   * every write control is withheld from a viewer without it.
   *
   * This is UX only. The server independently refuses every one of these writes
   * without `operations.catalog` create/update, so hiding the form is a courtesy
   * rather than the control.
   */
  const mayAdminister =
    useSession().user?.afHomesPermissions?.find((p) => p.moduleKey === 'operations.catalog')
      ?.canCreate === true;

  const mayUpdate =
    useSession().user?.afHomesPermissions?.find((p) => p.moduleKey === 'operations.catalog')
      ?.canUpdate === true;

  const mayDelete =
    useSession().user?.afHomesPermissions?.find((p) => p.moduleKey === 'operations.catalog')
      ?.canDelete === true;
  const services = useQuery({
    queryKey: earningKeys.services,
    queryFn: listServices,
    placeholderData: keepPreviousData,
  });
  const rules = useQuery({
    queryKey: earningKeys.rules,
    queryFn: listEarningRules,
    placeholderData: keepPreviousData,
  });
  const tierDiscounts = useQuery({
    queryKey: earningKeys.tierDiscounts,
    queryFn: listTierDiscounts,
    placeholderData: keepPreviousData,
  });
  const promotions = useQuery({
    queryKey: earningKeys.redemptionRules,
    queryFn: listRedemptionRules,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: earningKeys.all });
  const serviceName = (id: string) =>
    (services.data ?? []).find((service) => service.id === id)?.name ?? 'Unknown service';

  // First load skeletonizes the whole page so no static content flashes before
  // the data it describes. Refetches keep previous data visible via
  // keepPreviousData and never reach this branch.
  const firstLoad =
    services.isPending && rules.isPending && tierDiscounts.isPending && promotions.isPending;
  if (firstLoad)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading points rules"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 460 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading points rules</span>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Points Rules"
        description="What a member earns per service, and which services exist."
      />

      <Alert variant="info" title="Prospective changes only">
        Rates and rules snapshot onto each sale when it is made. Changing anything here never alters
        a transaction that has already been recorded.
      </Alert>

      <ul className={styles.badges} aria-label="Rules summary">
        <li>
          <StatusChip
            label={`Services: ${formatCountOrDash(services.data?.length ?? 0)}`}
            tone="neutral"
            icon="grid"
          />
        </li>
        <li>
          <StatusChip
            label={`Earning rules: ${formatCountOrDash(rules.data?.length ?? 0)}`}
            tone="neutral"
            icon="file-text"
          />
        </li>
        <li>
          <StatusChip
            label={`Tier discounts: ${formatCountOrDash(tierDiscounts.data?.length ?? 0)}`}
            tone="success"
            icon="check"
          />
        </li>
        <li>
          <StatusChip
            label={`Spending promotions: ${formatCountOrDash(promotions.data?.length ?? 0)}`}
            tone="neutral"
            icon="clock"
          />
        </li>
      </ul>

      <ServiceCatalogEditor
        services={services.data ?? []}
        loading={services.isLoading}
        error={services.error}
        onSaved={invalidate}
      />
      <section aria-label="VIP tier discounts" className={styles.section}>
        <h2 className={styles.sectionTitle}>VIP tier discounts</h2>
        <p className={styles.hint}>
          The Operational Services discount a member receives at checkout, as a percentage of the
          service price. This is separate from a card purchase discount. A rate is snapshotted onto
          each sale when it is made, so changing a rate here never alters a transaction that has
          already been recorded.
        </p>
        {tierDiscounts.isLoading && (
          <div role="status" aria-label="Loading tier discounts" aria-busy="true">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {tierDiscounts.isError && (
          <ErrorState
            error={tierDiscounts.error}
            onRetry={() => void tierDiscounts.refetch()}
            title="Tier discounts unavailable"
          />
        )}
        {tierDiscounts.data?.length === 0 && (
          <EmptyState
            title="No tier discounts configured"
            description="Every service sells at full price until a rate is configured for it."
          />
        )}
        {tierDiscounts.data && tierDiscounts.data.length > 0 && (
          <div
            role="region"
            aria-label="Scrollable tier discounts"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableCaption>VIP checkout rates per service and tier.</TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>Tier</TableHeaderCell>
                  <TableHeaderCell align="right">Discount</TableHeaderCell>
                  <TableHeaderCell>Window</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tierDiscounts.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell label="Service">{serviceName(rule.serviceId)}</TableCell>
                    <TableCell label="Tier">
                      <TierBadge tier={rule.tier} />
                    </TableCell>
                    <TableCell label="Discount" align="right">
                      {rule.discountRate}%
                    </TableCell>
                    <TableCell label="Window">
                      {rule.effectiveStart} to {rule.effectiveEnd}
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={rule.isActive ? 'Active' : 'Inactive'}
                        tone={rule.isActive ? 'success' : 'neutral'}
                      />
                      {mayUpdate && (
                        <>
                          {' '}
                          <PolicyStatusButton
                            kind="tier-discounts"
                            id={rule.id}
                            active={rule.isActive}
                            onSaved={invalidate}
                          />{' '}
                          <PolicyManagement
                            kind="tier-discounts"
                            id={rule.id}
                            values={{
                              discount_rate: rule.discountRate,
                              effective_start: rule.effectiveStart,
                              effective_end: rule.effectiveEnd,
                            }}
                            mayDelete={mayDelete}
                            onSaved={invalidate}
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {mayAdminister && (
          <NewTierDiscountForm
            services={services.data ?? []}
            onSaved={invalidate}
            disabled={services.isPending || tierDiscounts.isPending}
          />
        )}
      </section>

      <section aria-label="Earning rules" className={styles.section}>
        <h2 className={styles.sectionTitle}>Earning rules</h2>
        {rules.isLoading && (
          <div role="status" aria-label="Loading earning rules" aria-busy="true">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {rules.isError && (
          <ErrorState
            error={rules.error}
            onRetry={() => void rules.refetch()}
            title="Rules unavailable"
          />
        )}
        {rules.data?.length === 0 && (
          <EmptyState
            title="No earning rules"
            description="Without a rule, a purchase earns nothing. Add one to start accruing."
          />
        )}
        {rules.data && rules.data.length > 0 && (
          <div
            role="region"
            aria-label="Scrollable earning rules"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableCaption>Points awarded per service, tier and window.</TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>Window</TableHeaderCell>
                  <TableHeaderCell align="right">Points</TableHeaderCell>
                  <TableHeaderCell>Tiers</TableHeaderCell>
                  <TableHeaderCell align="right">Min qty</TableHeaderCell>
                  <TableHeaderCell align="right">Max award</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell label="Service">{serviceName(rule.serviceId)}</TableCell>
                    <TableCell label="Window">
                      {rule.effectiveStart} to {rule.effectiveEnd}
                    </TableCell>
                    <TableCell label="Points" align="right">
                      {formatCountOrDash(rule.pointsAmount)}
                    </TableCell>
                    <TableCell label="Tiers">
                      {rule.eligibleTiers.map((tier, index) => (
                        <span key={tier}>
                          {index > 0 ? ', ' : null}
                          <TierBadge tier={tier} />
                        </span>
                      ))}
                    </TableCell>
                    <TableCell label="Min qty" align="right">
                      {formatCountOrDash(rule.minQuantity)}
                    </TableCell>
                    <TableCell label="Max award" align="right">
                      {rule.maxAward ?? 'No limit'}
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={rule.isActive ? 'Active' : 'Inactive'}
                        tone={rule.isActive ? 'success' : 'neutral'}
                      />
                      {mayUpdate && (
                        <>
                          {' '}
                          <PolicyStatusButton
                            kind="rules"
                            id={rule.id}
                            active={rule.isActive}
                            onSaved={invalidate}
                          />{' '}
                          <PolicyManagement
                            kind="rules"
                            id={rule.id}
                            values={{
                              points_amount: rule.pointsAmount,
                              eligible_tiers: rule.eligibleTiers,
                              min_quantity: rule.minQuantity,
                              max_award: rule.maxAward,
                              promotion_reference: rule.promotionReference,
                              effective_start: rule.effectiveStart,
                              effective_end: rule.effectiveEnd,
                            }}
                            mayDelete={mayDelete}
                            onSaved={invalidate}
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {mayAdminister && <NewRuleForm services={services.data ?? []} onSaved={invalidate} />}
      </section>

      <section aria-label="Points spending promotions" className={styles.section}>
        <h2 className={styles.sectionTitle}>Points spending promotions</h2>
        <p className={styles.hint}>
          What makes a NON-staycation service discountable by points, and at what conversion. A
          staycation or hotel service needs no promotion. Every other service refuses points
          spending unless an active promotion names it, covers the member&apos;s tier, and is inside
          its effective window. Both dates are mandatory: a promotion that never expires cannot be
          created. There is no cap exemption and no applies-to-everything option.
        </p>
        {promotions.isLoading && (
          <div role="status" aria-label="Loading spending promotions" aria-busy="true">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {promotions.isError && (
          <ErrorState
            error={promotions.error}
            onRetry={() => void promotions.refetch()}
            title="Promotions unavailable"
          />
        )}
        {promotions.data?.length === 0 && (
          <EmptyState
            title="No spending promotions"
            description="Staycation purchases work without one. Add a promotion to open another service to points spending."
          />
        )}
        {promotions.data && promotions.data.length > 0 && (
          <div
            role="region"
            aria-label="Scrollable spending promotions"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableCaption>Points spending promotions per service, tier and window.</TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell align="right">Rate</TableHeaderCell>
                  <TableHeaderCell>Tiers</TableHeaderCell>
                  <TableHeaderCell align="right">Points range</TableHeaderCell>
                  <TableHeaderCell>Window</TableHeaderCell>
                  <TableHeaderCell>Reference</TableHeaderCell>
                  <TableHeaderCell>Stacks with tier</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {promotions.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell label="Service">{serviceName(rule.serviceId)}</TableCell>
                    <TableCell label="Rate" align="right">
                      {formatMoneyOrDash(rule.pesoValuePerPoint)} / point
                    </TableCell>
                    <TableCell label="Tiers">
                      {rule.eligibleTiers.map((tier, index) => (
                        <span key={tier}>
                          {index > 0 ? ', ' : null}
                          <TierBadge tier={tier} />
                        </span>
                      ))}
                    </TableCell>
                    <TableCell label="Points range" align="right">
                      {formatCountOrDash(rule.minPoints)}
                      {rule.maxPoints === null ? '+' : `-${formatCountOrDash(rule.maxPoints)}`}
                    </TableCell>
                    <TableCell label="Window">
                      {rule.effectiveStart} to {rule.effectiveEnd}
                    </TableCell>
                    <TableCell label="Reference">{rule.promotionReference ?? '—'}</TableCell>
                    <TableCell label="Stacks with tier">
                      <StatusChip
                        label={rule.allowDiscountStacking ? 'Yes' : 'No'}
                        tone={rule.allowDiscountStacking ? 'warning' : 'neutral'}
                      />
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={rule.isActive ? 'Active' : 'Inactive'}
                        tone={rule.isActive ? 'success' : 'neutral'}
                      />
                      {mayUpdate && (
                        <>
                          {' '}
                          <PromotionStatusButton
                            id={rule.id}
                            active={rule.isActive}
                            onSaved={invalidate}
                          />{' '}
                          <PolicyManagement
                            kind="redemption-rules"
                            id={rule.id}
                            values={{
                              peso_value_per_point: rule.pesoValuePerPoint,
                              eligible_tiers: rule.eligibleTiers,
                              allow_discount_stacking: rule.allowDiscountStacking,
                              min_points: rule.minPoints,
                              max_points: rule.maxPoints,
                              promotion_reference: rule.promotionReference,
                              effective_start: rule.effectiveStart,
                              effective_end: rule.effectiveEnd,
                            }}
                            mayDelete={mayDelete}
                            onSaved={invalidate}
                          />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {mayAdminister && <NewPromotionForm services={services.data ?? []} onSaved={invalidate} />}
      </section>
    </section>
  );
}

function PolicyStatusButton({
  kind,
  id,
  active,
  onSaved,
}: {
  kind: 'rules' | 'tier-discounts';
  id: string;
  active: boolean;
  onSaved: () => void;
}) {
  const save = useBusinessMutation({
    mutationFn: () => setServicePolicyActive(kind, id, !active),
    retry: false,
    onSuccess: () => {
      notifySuccess({ title: 'Policy status saved' });
      onSaved();
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        loading={save.isPending}
        loadingLabel={active ? 'Deactivating…' : 'Activating…'}
        onClick={async () => {
          if (
            await notifyConfirm({
              title: active ? 'Deactivate this policy?' : 'Activate this policy?',
              confirmButtonText: active ? 'Deactivate' : 'Activate',
              message:
                'Deactivation stops this rule for future purchases. Historical prices, awards and audit records are preserved.',
            })
          )
            save.mutate();
        }}
      >
        {active ? 'Deactivate' : 'Activate'}
      </Button>
      {save.isError && <p role="alert">{save.error.message}</p>}
    </>
  );
}

function NewTierDiscountForm({
  services,
  onSaved,
  disabled,
}: {
  services: { id: string; name: string }[];
  onSaved: () => void;
  disabled: boolean;
}) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [tier, setTier] = useState<'BRONZE' | 'SILVER' | 'GOLD'>('GOLD');
  const [rate, setRate] = useState('25');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useBusinessMutation({
    mutationFn: async () => {
      for (const serviceId of serviceIds) {
        await createTierDiscount({
          serviceId,
          tier,
          discountRate: Number(rate),
          effectiveStart: start,
          effectiveEnd: end,
        });
        setServiceIds((current) => current.filter((id) => id !== serviceId));
        onSaved();
      }
    },
    retry: false,
    onSuccess: () => {
      setRate('25');
      setStart('');
      setEnd('');
      setError(null);
      notifySuccess({ title: 'Tier discount added' });
      onSaved();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not add the rate.'),
  });

  const rateNumber = Number(rate);
  const rateValid = rateNumber > 0 && rateNumber <= 100;
  const datesOrdered = Boolean(start && end) && start < end;

  return (
    <div aria-busy={save.isPending}>
      <h3>Add a tier discount</h3>
      <p>Select one or more services. Save a separate percentage for each VIP tier.</p>
      <label htmlFor="tier-service">Service</label>
      <select
        id="tier-service"
        multiple
        disabled={save.isPending}
        value={serviceIds}
        onChange={(e) =>
          setServiceIds(
            Array.from(e.target.selectedOptions, (option) => option.value).filter(Boolean),
          )
        }
      >
        <option value="">Choose a service</option>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>

      <label htmlFor="tier-tier">VIP tier</label>
      <Select
        id="tier-tier"
        value={tier}
        onChange={(e) => setTier(e.target.value as 'BRONZE' | 'SILVER' | 'GOLD')}
        options={[
          { value: 'BRONZE', label: 'Bronze' },
          { value: 'SILVER', label: 'Silver' },
          { value: 'GOLD', label: 'Gold' },
        ]}
      />

      <label htmlFor="tier-rate">Discount percent</label>
      <input
        id="tier-rate"
        type="number"
        min={1}
        max={100}
        step="0.0001"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />

      <DateField
        id="tier-start"
        name="tierStart"
        label="Effective from"
        optional
        value={start}
        onChange={setStart}
      />

      <DateField
        id="tier-end"
        name="tierEnd"
        label="Effective to"
        optional
        value={end}
        onChange={setEnd}
      />

      <Button
        disabled={disabled || serviceIds.length === 0 || !rateValid || !datesOrdered}
        loading={save.isPending}
        loadingLabel="Saving…"
        onClick={async () => {
          if (
            await notifyConfirm({
              title: 'Save these service rules?',
              message: `${serviceIds.length} service(s) selected. Each receives its own rule. Existing transactions stay unchanged.`,
              confirmButtonText: 'Save rules',
            })
          )
            save.mutate();
        }}
      >
        Add tier discount
      </Button>
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}

function NewRuleForm({
  services,
  onSaved,
}: {
  services: { id: string; name: string; isActive: boolean }[];
  onSaved: () => void;
}) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [pointsAmount, setPointsAmount] = useState('');
  const [tiers, setTiers] = useState<Tier[]>(['GOLD']);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minimum, setMinimum] = useState('1');
  const [maximum, setMaximum] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useBusinessMutation({
    mutationFn: async () => {
      for (const serviceId of serviceIds) {
        await createEarningRule({
          serviceId,
          pointsAmount: Number(pointsAmount),
          eligibleTiers: tiers,
          // A year-long window from today, as an ISO instant. Sent explicitly
          // rather than defaulted server-side, so the rule's window is visible.
          effectiveStart: start,
          effectiveEnd: end,
          isActive: true,
          minQuantity: Number(minimum),
          maxAward: maximum ? Number(maximum) : null,
          promotionReference: null,
        });
        setServiceIds((current) => current.filter((id) => id !== serviceId));
        onSaved();
      }
    },
    retry: false,
    onSuccess: () => {
      setError(null);
      notifySuccess({ title: 'Earning rule added' });
      onSaved();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not add.'),
  });

  const toggleTier = (tier: Tier) =>
    setTiers((current) =>
      current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier],
    );

  return (
    <div aria-busy={save.isPending}>
      <h3>Add an earning rule</h3>
      <p>Select one or more services; each receives its own earning rule.</p>
      <label htmlFor="rule-service">Service</label>
      <select
        id="rule-service"
        multiple
        disabled={save.isPending}
        value={serviceIds}
        onChange={(e) =>
          setServiceIds(
            Array.from(e.target.selectedOptions, (option) => option.value).filter(Boolean),
          )
        }
      >
        <option value="">Choose a service</option>
        {services
          .filter((service) => service.isActive)
          .map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
      </select>

      <label htmlFor="rule-points">Points per service unit</label>
      <input
        id="rule-points"
        type="number"
        min={1}
        value={pointsAmount}
        onChange={(e) => setPointsAmount(e.target.value)}
      />

      <fieldset>
        <legend>Eligible tiers</legend>
        {TIERS.map((tier) => (
          <label key={tier}>
            <input
              type="checkbox"
              checked={tiers.includes(tier)}
              onChange={() => toggleTier(tier)}
            />
            {tier}
          </label>
        ))}
      </fieldset>

      <p>
        Every award counts toward that tier&apos;s annual limit. There is no exemption from the cap.
      </p>
      <DateField
        id="rule-start"
        name="ruleStart"
        label="Effective from"
        optional
        value={start}
        onChange={setStart}
      />
      <DateField
        id="rule-end"
        name="ruleEnd"
        label="Effective to (exclusive)"
        optional
        value={end}
        onChange={setEnd}
      />
      <label htmlFor="rule-minimum">Minimum quantity</label>
      <input
        id="rule-minimum"
        type="number"
        min={1}
        step={1}
        value={minimum}
        onChange={(event) => setMinimum(event.target.value)}
      />
      <label htmlFor="rule-maximum">Maximum award (optional)</label>
      <input
        id="rule-maximum"
        type="number"
        min={1}
        step={1}
        value={maximum}
        onChange={(event) => setMaximum(event.target.value)}
      />

      <Button
        loading={save.isPending}
        loadingLabel="Saving…"
        disabled={
          serviceIds.length === 0 ||
          !pointsAmount ||
          tiers.length === 0 ||
          !start ||
          !end ||
          start >= end ||
          !minimum
        }
        onClick={async () => {
          if (
            await notifyConfirm({
              title: 'Save these service rules?',
              message: `${serviceIds.length} service(s) selected. Each receives its own rule. Existing transactions stay unchanged.`,
              confirmButtonText: 'Save rules',
            })
          )
            save.mutate();
        }}
      >
        Add rule
      </Button>
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}

function PromotionStatusButton({
  id,
  active,
  onSaved,
}: {
  id: string;
  active: boolean;
  onSaved: () => void;
}) {
  const save = useBusinessMutation({
    mutationFn: () => updateRedemptionRule(id, { isActive: !active }),
    retry: false,
    onSuccess: () => {
      notifySuccess({ title: 'Promotion status saved' });
      onSaved();
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        loading={save.isPending}
        loadingLabel={active ? 'Deactivating…' : 'Activating…'}
        onClick={async () => {
          if (
            await notifyConfirm({
              title: active ? 'Deactivate this promotion?' : 'Activate this promotion?',
              confirmButtonText: active ? 'Deactivate' : 'Activate',
              message:
                'Deactivation stops this promotion. Historical discounts and audit records are preserved.',
            })
          )
            save.mutate();
        }}
      >
        {active ? 'Deactivate' : 'Activate'}
      </Button>
      {save.isError && <p role="alert">{save.error.message}</p>}
    </>
  );
}

function NewPromotionForm({
  services,
  onSaved,
}: {
  services: { id: string; name: string; isActive: boolean; isStaycationEligible?: boolean }[];
  onSaved: () => void;
}) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [ruleKind, setRuleKind] = useState<'promotion' | 'accommodation'>('promotion');
  const [rate, setRate] = useState('');
  const [tiers, setTiers] = useState<Tier[]>(['GOLD']);
  const [minimum, setMinimum] = useState('1');
  const [maximum, setMaximum] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reference, setReference] = useState('');
  const [stacking, setStacking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useBusinessMutation({
    mutationFn: async () => {
      for (const serviceId of serviceIds) {
        await createRedemptionRule({
          serviceId,
          ruleKind,
          pesoValuePerPoint: rate,
          eligibleTiers: tiers,
          minPoints: Number(minimum),
          maxPoints: maximum ? Number(maximum) : null,
          minPurchaseAmount: null,
          effectiveStart: start,
          effectiveEnd: end,
          isActive: true,
          promotionReference: reference.trim(),
          allowDiscountStacking: stacking,
        });
        setServiceIds((current) => current.filter((id) => id !== serviceId));
        onSaved();
      }
    },
    retry: false,
    onSuccess: () => {
      setError(null);
      notifySuccess({ title: 'Spending promotion added' });
      onSaved();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not add.'),
  });

  const toggleTier = (tier: Tier) =>
    setTiers((current) =>
      current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier],
    );

  return (
    <div aria-busy={save.isPending}>
      <h3>Add a spending promotion</h3>
      <p>Select one or more services; each receives its own promotion or conversion rule.</p>
      <p>
        Selected services, both dates, and a named reference are all mandatory: a promotion that
        never expires, names nothing, or cannot be reviewed cannot be created.
      </p>
      <label htmlFor="promo-kind">Redemption rule type</label>
      <Select
        id="promo-kind"
        value={ruleKind}
        onChange={(event) =>
          setRuleKind(event.target.value === 'accommodation' ? 'accommodation' : 'promotion')
        }
        options={[
          { value: 'promotion', label: 'Service spending promotion' },
          { value: 'accommodation', label: 'Accommodation conversion rule' },
        ]}
      />
      <label htmlFor="promo-service">Service</label>
      <select
        id="promo-service"
        multiple
        disabled={save.isPending}
        value={serviceIds}
        onChange={(e) =>
          setServiceIds(
            Array.from(e.target.selectedOptions, (option) => option.value).filter(Boolean),
          )
        }
      >
        <option value="">Choose a service</option>
        {services
          .filter(
            (service) =>
              service.isActive && (ruleKind !== 'accommodation' || service.isStaycationEligible),
          )
          .map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
      </select>

      <TextField
        id="promo-rate"
        name="promoRate"
        label="Pesos per point (for example 1, or 0.5)"
        optional
        inputMode="decimal"
        value={rate}
        onChange={setRate}
      />

      <fieldset>
        <legend>Eligible tiers</legend>
        {TIERS.map((tier) => (
          <label key={tier}>
            <input
              type="checkbox"
              checked={tiers.includes(tier)}
              onChange={() => toggleTier(tier)}
            />
            {tier}
          </label>
        ))}
      </fieldset>

      <label htmlFor="promo-minimum">Minimum points</label>
      <input
        id="promo-minimum"
        type="number"
        min={1}
        step={1}
        value={minimum}
        onChange={(event) => setMinimum(event.target.value)}
      />
      <label htmlFor="promo-maximum">Maximum points (optional)</label>
      <input
        id="promo-maximum"
        type="number"
        min={1}
        step={1}
        value={maximum}
        onChange={(event) => setMaximum(event.target.value)}
      />
      <DateField
        id="promo-start"
        name="promoStart"
        label="Effective from"
        optional
        value={start}
        onChange={setStart}
      />
      <DateField
        id="promo-end"
        name="promoEnd"
        label="Effective to (exclusive)"
        optional
        value={end}
        onChange={setEnd}
      />
      <TextField
        id="promo-reference"
        name="promoReference"
        label="Promotion reference"
        value={reference}
        onChange={setReference}
        maxLength={200}
        placeholder="e.g. TEP-VALENTINES-2026"
      />
      <label>
        <input
          type="checkbox"
          checked={stacking}
          onChange={(event) => setStacking(event.target.checked)}
        />
        Permit combining with the VIP tier discount
      </label>
      <p>
        Off by default. When on, this promotion authorizes a points discount on a purchase that
        already carries a tier discount, for this service, tier and window only.
      </p>

      <Button
        loading={save.isPending}
        loadingLabel="Saving…"
        disabled={
          serviceIds.length === 0 ||
          !rate ||
          tiers.length === 0 ||
          !minimum ||
          !start ||
          !end ||
          start >= end ||
          reference.trim().length < 3
        }
        onClick={async () => {
          if (
            await notifyConfirm({
              title: 'Save these service rules?',
              message: `${serviceIds.length} service(s) selected. Each receives its own rule. Existing transactions stay unchanged.`,
              confirmButtonText: 'Save rules',
            })
          )
            save.mutate();
        }}
      >
        Add promotion
      </Button>
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}

function PolicyManagement({
  kind,
  id,
  values,
  mayDelete,
  onSaved,
}: {
  kind: 'rules' | 'tier-discounts' | 'redemption-rules';
  id: string;
  values: Record<string, string | number | boolean | string[] | null>;
  mayDelete: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(values);
  const save = useBusinessMutation({
    mutationFn: (patch: Record<string, unknown> | undefined) =>
      manageServicePolicy(kind, id, patch),
    retry: false,
    onSuccess: () => {
      setEditing(false);
      onSaved();
      notifySuccess({ title: 'Policy saved' });
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setFields(values);
          setEditing(true);
        }}
      >
        Edit
      </Button>
      {mayDelete && (
        <Button
          variant="secondary"
          loading={save.isPending}
          onClick={async () => {
            if (
              await notifyConfirm({
                title: 'Permanently delete this policy?',
                message:
                  'Unused policies are removed. Policies referenced by claims or quotes cannot be removed. Financial history is preserved.',
                confirmButtonText: 'Delete',
              })
            )
              save.mutate(undefined);
          }}
        >
          Delete
        </Button>
      )}
      {save.isError && <ErrorState title="Not saved" message={save.error.message} />}
      {editing && (
        <Dialog
          open
          title="Edit policy"
          onClose={() => {
            if (!save.isPending) setEditing(false);
          }}
          footer={
            <Button
              loading={save.isPending}
              onClick={async () => {
                if (
                  await notifyConfirm({
                    title: 'Save policy changes?',
                    message:
                      'Existing purchase snapshots remain unchanged. Policies used by claims or quotes are protected.',
                    confirmButtonText: 'Save',
                  })
                )
                  save.mutate(fields);
              }}
            >
              Save changes
            </Button>
          }
        >
          {Object.entries(fields).map(([key, value]) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              <input
                type={
                  typeof value === 'boolean'
                    ? 'checkbox'
                    : key.startsWith('effective_')
                      ? 'date'
                      : 'text'
                }
                checked={typeof value === 'boolean' ? value : undefined}
                value={
                  typeof value === 'boolean'
                    ? undefined
                    : Array.isArray(value)
                      ? value.join(',')
                      : (value ?? '')
                }
                onChange={(event) =>
                  setFields({
                    ...fields,
                    [key]:
                      typeof value === 'boolean'
                        ? event.target.checked
                        : Array.isArray(value)
                          ? event.target.value
                              .split(',')
                              .map((t) => t.trim().toUpperCase())
                              .filter(Boolean)
                          : event.target.value === '' &&
                              (key === 'max_award' ||
                                key === 'max_points' ||
                                key === 'promotion_reference')
                            ? null
                            : event.target.value,
                  })
                }
              />
            </label>
          ))}
        </Dialog>
      )}
    </>
  );
}
