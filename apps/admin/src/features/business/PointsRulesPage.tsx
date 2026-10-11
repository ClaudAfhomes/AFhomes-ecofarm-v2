import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  notifySuccess,
  notifyConfirm,
} from '@afhomes/ui';

import { ServiceCatalogEditor } from './ServiceCatalogEditor';
import { useSession } from '../../lib/session';
import {
  createEarningRule,
  setServicePolicyActive,
  listEarningRules,
  listTierDiscounts,
  createTierDiscount,
  listServices,
  listRedemptionRules,
  createRedemptionRule,
  updateRedemptionRule,
} from './points-services';

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

  const services = useQuery({ queryKey: ['earning', 'services'], queryFn: listServices });
  const rules = useQuery({ queryKey: ['earning', 'rules'], queryFn: listEarningRules });
  const tierDiscounts = useQuery({
    queryKey: ['earning', 'tier-discounts'],
    queryFn: listTierDiscounts,
  });
  const promotions = useQuery({
    queryKey: ['earning', 'redemption-rules'],
    queryFn: listRedemptionRules,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['earning'] });
  const serviceName = (id: string) =>
    (services.data ?? []).find((service) => service.id === id)?.name ?? 'Unknown service';

  return (
    <>
      <PageHeader
        title="Points Rules"
        description="What a member earns per service, and which services exist."
      />

      <ServiceCatalogEditor
        services={services.data ?? []}
        loading={services.isLoading}
        error={services.error}
        onSaved={invalidate}
      />
      <section aria-label="VIP tier discounts">
        <h2>VIP tier discounts</h2>
        <p>
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
            title="Tier discounts unavailable"
            message="The configured rates could not be loaded."
          />
        )}
        {tierDiscounts.data?.length === 0 && (
          <EmptyState
            title="No tier discounts configured"
            description="Every service sells at full price until a rate is configured for it."
          />
        )}
        {tierDiscounts.data && tierDiscounts.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Tier</th>
                <th scope="col">Discount</th>
                <th scope="col">Window</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {tierDiscounts.data.map((rule) => (
                <tr key={rule.id}>
                  <td>{serviceName(rule.serviceId)}</td>
                  <td>{rule.tier}</td>
                  <td>{rule.discountRate}%</td>
                  <td>
                    {rule.effectiveStart} to {rule.effectiveEnd}
                  </td>
                  <td>
                    {rule.isActive ? 'Active' : 'Inactive'}
                    {mayUpdate && (
                      <PolicyStatusButton
                        kind="tier-discounts"
                        id={rule.id}
                        active={rule.isActive}
                        onSaved={invalidate}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mayAdminister && (
          <NewTierDiscountForm
            services={services.data ?? []}
            onSaved={invalidate}
            disabled={services.isPending || tierDiscounts.isPending}
          />
        )}
      </section>

      <section aria-label="Earning rules">
        <h2>Earning rules</h2>
        {rules.isLoading && (
          <div role="status" aria-label="Loading earning rules" aria-busy="true">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {rules.isError && (
          <ErrorState title="Rules unavailable" message="The earning rules could not be loaded." />
        )}
        {rules.data?.length === 0 && (
          <EmptyState
            title="No earning rules"
            description="Without a rule, a purchase earns nothing. Add one to start accruing."
          />
        )}
        {rules.data && rules.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Window</th>
                <th scope="col">Points</th>
                <th scope="col">Tiers</th>
                <th scope="col">Min qty</th>
                <th scope="col">Max award</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((rule) => (
                <tr key={rule.id}>
                  <td>{serviceName(rule.serviceId)}</td>
                  <td>
                    {rule.effectiveStart} to {rule.effectiveEnd}
                  </td>
                  <td>{rule.pointsAmount}</td>
                  <td>{rule.eligibleTiers.join(', ')}</td>
                  <td>{rule.minQuantity}</td>
                  <td>{rule.maxAward ?? 'No limit'}</td>
                  <td>
                    {rule.isActive ? 'Yes' : 'No'}
                    {mayUpdate && (
                      <PolicyStatusButton
                        kind="rules"
                        id={rule.id}
                        active={rule.isActive}
                        onSaved={invalidate}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mayAdminister && <NewRuleForm services={services.data ?? []} onSaved={invalidate} />}
      </section>

      <section aria-label="Points spending promotions">
        <h2>Points spending promotions</h2>
        <p>
          What makes a NON-staycation service discountable by points, and at what conversion. A
          staycation or hotel service needs no promotion. Every other service refuses points
          spending unless an active promotion names it, covers the member&apos;s tier, and is
          inside its effective window. Both dates are mandatory: a promotion that never expires
          cannot be created. There is no cap exemption and no applies-to-everything option.
        </p>
        {promotions.isLoading && (
          <div role="status" aria-label="Loading spending promotions" aria-busy="true">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {promotions.isError && (
          <ErrorState
            title="Promotions unavailable"
            message="The spending promotions could not be loaded."
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
            className="table-scroll"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Tiers</th>
                  <th scope="col">Points range</th>
                  <th scope="col">Window</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Stacks with tier</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {promotions.data.map((rule) => (
                  <tr key={rule.id}>
                    <td>{serviceName(rule.serviceId)}</td>
                    <td>₱{rule.pesoValuePerPoint} / point</td>
                    <td>{rule.eligibleTiers.join(', ')}</td>
                    <td>
                      {rule.minPoints}
                      {rule.maxPoints === null ? '+' : `–${rule.maxPoints}`}
                    </td>
                    <td>
                      {rule.effectiveStart} to {rule.effectiveEnd}
                    </td>
                    <td>{rule.promotionReference ?? '—'}</td>
                    <td>{rule.allowDiscountStacking ? 'Yes' : 'No'}</td>
                    <td>
                      {rule.isActive ? 'Yes' : 'No'}
                      {mayUpdate && (
                        <PromotionStatusButton
                          id={rule.id}
                          active={rule.isActive}
                          onSaved={invalidate}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayAdminister && (
          <NewPromotionForm services={services.data ?? []} onSaved={invalidate} />
        )}
      </section>
    </>
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
  const save = useMutation({
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
                'Future eligibility changes. Existing sale prices and awarded points stay in the ledger.',
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
  const [serviceId, setServiceId] = useState('');
  const [tier, setTier] = useState<'BRONZE' | 'SILVER' | 'GOLD'>('GOLD');
  const [rate, setRate] = useState('25');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createTierDiscount({
        serviceId,
        tier,
        discountRate: Number(rate),
        effectiveStart: start,
        effectiveEnd: end,
      }),
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
      <label htmlFor="tier-service">Service</label>
      <select id="tier-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
        <option value="">Choose a service</option>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>

      <label htmlFor="tier-tier">VIP tier</label>
      <select
        id="tier-tier"
        value={tier}
        onChange={(e) => setTier(e.target.value as 'BRONZE' | 'SILVER' | 'GOLD')}
      >
        <option value="BRONZE">Bronze</option>
        <option value="SILVER">Silver</option>
        <option value="GOLD">Gold</option>
      </select>

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

      <label htmlFor="tier-start">Effective from</label>
      <input id="tier-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />

      <label htmlFor="tier-end">Effective to</label>
      <input id="tier-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />

      <Button
        disabled={disabled || !serviceId || !rateValid || !datesOrdered}
        loading={save.isPending}
        loadingLabel="Saving…"
        onClick={() => save.mutate()}
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
  const [serviceId, setServiceId] = useState('');
  const [pointsAmount, setPointsAmount] = useState('');
  const [tiers, setTiers] = useState<Tier[]>(['GOLD']);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minimum, setMinimum] = useState('1');
  const [maximum, setMaximum] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createEarningRule({
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
      }),
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
      <label htmlFor="rule-service">Service</label>
      <select id="rule-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
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
      <label htmlFor="rule-start">Effective from</label>
      <input
        id="rule-start"
        type="date"
        value={start}
        onChange={(event) => setStart(event.target.value)}
      />
      <label htmlFor="rule-end">Effective to (exclusive)</label>
      <input
        id="rule-end"
        type="date"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
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
          !serviceId ||
          !pointsAmount ||
          tiers.length === 0 ||
          !start ||
          !end ||
          start >= end ||
          !minimum
        }
        onClick={() => save.mutate()}
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
  const save = useMutation({
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
                'Future spending eligibility changes. Past discounts keep the rate they were given.',
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
  services: { id: string; name: string; isActive: boolean; isStaycationEligible?:boolean }[];
  onSaved: () => void;
}) {
  const [serviceId, setServiceId] = useState('');
  const [ruleKind,setRuleKind]=useState<'promotion'|'accommodation'>('promotion');
  const [rate, setRate] = useState('');
  const [tiers, setTiers] = useState<Tier[]>(['GOLD']);
  const [minimum, setMinimum] = useState('1');
  const [maximum, setMaximum] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reference, setReference] = useState('');
  const [stacking, setStacking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createRedemptionRule({
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
      }),
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
      <p>
        One service, both dates, and a named reference are all mandatory: a promotion that never
        expires, names nothing, or cannot be reviewed cannot be created.
      </p>
      <label htmlFor="promo-kind">Redemption rule type</label><select id="promo-kind" value={ruleKind} onChange={event=>setRuleKind(event.target.value==='accommodation'?'accommodation':'promotion')}><option value="promotion">Service spending promotion</option><option value="accommodation">Accommodation conversion rule</option></select>
      <label htmlFor="promo-service">Service</label>
      <select
        id="promo-service"
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
      >
        <option value="">Choose a service</option>
        {services
          .filter((service) => service.isActive&&(ruleKind!=='accommodation'||service.isStaycationEligible))
          .map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
      </select>

      <label htmlFor="promo-rate">Pesos per point (for example 1, or 0.5)</label>
      <input
        id="promo-rate"
        inputMode="decimal"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
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
      <label htmlFor="promo-start">Effective from</label>
      <input
        id="promo-start"
        type="date"
        value={start}
        onChange={(event) => setStart(event.target.value)}
      />
      <label htmlFor="promo-end">Effective to (exclusive)</label>
      <input
        id="promo-end"
        type="date"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
      />
      <label htmlFor="promo-reference">Promotion reference (required)</label>
      <input
        id="promo-reference"
        value={reference}
        onChange={(event) => setReference(event.target.value)}
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
          !serviceId ||
          !rate ||
          tiers.length === 0 ||
          !minimum ||
          !start ||
          !end ||
          start >= end ||
          reference.trim().length < 3
        }
        onClick={() => save.mutate()}
      >
        Add promotion
      </Button>
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}
