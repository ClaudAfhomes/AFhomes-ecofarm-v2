import { useState } from 'react';
import type { GenealogyNode } from '@afhomes/contracts';
import { Alert, Select } from '@afhomes/ui';
import { ApplicationChoiceCards } from './ApplicationChoiceCards';
import { EMPTY_APPLICATION_CHAIN, resolveApplicationNetwork } from './application-network';
import type { ReferralChainIds } from './official-forms-fields';
import styles from './OfficialFormsPages.module.css';

export function ApplicationNetworkSelection({
  nodes,
  kind,
  onKindChange,
  chain,
  onChain,
  loading,
  failed,
}: {
  nodes: readonly GenealogyNode[];
  kind: 'OST' | 'IST';
  onKindChange: (kind: 'OST' | 'IST') => void;
  chain: ReferralChainIds;
  onChain: (chain: ReferralChainIds) => void;
  loading: boolean;
  failed: boolean;
}) {
  const [error, setError] = useState('');
  const selected =
    kind === 'OST'
      ? chain.referrerStaffId
      : chain.smStaffId || chain.ssmStaffId || chain.svdStaffId;
  const member = nodes.find((node) => node.staffId === selected);
  const head = member?.uplineStaffId
    ? nodes.find((node) => node.staffId === member.uplineStaffId)
    : null;
  const options = nodes.filter(
    (node) =>
      node.status === 'active' &&
      (!node.ostStatus || node.ostStatus === 'active') &&
      (kind === 'OST' ? node.role === 'ost' : node.role !== 'ost'),
  );
  return (
    <div className={styles.networkSelection}>
      <ApplicationChoiceCards
        label="IST/OST"
        value={kind}
        options={[
          { value: 'OST', label: 'OST', icon: 'users' },
          { value: 'IST', label: 'IST', icon: 'user' },
        ]}
        onChange={(next) => {
          setError('');
          onChain({ ...EMPTY_APPLICATION_CHAIN });
          onKindChange(next as 'OST' | 'IST');
        }}
      />
      <div className={styles.editorGrid}>
        <label className={styles.filterLabel}>
          <span>
            Referring {kind} member <small>(optional)</small>
          </span>
          <Select
            aria-label={`Referring ${kind} member`}
            value={selected}
            loading={loading}
            disabled={loading || failed}
            options={[
              { value: '', label: loading ? 'Loading network…' : `Select ${kind} member` },
              ...options.map((node) => ({ value: node.staffId, label: node.fullName })),
            ]}
            onChange={(event) => {
              setError('');
              onChain({ ...EMPTY_APPLICATION_CHAIN });
              if (!event.target.value) return;
              try {
                onChain(resolveApplicationNetwork(nodes, event.target.value).chain);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Network relationship could not be resolved.',
                );
              }
            }}
          />
        </label>
        <div className={styles.directHead} aria-live="polite">
          <span className={styles.subGroupTitle}>Direct Head</span>
          <strong>
            {!member
              ? 'Select a referring member'
              : (head?.fullName ??
                (member.uplineStaffId
                  ? 'Unavailable — refresh the network list'
                  : 'No Direct Head assigned'))}
          </strong>
          <span className={styles.hint}>
            Filled from the selected member’s existing genealogy relationship.
          </span>
        </div>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {failed ? (
        <Alert variant="danger">
          Network members could not be loaded. Use Retry chain list below.
        </Alert>
      ) : null}
      {!loading && !failed && !options.length ? (
        <p role="status" className={styles.hint}>
          No available {kind} members.
        </p>
      ) : null}
    </div>
  );
}
