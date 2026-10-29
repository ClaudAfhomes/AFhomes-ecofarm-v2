export type DashboardInput = {
  sales: { status: string; created_at: string }[];
  payments: { status: string; amount: string; verified_at: string | null }[];
  memberships: { status: string; points_balance: number; activated_at: string }[];
  qualifications: { status: string }[];
  commissions: { status: string; amount: string }[];
  ost: { status: string }[];
  ostApplications: { status: string }[];
  staff: { status: string }[];
};
function cents(values: unknown[]) {
  let total = 0n;
  for (const value of values) {
    const match = String(value ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) total += BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function projectDashboard(input: DashboardInput, range: string) {
  const { sales, payments, memberships, qualifications, commissions, ost, ostApplications, staff } = input;
  const verifiedStatuses = new Set([
    'payment_verified',
    'final_qualification_pending',
    'qualified',
    'activated',
  ]);
  const verifiedSales = (sales ?? []).filter((s: { status: string }) =>
    verifiedStatuses.has(s.status),
  ).length;
  const verifiedPayments = (payments ?? []).filter(
    (p: { status: string }) => p.status === 'verified',
  );
  const daysByRange: Record<string, number> = { today: 1, week: 7, month: 31, year: 366 };
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (daysByRange[range] ?? daysByRange.month!) + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
  const trend = new Map<
    string,
    {
      period: string;
      verifiedSales: number;
      collections: string;
      activatedCards: number;
      pointsRedeemed: number;
      collectionValues: unknown[];
    }
  >();
  const pointFor = (value: unknown) => {
    if (!value) return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.valueOf()) || date < cutoff) return undefined;
    const period = date.toISOString().slice(0, 10);
    let point = trend.get(period);
    if (!point) {
      point = {
        period,
        verifiedSales: 0,
        collections: '0.00',
        activatedCards: 0,
        pointsRedeemed: 0,
        collectionValues: [],
      };
      trend.set(period, point);
    }
    return point;
  };
  for (const sale of sales ?? []) {
    if (verifiedStatuses.has(sale.status)) {
      const point = pointFor(sale.created_at);
      if (point) point.verifiedSales += 1;
    }
  }
  for (const payment of verifiedPayments) {
    const point = pointFor(payment.verified_at);
    if (point) point.collectionValues.push(payment.amount);
  }
  for (const membership of memberships ?? []) {
    if (membership.status === 'active') {
      const point = pointFor(membership.activated_at);
      if (point) point.activatedCards += 1;
    }
  }
  const trendPoints = [...trend.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(({ collectionValues, ...point }) => ({ ...point, collections: cents(collectionValues) }));
  return {
    totals: {
      verifiedSales,
      verifiedCollections: cents(verifiedPayments.map((p: { amount: string }) => p.amount)),
      activeMemberships: (memberships ?? []).filter(
        (m: { status: string }) => m.status === 'active',
      ).length,
      pendingAccounts: (sales ?? []).filter((s: { status: string }) => s.status === 'pending')
        .length,
      downPaymentAccounts: (sales ?? []).filter(
        (s: { status: string }) => s.status === 'down_payment',
      ).length,
      overdueAccounts: (sales ?? []).filter((s: { status: string }) => s.status === 'overdue')
        .length,
      pointsIssued: (memberships ?? []).reduce(
        (sum: number, m: { points_balance: number }) => sum + Number(m.points_balance ?? 0),
        0,
      ),
      pointsRedeemed: 0,
      pendingQualifications: (qualifications ?? []).filter(
        (q: { status: string }) => q.status === 'pending',
      ).length,
      earnedUnpaidCommissions: cents(
        (commissions ?? [])
          .filter((c: { status: string }) => c.status === 'earned')
          .map((c: { amount: string }) => c.amount),
      ),
      activeSellers: (ost ?? []).filter((o: { status: string }) => o.status === 'active').length,
      inactiveSellers: (ost ?? []).filter((o: { status: string }) => o.status !== 'active').length,
      activeEmployees: (staff ?? []).filter((s: { status: string }) => s.status === 'active')
        .length,
      inactiveEmployees: (staff ?? []).filter((s: { status: string }) => s.status !== 'active')
        .length,
    },
    queues: {
      paymentVerification: (payments ?? []).filter(
        (p: { status: string }) => p.status === 'recorded',
      ).length,
      cardActivation: (sales ?? []).filter((s: { status: string }) => s.status === 'qualified')
        .length,
      finalQualification: (sales ?? []).filter(
        (s: { status: string }) => s.status === 'final_qualification_pending',
      ).length,
      ostRegistrations: (ostApplications ?? []).filter((application: { status: string }) =>
        ['submitted', 'under_review'].includes(application.status),
      ).length,
      commissionPayouts: (commissions ?? []).filter(
        (c: { status: string }) => c.status === 'earned',
      ).length,
    },
    trend: trendPoints,
  };
}
