import { z } from 'zod';
import { selectCurrentDocumentId } from '../documents.js';
import type { FakeSupabase } from './supabase-fake.js';

/** Explicit RPC response fixture; transaction/concurrency proof lives in PostgreSQL. */
export function installDocumentReviewRpc(db: FakeSupabase) {
  db.rpcs.push({
    fn: 'review_identity_document',
    result: (args: Record<string, unknown>) => {
      const doc = db.tables.identity_documents?.find((d) => d.id === args.p_document_id);
      if (!doc) return null;
      const reviewed = z.record(z.string(), z.unknown()).parse(doc.reviewed_data ?? {});
      const fields = {
        ...z.record(z.string(), z.unknown()).parse(reviewed.fields ?? {}),
        ...z.record(z.string(), z.unknown()).parse(args.p_fields),
      };
      const notes = typeof args.p_notes === 'string' ? args.p_notes.trim() || null : null;
      const duplicate =
        args.p_decision === 'confirmed'
          ? !!args.p_id_number &&
            (db.tables.customers ?? []).some((c) => c.government_id_number === args.p_id_number)
          : null;
      if (
        doc.verification_status !== args.p_decision ||
        JSON.stringify(reviewed.fields ?? {}) !== JSON.stringify(fields) ||
        (reviewed.notes ?? null) !== notes
      ) {
        const before = doc.verification_status;
        doc.verification_status = args.p_decision;
        doc.reviewed_by = args.p_actor_id;
        doc.reviewed_at = new Date().toISOString();
        doc.reviewed_data = {
          fields,
          notes,
          confirmedAt: doc.reviewed_at,
          confirmedBy: args.p_actor_id,
        };
        (db.tables.audit_events ??= []).push({
          actor_id: args.p_actor_id,
          action:
            args.p_decision === 'confirmed'
              ? 'IDENTITY_DOCUMENT_CONFIRMED'
              : 'IDENTITY_DOCUMENT_REJECTED',
          entity_type: 'identity_document',
          entity_id: doc.id,
          before_data: { verificationStatus: before },
          after_data: {
            documentId: doc.id,
            decision: args.p_decision,
            possibleDuplicate: duplicate,
          },
        });
      }
      const candidates = (db.tables.identity_documents ?? []).filter(
        (d) =>
          d.subject_type === doc.subject_type &&
          (doc.subject_type === 'customer'
            ? d.customer_id === doc.customer_id
            : d.ost_application_id === doc.ost_application_id),
      );
      return {
        document: doc,
        isCurrent: selectCurrentDocumentId(candidates) === doc.id,
        possibleDuplicate: duplicate,
      };
    },
  });
}
