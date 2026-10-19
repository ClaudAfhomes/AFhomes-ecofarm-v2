import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Dialog, Skeleton } from '@afhomes/ui';

import { getCurrentDocument, getDocumentAccessUrl } from '../documents/services';
import { documentKeys, sharedScopes } from './queryKeys';
import styles from './CustomerIdImage.module.css';

/**
 * The customer's current government ID image, on their own record.
 *
 * Two server calls, both already in place: the server decides which document
 * is CURRENT (newest file-backed, non-rejected) and issues a short-lived signed
 * URL for the private bucket. Nothing here reaches storage directly, and no
 * storage path, digest or bucket name is ever rendered.
 *
 * `canView` is the caller's permission answer. ID scans are a SEPARATE module
 * from the customer record, so a staff member who may read the record but not
 * `sales.id_documents` must not see the scan - and the request is never sent,
 * so the page cannot show a broken image or a 403.
 */
export function CustomerIdImage({ customerId, canView }: { customerId: string; canView: boolean }) {
  const [enlarged, setEnlarged] = useState(false);
  const current = useQuery({
    queryKey: sharedScopes.documentsCurrentCustomer(customerId),
    queryFn: () => getCurrentDocument({ subjectType: 'customer', subjectId: customerId }),
    enabled: canView && Boolean(customerId),
    retry: false,
  });
  // The same acceptance rule the application editor uses: a document counts
  // only when the server says it is current, the bytes are persisted, and it
  // has not been rejected.
  const doc =
    current.data && current.data.isCurrent && current.data.hasFile
      ? current.data.verificationStatus === 'rejected'
        ? null
        : current.data
      : null;
  const preview = useQuery({
    queryKey: documentKeys.accessUrl(doc?.id, doc?.uploadedAt),
    queryFn: () => getDocumentAccessUrl(doc!.id),
    enabled: Boolean(doc),
    staleTime: 45_000,
    retry: false,
  });

  if (!canView) return 'Not Recorded';
  if (current.isPending)
    return (
      <div className={styles.block} role="status" aria-label="Loading ID image">
        <Skeleton style={{ height: 96, width: 144 }} />
      </div>
    );
  if (current.isError || !doc) return 'Not Recorded';

  const isPdf = doc.mime === 'application/pdf';
  return (
    <div className={styles.block}>
      {preview.isPending ? (
        <Skeleton style={{ height: 120, width: 180 }} />
      ) : preview.isError ? (
        'Not Recorded'
      ) : isPdf ? (
        <a href={preview.data.url} target="_blank" rel="noreferrer">
          Open the PDF
        </a>
      ) : (
        <button
          type="button"
          className={styles.thumb}
          onClick={() => setEnlarged(true)}
          aria-label="Open the full ID image"
        >
          <img
            className={styles.image}
            src={preview.data.url}
            alt={`Scan of ${doc.originalFilename}`}
          />
        </button>
      )}
      <Dialog open={enlarged} onClose={() => setEnlarged(false)} title="Government ID">
        <img
          className={styles.full}
          src={preview.data?.url}
          alt={`Scan of ${doc.originalFilename}`}
        />
      </Dialog>
    </div>
  );
}
