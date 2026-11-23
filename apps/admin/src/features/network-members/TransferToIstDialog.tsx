import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IST_POSITIONS,
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  transferMemberSchema,
  type IstPosition,
  type Member,
  type MemberPosition,
} from '@afhomes/contracts';
import { Alert, Button, Dialog, Select, TextField } from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getAccreditation } from '../ost/services';
import { getMemberUplines, transferMember } from './services';
import styles from './MembersPage.module.css';

/**
 * OST -> IST conversion. The member keeps their record and login; the held
 * number is retired into the accreditation history and an AAI successor is
 * issued. The server owns every gate (expired accreditation, position,
 * immediate head, administrator role); this dialog mirrors the ones a click
 * can settle, so a refusal is visible before the request leaves.
 */
export function TransferToIstDialog({
  member,
  onClose,
  onTransferred,
}: {
  member: Member;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [targetPosition, setTargetPosition] = useState<IstPosition | ''>('');
  const [headStaffId, setHeadStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const records = useQuery({
    queryKey: ['ost', 'ist-conversion-accreditation', member.id],
    queryFn: () => getAccreditation('members', member.id),
  });
  const currentTerm = records.data?.terms.find(
    (term) => term.displayStatus === 'active' || term.displayStatus === 'expired',
  );
  const expired = currentTerm?.displayStatus === 'expired';
  const uplineRole = targetPosition ? MEMBER_UPLINE_ROLE[targetPosition] : null;
  const heads = useQuery({
    queryKey: ['network', 'members', 'uplines', targetPosition],
    queryFn: () => getMemberUplines(targetPosition as MemberPosition),
    enabled: targetPosition !== '' && uplineRole !== null,
  });
  const convert = useBusinessMutation({
    mutationFn: (input: Parameters<typeof transferMember>[1]) => transferMember(member.id, input),
  });
  const ready =
    expired &&
    targetPosition !== '' &&
    (uplineRole === null || headStaffId !== '') &&
    reason.trim().length >= 5;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = transferMemberSchema.safeParse({
      direction: 'OST_TO_IST',
      requestId,
      reason,
      targetPosition,
      headStaffId: headStaffId || null,
    });
    if (!parsed.success) {
      setError('Choose the new position and its immediate head, and give a reason.');
      return;
    }
    setError('');
    convert.mutate(parsed.data, {
      onSuccess: onTransferred,
      onError: (failure) => setError(failure.message),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Transfer ${member.fullName} to IST`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={convert.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="ist-transfer"
            loading={convert.isPending}
            loadingLabel="Transferring…"
            disabled={!ready}
          >
            Transfer to IST
          </Button>
        </>
      }
    >
      <form id="ist-transfer" className={styles.dialogBody} onSubmit={submit}>
        <p className={styles.sectionHint}>
          Leaves OST for the selling hierarchy. The held number {member.aaNumber ?? ''} is retired —
          never renumbered — and gets an AAI employee identity without accreditation expiry. Past
          sales, commissions and team history are preserved.
        </p>
        <p className={styles.sectionHint}>
          Current Sales Manager: {member.referrerName ?? 'Not recorded'}.
        </p>
        {records.isPending ? <p role="status">Checking accreditation expiry…</p> : null}
        {records.isError ? (
          <Alert variant="danger" title="Unable to check accreditation">
            <Button type="button" onClick={() => void records.refetch()}>
              Retry expiry check
            </Button>
          </Alert>
        ) : null}
        {!records.isPending && !records.isError && !expired ? (
          <Alert variant="warning" title="Transfer to IST is unavailable">
            <p>OST accreditation must expire before a transfer to IST can be approved.</p>
          </Alert>
        ) : null}
        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>New position</legend>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              Position
              <Select
                value={targetPosition}
                onChange={(event) => {
                  setTargetPosition(event.target.value as IstPosition | '');
                  setHeadStaffId('');
                }}
                disabled={!expired}
                options={[
                  { value: '', label: 'Choose an IST position' },
                  ...IST_POSITIONS.map((value) => ({
                    value,
                    label: MEMBER_POSITION_LABELS[value],
                  })),
                ]}
              />
            </label>
            {uplineRole !== null ? (
              <label className={styles.fieldLabel}>
                {MEMBER_POSITION_LABELS[uplineRole]}
                <Select
                  value={headStaffId}
                  onChange={(event) => setHeadStaffId(event.target.value)}
                  disabled={!expired || heads.isPending}
                  options={[
                    { value: '', label: `Choose the ${MEMBER_POSITION_LABELS[uplineRole]}` },
                    ...(heads.data ?? []).map((holder) => ({
                      value: holder.id,
                      label: holder.fullName,
                    })),
                  ]}
                />
              </label>
            ) : null}
            {uplineRole !== null && heads.isError ? (
              <Alert variant="danger" title="Heads failed to load">
                <p className={styles.alertText}>The head list is unavailable.</p>
                <div className={styles.alertActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void heads.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              </Alert>
            ) : uplineRole !== null && !heads.isPending && (heads.data ?? []).length === 0 ? (
              <Alert variant="info" title="No heads found">
                <p>Add a {MEMBER_POSITION_LABELS[uplineRole]} first.</p>
              </Alert>
            ) : null}
            <TextField
              id="ist-transfer-reason"
              name="ist-transfer-reason"
              label="Reason for transfer"
              value={reason}
              onChange={setReason}
              maxLength={300}
            />
          </div>
        </fieldset>
        {error ? (
          <Alert variant="danger" title="Member was not transferred">
            <p>{error}</p>
          </Alert>
        ) : null}
      </form>
    </Dialog>
  );
}
