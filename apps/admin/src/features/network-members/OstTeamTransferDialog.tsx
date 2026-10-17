import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { transferOstTeamSchema, type Member } from '@afhomes/contracts';
import { Alert, Button, Dialog, Select, TextField } from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getAccreditation, getOstSponsors } from '../ost/services';
import { transferOstTeam } from './services';
import styles from './MembersPage.module.css';

export function OstTeamTransferDialog({
  member,
  onClose,
  onTransferred,
}: {
  member: Member;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [sponsorStaffId, setSponsorStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const sponsors = useQuery({ queryKey: ['ost', 'manual-sponsors'], queryFn: getOstSponsors });
  const records = useQuery({
    queryKey: ['ost', 'team-transfer-accreditation', member.id],
    queryFn: () => getAccreditation('members', member.id),
  });
  const currentTerm = records.data?.terms.find(
    (term) => term.displayStatus === 'active' || term.displayStatus === 'expired',
  );
  const expired = currentTerm?.displayStatus === 'expired';
  const move = useBusinessMutation({
    mutationFn: (input: Parameters<typeof transferOstTeam>[1]) => transferOstTeam(member.id, input),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Transfer OST team: ${member.fullName}`}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={move.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="ost-team-transfer"
            loading={move.isPending}
            disabled={!expired || !sponsorStaffId || !approved || reason.trim().length < 5}
          >
            Approve team transfer
          </Button>
        </>
      }
    >
      <form
        id="ost-team-transfer"
        className={styles.dialogBody}
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = transferOstTeamSchema.safeParse({
            requestId,
            sponsorStaffId,
            reason,
            managementApproved: approved,
          });
          if (!parsed.success) {
            setError(
              'Choose the new Sales Manager, give a reason and confirm management approval.',
            );
            return;
          }
          move.mutate(parsed.data, {
            onSuccess: onTransferred,
            onError: (failure) => setError(failure.message),
          });
        }}
      >
        <p>
          Remains OST. AA number {member.aaNumber ?? 'not recorded'} and accreditation dates stay
          unchanged. Past sales and team history are preserved.
        </p>
        <p>Current Sales Manager: {member.referrerName ?? 'Not recorded'}.</p>
        {records.isPending ? <p role="status">Checking accreditation expiry…</p> : null}
        {records.isError ? (
          <Alert variant="danger" title="Unable to check accreditation">
            <Button type="button" onClick={() => void records.refetch()}>
              Retry expiry check
            </Button>
          </Alert>
        ) : null}
        {!records.isPending && !records.isError && !expired ? (
          <Alert variant="warning" title="Team transfer is unavailable">
            <p>OST accreditation must expire before a team transfer can be approved.</p>
          </Alert>
        ) : null}
        <fieldset className={styles.formSection}>
          <legend className={styles.sectionTitle}>New team</legend>
          <div className={styles.formFields}>
            <label className={styles.fieldLabel}>
              New Sales Manager
              <Select
                required
                value={sponsorStaffId}
                onChange={(event) => setSponsorStaffId(event.target.value)}
                disabled={sponsors.isPending || !expired}
                options={[
                  { value: '', label: 'Choose a different active Sales Manager' },
                  ...(sponsors.data ?? [])
                    .filter((s) => s.id !== member.referrerStaffId)
                    .map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </label>
            <p className={styles.sectionHint}>
              The OST joins the selected SM’s existing SSM and VD team. No IST conversion or renewal
              is performed.
            </p>
            {sponsors.isError ? (
              <Button type="button" variant="secondary" onClick={() => void sponsors.refetch()}>
                Retry Sales Managers
              </Button>
            ) : null}
            <TextField
              id="ost-team-reason"
              name="reason"
              label="Reason for team transfer"
              value={reason}
              onChange={setReason}
              maxLength={300}
            />
            <label>
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
                required
              />{' '}
              I approve this expired OST’s team transfer as management.
            </label>
          </div>
        </fieldset>
        {error ? (
          <Alert variant="danger" title="Team was not changed">
            <p>{error}</p>
          </Alert>
        ) : null}
      </form>
    </Dialog>
  );
}
