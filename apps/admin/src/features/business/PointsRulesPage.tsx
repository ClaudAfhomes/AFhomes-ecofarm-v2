import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Spinner,
  StatusChip,
  notifySuccess,
} from '@afhomes/ui';

import styles from './points.module.css';
import {
  createEarningRule,
  createRedemptionRule,
  createService,
  listEarningRules,
  listRedemptionRules,
  listServices,
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
  const services = useQuery({ queryKey: ['earning', 'services'], queryFn: listServices });
  const rules = useQuery({ queryKey: ['earning', 'rules'], queryFn: listEarningRules });
  const promotions = useQuery({
    queryKey: ['earning', 'redemption-rules'],
    queryFn: listRedemptionRules,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['earning'] });

  /**
   * Toggling a promotion off is reversible, so it is allowed. Widening one, or
   * removing its end date, is not offered here at all - there is no field for it.
   */
  const toggle = useMutation({
    mutationFn: updateRedemptionRule,
    onSuccess: invalidate,
  });

  const serviceName = (id: string) =>
    (services.data ?? []).find((s) => s.id === id)?.name ?? 'Unknown service';

  return (
    <>
      <PageHeader
        title="Points Rules"
        description="What a member earns per service, and which services exist."
      />

      <section aria-label="Service catalog">
        <h2>Services</h2>
        {services.isLoading && <Skeleton />}
        {services.isError && (
          <ErrorState title="Services unavailable" message="The catalog could not be loaded." />
        )}
        {services.data?.length === 0 && (
          <EmptyState
            title="No services yet"
            description="Add the first service before creating an earning rule."
          />
        )}
        {services.data && services.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Service</th>
                <th scope="col">Price</th>
                <th scope="col">Active</th>
              </tr>
            </thead>
            <tbody>
              {services.data.map((service) => (
                <tr key={service.id}>
                  <td>{service.code}</td>
                  <td>{service.name}</td>
                  <td>{service.basePrice}</td>
                  <td>{service.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <NewServiceForm onSaved={invalidate} disabled={services.isPending} />
      </section>

      <section aria-label="Promotions">
        <h2>Promotions</h2>
        <p>
          A promotion makes a service that is NOT accommodation or staycation discountable by
          points, for a fixed window. It always names one service and always has an end date - there
          is no open-ended promotion, and no way to exempt points from the annual earning limit.
        </p>
        {promotions.isLoading && <Skeleton />}
        {promotions.isError && (
          <ErrorState title="Promotions unavailable" message="The promotions could not be loaded." />
        )}
        {promotions.data?.length === 0 && (
          <EmptyState
            title="No promotions"
            description="Only accommodation and staycation can be discounted with points right now."
          />
        )}
        {promotions.data && promotions.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Service</th>
                <th scope="col">₱ per point</th>
                <th scope="col">Tiers</th>
                <th scope="col">Window</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {promotions.data.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.promotionReference}</td>
                  <td>{serviceName(rule.serviceId)}</td>
                  <td>₱{rule.pesoValuePerPoint}</td>
                  <td>{rule.eligibleTiers.join(', ')}</td>
                  <td>
                    {rule.effectiveStart} → {rule.effectiveEnd}
                  </td>
                  <td>
                    <StatusChip
                      tone={activeNow(rule) ? 'success' : 'neutral'}
                      label={activeNow(rule) ? 'Active' : rule.isActive ? 'Not in window' : 'Off'}
                    />
                  </td>
                  <td>
                    <TogglePromotion
                      rule={rule}
                      disabled={toggle.isPending}
                      onToggle={(next) => toggle.mutate({ id: rule.id, isActive: next })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {toggle.isError && <ErrorState title="Not saved" message={toggleMessage(toggle.error)} />}
        {toggle.isPending && <Spinner label="Saving the promotion" />}
        <NewPromotionForm services={services.data ?? []} onSaved={invalidate} />
      </section>

      <section aria-label="Earning rules">
        <h2>Earning rules</h2>
        {rules.isLoading && <Skeleton />}
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
                  <td>{rule.pointsAmount}</td>
                  <td>{rule.eligibleTiers.join(', ')}</td>
                  <td>{rule.minQuantity}</td>
                  <td>{rule.maxAward ?? 'No limit'}</td>
                  <td>{rule.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <NewRuleForm services={services.data ?? []} onSaved={invalidate} />
      </section>
    </>
  );
}

/**
 * Today in Manila, matching the half-open window the database compares against.
 *
 * Computed ONCE at module load rather than during render: a formatter call is
 * impure as far as the react-compiler lint is concerned, and a promotion window
 * that rolls over at midnight is a page reload away, not a correctness problem.
 * `ponytail:` recompute per render if a promotion is ever allowed to last weeks
 * across a midnights boundary without a reload.
 */
const MANILA_TODAY: string = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
}).format(new Date());

/** Default window end: one month out, so the field is explicit but needs no typing. */
const DEFAULT_PROMO_END: string = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

/** Active means enabled AND inside [start, end) today. An expired window is not "off". */
function activeNow(rule: {
  isActive: boolean;
  effectiveStart: string;
  effectiveEnd: string;
}): boolean {
  return (
    rule.isActive &&
    MANILA_TODAY >= rule.effectiveStart &&
    MANILA_TODAY < rule.effectiveEnd
  );
}

function toggleMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : 'The promotion could not be saved.';
}

function TogglePromotion({
  rule,
  disabled,
  onToggle,
}: {
  rule: { id: string; isActive: boolean };
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled}
      onClick={() => onToggle(!rule.isActive)}
    >
      {rule.isActive ? 'Turn off' : 'Turn on'}
    </Button>
  );
}

function NewServiceForm({ onSaved, disabled }: { onSaved: () => void; disabled: boolean }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => createService({ code, name, basePrice }),
    onSuccess: () => {
      setCode('');
      setName('');
      setBasePrice('');
      setError(null);
      notifySuccess({ title: 'Service added' });
      onSaved();
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not add.'),
  });

  return (
    <div aria-busy={save.isPending}>
      <h3>Add a service</h3>
      <label htmlFor="service-code">Code</label>
      <input id="service-code" value={code} onChange={(e) => setCode(e.target.value)} />
      <label htmlFor="service-name">Name</label>
      <input id="service-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="service-price">Price</label>
      <input
        id="service-price"
        inputMode="decimal"
        value={basePrice}
        onChange={(e) => setBasePrice(e.target.value)}
      />
      <Button
        disabled={disabled || save.isPending || !code || !name || !basePrice}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Add service'}
      </Button>
      {save.isPending && <Spinner label="Saving the service" />}
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}

/**
 * Create a promotion.
 *
 * The end date is a REQUIRED input with no "never" option and no way to clear it,
 * because an indefinite promotion is unrepresentable in the table. The default is
 * one month out, so the common case needs no typing and the field is still always
 * present and explicit.
 */
function NewPromotionForm({
  services,
  onSaved,
}: {
  services: { id: string; name: string; isActive: boolean; isStaycationEligible?: boolean }[];
  onSaved: () => void;
}) {
  const [serviceId, setServiceId] = useState('');
  const [reference, setReference] = useState('');
  const [rate, setRate] = useState('1.00');
  const [tiers, setTiers] = useState<Tier[]>(['GOLD']);
  const [start, setStart] = useState(MANILA_TODAY);
  const [end, setEnd] = useState(DEFAULT_PROMO_END);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createRedemptionRule({
        serviceId,
        pesoValuePerPoint: rate,
        eligibleTiers: tiers,
        minPoints: 1,
        maxPoints: null,
        minPurchaseAmount: null,
        effectiveStart: start,
        effectiveEnd: end,
        isActive: true,
        promotionReference: reference,
      }),
    onSuccess: () => {
      setReference('');
      setError(null);
      notifySuccess({ title: 'Promotion created' });
      onSaved();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not create the promotion.'),
  });

  const toggleTier = (tier: Tier) =>
    setTiers((current) =>
      current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier],
    );

  // A promotion is only meaningful for a service that is NOT already
  // staycation-eligible; offering it for a staycation service would be a way to
  // change a rate that needs no promotion at all.
  const promotable = services.filter(
    (service) => service.isActive && service.isStaycationEligible === false,
  );

  return (
    <div aria-busy={save.isPending}>
      <h3>Create a promotion</h3>
      {promotable.length === 0 && (
        <p className={styles.hint}>
          Every active service is already accommodation or staycation, so no promotion is needed.
        </p>
      )}
      <label htmlFor="promo-service">Service</label>
      <select id="promo-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
        <option value="">Choose a service</option>
        {promotable.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>

      <label htmlFor="promo-reference">Reference</label>
      <input
        id="promo-reference"
        value={reference}
        placeholder="Grand opening promo"
        onChange={(e) => setReference(e.target.value)}
      />

      <label htmlFor="promo-rate">Peso value per point</label>
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

      <label htmlFor="promo-start">Starts (inclusive)</label>
      <input
        id="promo-start"
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />

      <label htmlFor="promo-end">Ends (exclusive)</label>
      <input
        id="promo-end"
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />

      <Button
        disabled={save.isPending || !serviceId || !reference || tiers.length === 0 || start >= end}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Create promotion'}
      </Button>
      {save.isPending && <Spinner label="Saving the promotion" />}
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
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createEarningRule({
        serviceId,
        pointsAmount: Number(pointsAmount),
        eligibleTiers: tiers,
        // A year-long window from today, as an ISO instant. Sent explicitly
        // rather than defaulted server-side, so the rule's window is visible.
        effectiveStart: new Date().toISOString(),
        effectiveEnd: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        isActive: true,
        minQuantity: 1,
        maxAward: null,
        promotionReference: null,
      }),
    onSuccess: () => {
      setError(null);
      notifySuccess({ title: 'Earning rule added' });
      onSaved();
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not add.'),
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

      <label htmlFor="rule-points">Points per purchase</label>
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

      <Button
        disabled={save.isPending || !serviceId || !pointsAmount || tiers.length === 0}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Add rule'}
      </Button>
      {save.isPending && <Spinner label="Saving the rule" />}
      {error && <ErrorState title="Not saved" message={error} />}
    </div>
  );
}