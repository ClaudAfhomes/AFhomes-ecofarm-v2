/**
 * Create Member - a thin shell over the shared MemberFormDialog.
 *
 * The form itself (sections, controls, live filters) lives in
 * `MemberFormDialog`, which Edit renders too, so the two can never drift
 * apart. This file owns only the create-specific wiring: the create payload,
 * the client-side contract check that names a mistyped field before the
 * request leaves, and the success/error handling.
 */
import { createMemberSchema } from '@afhomes/contracts';
import { notifyError, notifySuccess } from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { ApiError, errorFieldEntries } from '../../lib/api/errors';
import {
  MemberFormDialog,
  type MemberFormSeed,
  type MemberFormValues,
} from './MemberFormDialog';
import { createMember } from './services';

/** A blank record. Create always mounts the form with exactly this seed. */
const EMPTY_MEMBER_SEED: MemberFormSeed = {
  position: 'sales_manager',
  fullName: '',
  dateOfBirth: '',
  sex: '',
  civilStatus: '',
  streetNo: '',
  province: '',
  provinceCode: '',
  cityMunicipality: '',
  cityMunicipalityCode: '',
  zipCode: '',
  telNo: '',
  mobileNo: '',
  fbMessenger: '',
  employerName: '',
  employerAddress: '',
  jobPosition: '',
  governmentIdType: '',
  governmentIdNumber: '',
  tin: '',
  email: '',
  headStaffId: '',
  ostReferrerStaffId: '',
};

export function CreateMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const save = useBusinessMutation({
    mutationFn: (values: MemberFormValues) => {
      // Client-side first net: the SAME contract the server enforces, so a
      // mistyped field is named before the request leaves (the server stays
      // authoritative and re-checks everything, including head, department
      // and duplicates, which only it can judge).
      const payload = {
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        temporaryPassword: values.temporaryPassword,
        departmentId: values.departmentId,
        position: values.position,
        dateOfBirth: values.dateOfBirth,
        sex: values.sex as 'Male' | 'Female',
        civilStatus: values.civilStatus as 'Single' | 'Married' | 'Widowed' | 'Separated',
        streetNo: values.streetNo.trim(),
        cityMunicipality: values.cityMunicipality.trim(),
        province: values.province.trim(),
        provinceCode: values.provinceCode,
        cityMunicipalityCode: values.cityMunicipalityCode,
        zipCode: values.zipCode.trim(),
        telNo: values.telNo.trim() || undefined,
        mobileNo: values.mobileNo.trim(),
        fbMessenger: values.fbMessenger.trim() || undefined,
        tin: values.tin.trim() || undefined,
        employerName: values.employerName.trim(),
        employerAddress: values.employerAddress.trim(),
        jobPosition: values.jobPosition.trim(),
        governmentIdType: values.governmentIdType as
          | 'philippine_id'
          | 'drivers_license'
          | 'passport'
          | 'tax_id'
          | 'other',
        governmentIdNumber: values.governmentIdNumber.trim(),
        referrerStaffId: values.headStaffId || null,
        ostReferrerStaffId:
          values.position === 'sales_manager' ? values.ostReferrerStaffId || null : null,
        aaNumberMode: values.aaMode,
        aaNumber: values.aaMode === 'manual' ? values.aaNumber.trim().toUpperCase() || undefined : undefined,
      };
      const checked = createMemberSchema.safeParse(payload);
      if (!checked.success) {
        const details: Record<string, string> = {};
        for (const issue of checked.error.issues.slice(0, 8))
          details[issue.path.map(String).join('.') || 'form'] = issue.message;
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: 'Some fields need attention',
          status: 400,
          details,
        });
      }
      return createMember(checked.data);
    },
    onSuccess: (created) => {
      // The success popup carries the two identifiers the operator needs to
      // hand over: the staff code and the fresh AA number.
      const detail = [
        created.employeeNumber ? `Code: ${created.employeeNumber}` : '',
        created.aaNumber ? `AA number: ${created.aaNumber}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      notifySuccess({
        title: 'Member created',
        message: `${created.fullName} was added.`,
        ...(detail ? { detail } : {}),
      });
      onCreated();
    },
    // A centered modal, not just an inline line: a failed save must be
    // impossible to miss, wherever the dialog has scrolled.
    onError: (error) => {
      const fields = errorFieldEntries(error);
      notifyError({
        title: 'Member not created',
        message: error.message,
        ...(fields.length > 0
          ? { detail: fields.map(([field, reason]) => `${field}: ${reason}`).join('\n') }
          : {}),
      });
    },
  });

  if (!open) return null;
  return (
    <MemberFormDialog
      open
      mode="create"
      title="Create Member"
      seed={EMPTY_MEMBER_SEED}
      onSubmit={(values) => save.mutate(values)}
      isSubmitting={save.isPending}
      submitError={save.error}
      onClose={() => {
        save.reset();
        onClose();
      }}
    />
  );
}
