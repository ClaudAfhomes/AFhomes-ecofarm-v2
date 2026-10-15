import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  ConfirmDialog,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import type { Member } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import { deleteAfHomesStaff } from '../afhomes/services';
import { networkMemberKeys, updateMember } from './services';
import styles from './MembersPage.module.css';

function value(row: Member, key: keyof Member): string {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : '—';
}

/**
 * One member's full record: read the profile, edit its fields, or delete the
 * account. Position, department and head stay fixed here: a head change is a
 * genealogy move and belongs to the upline desk.
 */
export function MemberDetailDialog({
  member,
  onClose,
  onChanged,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [mobileNo, setMobileNo] = useState(member.mobileNo ?? '');
  const [telNo, setTelNo] = useState(member.telNo ?? '');
  const [fbMessenger, setFbMessenger] = useState(member.fbMessenger ?? '');
  const [streetNo, setStreetNo] = useState(member.streetNo ?? '');
  const [cityMunicipality, setCityMunicipality] = useState(member.cityMunicipality ?? '');
  const [province, setProvince] = useState(member.province ?? '');
  const [zipCode, setZipCode] = useState(member.zipCode ?? '');
  const [employerName, setEmployerName] = useState(member.employerName ?? '');
  const [employerAddress, setEmployerAddress] = useState(member.employerAddress ?? '');
  const [jobPosition, setJobPosition] = useState(member.jobPosition ?? '');

  const invalidate = () => client.invalidateQueries({ queryKey: networkMemberKeys.scope });

  const save = useBusinessMutation({
    mutationFn: () =>
      updateMember(member.id, {
        mobileNo: mobileNo.trim(),
        telNo: telNo.trim() || undefined,
        fbMessenger: fbMessenger.trim() || undefined,
        streetNo: streetNo.trim(),
        cityMunicipality: cityMunicipality.trim(),
        province: province.trim(),
        zipCode: zipCode.trim(),
        employerName: employerName.trim(),
        employerAddress: employerAddress.trim(),
        jobPosition: jobPosition.trim(),
      }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      notifySuccess({ title: 'Member updated', message: 'Member record saved.' });
      onChanged();
    },
  });

  const remove = useBusinessMutation({
    mutationFn: () => deleteAfHomesStaff(member.id),
    onSuccess: async () => {
      await invalidate();
      onChanged();
      onClose();
      notifySuccess({ title: 'Member deleted', message: 'Member removed.' });
    },
  });

  const canDelete =
    user?.roleSlug === 'super_admin' && user.id !== member.id;

  return (
    <>
      <Dialog
        open={!editing && !confirmDelete}
        onClose={onClose}
        title={member.fullName}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {canDelete ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      >
        <div className={styles.dialogBody}>
          <div className={styles.heroChips}>
            <StatusChip label={member.positionLabel} tone="neutral" />
            <StatusChip
              label={member.status}
              tone={member.status === 'active' ? 'success' : 'neutral'}
            />
            {member.aaNumber ? (
              <StatusChip label={member.aaNumber} tone="info" />
            ) : null}
          </div>
          <DetailCard>
            <DetailCardTitle>Identity</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Code">{value(member, 'employeeNumber')}</DetailField>
              <DetailField label="Email">{value(member, 'email')}</DetailField>
              <DetailField label="Birth date">{value(member, 'dateOfBirth')}</DetailField>
              <DetailField label="Sex">{value(member, 'sex')}</DetailField>
              <DetailField label="Civil status">{value(member, 'civilStatus')}</DetailField>
              <DetailField label="Department">{value(member, 'departmentName')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Address and contact</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="No. / Street">{value(member, 'streetNo')}</DetailField>
              <DetailField label="City">{value(member, 'cityMunicipality')}</DetailField>
              <DetailField label="Province">{value(member, 'province')}</DetailField>
              <DetailField label="ZIP">{value(member, 'zipCode')}</DetailField>
              <DetailField label="Tel">{value(member, 'telNo')}</DetailField>
              <DetailField label="Mobile">{value(member, 'mobileNo')}</DetailField>
              <DetailField label="FB / Messenger">{value(member, 'fbMessenger')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Work and IDs</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Employer">{value(member, 'employerName')}</DetailField>
              <DetailField label="Employer address">
                {value(member, 'employerAddress')}
              </DetailField>
              <DetailField label="Job position">{value(member, 'jobPosition')}</DetailField>
              <DetailField label="ID type">{value(member, 'governmentIdType')}</DetailField>
              <DetailField label="ID number">{member.governmentIdMasked ?? '—'}</DetailField>
              <DetailField label="TIN">{member.tinMasked ?? '—'}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <DetailCardTitle>Network</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Head">{member.referrerName ?? '—'}</DetailField>
              <DetailField label="OST referrer">{member.ostReferrerName ?? '—'}</DetailField>
              <DetailField label="AA number">{value(member, 'aaNumber')}</DetailField>
            </DetailFieldGrid>
          </DetailCard>
        </div>
      </Dialog>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${member.fullName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending || mobileNo.trim() === ''} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <p className={styles.sectionHint}>
            Position, department and head stay fixed here.
          </p>
          <div className={styles.formFields}>
            <div className={styles.inlinePair}>
              <TextField
                id="member-edit-mobile"
                name="member-edit-mobile"
                label="Mobile No."
                value={mobileNo}
                onChange={setMobileNo}
              />
              <TextField
                id="member-edit-tel"
                name="member-edit-tel"
                label="Tel No."
                value={telNo}
                onChange={setTelNo}
                optional
              />
            </div>
            <TextField
              id="member-edit-fb"
              name="member-edit-fb"
              label="FB / Messenger Name"
              value={fbMessenger}
              onChange={setFbMessenger}
              optional
            />
            <TextField
              id="member-edit-street"
              name="member-edit-street"
              label="No. / Street"
              value={streetNo}
              onChange={setStreetNo}
            />
            <div className={styles.inlinePair}>
              <TextField
                id="member-edit-city"
                name="member-edit-city"
                label="City / Municipality"
                value={cityMunicipality}
                onChange={setCityMunicipality}
              />
              <TextField
                id="member-edit-province"
                name="member-edit-province"
                label="Province"
                value={province}
                onChange={setProvince}
              />
            </div>
            <TextField
              id="member-edit-zip"
              name="member-edit-zip"
              label="ZIP Code"
              value={zipCode}
              onChange={setZipCode}
            />
            <TextField
              id="member-edit-employer"
              name="member-edit-employer"
              label="Business / Employer Name"
              value={employerName}
              onChange={setEmployerName}
            />
            <TextField
              id="member-edit-employer-address"
              name="member-edit-employer-address"
              label="Business / Employer Address"
              value={employerAddress}
              onChange={setEmployerAddress}
            />
            <TextField
              id="member-edit-job"
              name="member-edit-job"
              label="Job Position"
              value={jobPosition}
              onChange={setJobPosition}
            />
          </div>
          {save.error ? <p role="alert">{save.error.message}</p> : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteConfirmation('');
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete member?"
        message={
          <div>
            <p>Delete {member.fullName}? This cannot be undone.</p>
            <TextField
              id="member-delete-confirm"
              name="member-delete-confirm"
              label="Type DELETE to confirm"
              value={deleteConfirmation}
              onChange={setDeleteConfirmation}
            />
            {remove.error ? <p role="alert">{remove.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel="Delete"
        confirmDisabled={deleteConfirmation !== 'DELETE'}
        confirmLoading={remove.isPending}
      />
    </>
  );
}
