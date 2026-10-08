import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  DetailGrid,
  DetailMono,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
} from '@afhomes/ui';
import { CUSTOMER_CATEGORY_LABELS } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { getCustomerById } from './services';
import styles from './CustomerDetailPage.module.css';

/**
 * Single customer record, reached by clicking a directory row.
 *
 * Read-only: every field comes from `GET /customers/:id` (same RPC as the
 * directory, narrowed by id). Details are grouped so identity, contact,
 * verification and membership read as a hierarchy instead of one flat list.
 * Actions that change the record (new application, activation link,
 * deactivation) stay on the directory row menu and the application editors -
 * this screen never mutates.
 */
export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useQuery({
    queryKey: ['business', 'customer', id],
    queryFn: () => getCustomerById(id ?? ''),
    enabled: Boolean(id),
  });

  if (customer.isPending) return <p role="status">Loading customer…</p>;
  if (customer.isError) return <ErrorState error={customer.error} onRetry={customer.refetch} />;
  if (!customer.data)
    return <EmptyState title="Customer not found." description="It may have been deleted." />;

  const record = customer.data;
  const groups: Array<{ title: string; fields: Array<[string, ReactNode]> }> = [
    {
      title: 'Customer',
      fields: [
        ['Full name', record.fullName],
        ['Customer ID', <DetailMono key="id">{record.customerNumber}</DetailMono>],
        [
          'Customer code',
          record.customerCode ? <DetailMono key="code">{record.customerCode}</DetailMono> : '—',
        ],
        ['Status', <StatusChip key="status" label={record.status} />],
        [
          'Category',
          record.derivedCategory ? CUSTOMER_CATEGORY_LABELS[record.derivedCategory] : '—',
        ],
        ['Portal account', record.portalAccountActivated ? 'Activated' : 'Not activated'],
        ['Registered', record.createdAt ? formatDateTime(record.createdAt) : '—'],
      ],
    },
    {
      title: 'Contact',
      fields: [
        ['Email', record.email],
        ['Phone', record.phone],
        ['Date of birth', record.dateOfBirth ?? '—'],
        ['Gender', record.gender ?? '—'],
      ],
    },
    {
      title: 'Verification',
      fields: [
        ['ID type', record.governmentIdType ?? '—'],
        // Only ever the masked form; the API never returns the number.
        ['Government ID', record.governmentIdMasked ?? '—'],
      ],
    },
    {
      title: 'Membership',
      fields: [['Active membership', record.hasActiveMembership ? 'Yes' : 'No']],
    },
  ];

  return (
    <section>
      <PageHeader title={record.fullName} description={`Customer ${record.customerNumber}`} />
      <p className={styles.back}>
        <Link to="/admin/customers">Back to customers</Link>
      </p>
      <DetailGrid>
        {groups.map((group) => (
          <DetailCard key={group.title}>
            <DetailCardTitle>{group.title}</DetailCardTitle>
            <DetailFieldGrid>
              {group.fields.map(([label, value]) => (
                <DetailField key={label} label={label}>
                  {value}
                </DetailField>
              ))}
            </DetailFieldGrid>
          </DetailCard>
        ))}
      </DetailGrid>
    </section>
  );
}
