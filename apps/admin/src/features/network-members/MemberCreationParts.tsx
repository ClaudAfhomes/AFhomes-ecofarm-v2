import { useRef, useState, type ReactNode } from 'react';
import { memberIdentityDocumentSchema, type MemberIdentityDocument } from '@afhomes/contracts';
import { Button } from '@afhomes/ui';
import { useQuery } from '@tanstack/react-query';
import { getMemberIdentityDocument } from './services';
import styles from './MembersPage.module.css';

export function CreationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.formSection}>
      <legend className={styles.sectionTitle}>{title}</legend>
      {children}
    </fieldset>
  );
}
export function MemberIdUpload({
  value,
  onChange,
  disabled = false,
}: {
  value: MemberIdentityDocument | undefined;
  onChange: (value: MemberIdentityDocument | undefined) => void;
  disabled?: boolean;
}) {
  const selection = useRef(0);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  return (
    <div className={styles.idUpload}>
      <label htmlFor="member-identity-file">Government ID upload *</label>
      <input
        id="member-identity-file"
        type="file"
        required
        accept="image/jpeg,image/png,application/pdf"
        disabled={disabled}
        aria-describedby="member-identity-file-hint"
        onChange={async (event) => {
          const selected = ++selection.current;
          const input = event.currentTarget;
          const file = input.files?.[0];
          onChange(undefined);
          setFilename('');
          setError('');
          if (!file) return;
          if (
            !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) ||
            file.size > 2 * 1024 * 1024 ||
            file.size < 8
          ) {
            setError('Choose a JPEG, PNG or PDF ID document up to 2 MB.');
            input.value = '';
            return;
          }
          try {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
              reader.onerror = () => reject(new Error('The ID file could not be read.'));
              reader.readAsDataURL(file);
            });
            if (selected !== selection.current) return;
            const parsed = memberIdentityDocumentSchema.safeParse({
              mimeType: file.type,
              dataBase64: data,
            });
            if (!parsed.success) throw new Error('Choose a valid ID document.');
            onChange(parsed.data);
            setFilename(file.name);
          } catch {
            if (selected === selection.current) {
              input.value = '';
              setError('The ID file could not be read. Choose it again.');
            }
          }
        }}
      />
      <p id="member-identity-file-hint">
        JPEG, PNG or PDF, up to 2 MB. Saved privately when you create the account. Uploading does
        not verify the ID.
      </p>
      {value ? <p role="status">Ready to upload: {filename}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
export function MemberIdDocumentButton({ memberId }: { memberId: string }) {
  const link = useQuery({
    queryKey: ['network', 'member-identity-document', memberId],
    queryFn: () => getMemberIdentityDocument(memberId),
    enabled: false,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <div>
      <Button variant="secondary" loading={link.isFetching} onClick={() => void link.refetch()}>
        Open government ID
      </Button>
      {link.data?.url ? (
        <a href={link.data.url} target="_blank" rel="noreferrer">
          View private ID (link expires in 1 minute)
        </a>
      ) : null}
      {link.isSuccess && !link.data.url ? (
        <p>No uploaded ID is recorded for this account.</p>
      ) : null}
      {link.isError ? <p role="alert">The ID could not be opened. Retry.</p> : null}
    </div>
  );
}
