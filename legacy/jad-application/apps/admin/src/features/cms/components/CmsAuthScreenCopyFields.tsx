import { CmsTextField, CmsTextareaField } from './CmsFields';
import type { AuthScreenCopy } from '@jad/contracts';

interface Props {
  prefix: string;
  value: AuthScreenCopy;
  onChange: (patch: Partial<AuthScreenCopy>) => void;
  errors: Record<string, string>;
}

export function CmsAuthScreenCopyFields({ prefix, value, onChange, errors }: Props) {
  const err = (k: keyof AuthScreenCopy) => errors[`${prefix}.${k}`];
  return (
    <>
      <CmsTextField
        label="Eyebrow"
        value={value.eyebrow}
        onChange={(v) => onChange({ eyebrow: v })}
        maxLength={60}
        error={err('eyebrow')}
      />
      <CmsTextField
        label="Title"
        value={value.title}
        onChange={(v) => onChange({ title: v })}
        maxLength={80}
        error={err('title')}
      />
      <CmsTextareaField
        label="Lead"
        value={value.lead ?? ''}
        onChange={(v) => onChange({ lead: v || undefined })}
        maxLength={400}
        rows={2}
        error={err('lead')}
      />
      <CmsTextField
        label="Brand title"
        value={value.brandTitle}
        onChange={(v) => onChange({ brandTitle: v })}
        maxLength={120}
        error={err('brandTitle')}
      />
      <CmsTextareaField
        label="Brand lead"
        value={value.brandLead}
        onChange={(v) => onChange({ brandLead: v })}
        maxLength={400}
        rows={2}
        error={err('brandLead')}
      />
    </>
  );
}
