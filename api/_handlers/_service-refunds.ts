import { createHash, randomUUID } from 'node:crypto';
import { compareMoney } from '@afhomes/shared';
import { mimeMatchesSignature } from '../_lib/documents.js';
import { storageClient, createDownloadGrant } from '../_lib/storage.js';
import {
  serviceRefundDecisionSchema,
  serviceRefundReconciliationSchema,
  serviceRefundRepaymentSchema,
  serviceRefundRequestSchema,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { audit, deny, fail, jsonBody, list, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
export async function handleServiceRefunds(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  purchaseId: string,
  refundId: string | undefined,
  operation: string | undefined,
  verb: string,
  repaymentId?: string,
) {
  const principal = await authorizeAfHomes(
    req,
    'operations.payments',
    verb === 'GET' ? 'view' : 'update',
  );
  if ('error' in principal) return deny(res, principal);
  if (verb === 'GET' && operation === 'receipts' && refundId && repaymentId) {
    const payment = await db
      .from('service_refund_repayments')
      .select('receipt_path,refund_id')
      .eq('id', repaymentId)
      .eq('refund_id', refundId)
      .maybeSingle();
    const refund = await db
      .from('service_refunds')
      .select('id')
      .eq('id', refundId)
      .eq('purchase_id', purchaseId)
      .maybeSingle();
    if (payment.error || refund.error) return fail(res, 'INTERNAL', 'Receipt unavailable.', 500);
    if (!payment.data?.receipt_path || !refund.data)
      return fail(res, 'NOT_FOUND', 'Receipt not found.', 404);
    const storage = storageClient();
    if (!storage) return fail(res, 'INTERNAL', 'Receipt storage is not configured.', 500);
    return res
      .status(200)
      .json(
        await createDownloadGrant(storage, 'afhomes-payment-receipts', payment.data.receipt_path),
      );
  }
  if (verb === 'GET' && !refundId) {
    const result = await db.rpc('service_refund_history', {
      p_purchase_id: purchaseId,
      p_customer_id: null,
    });
    if (result.error) return fail(res, 'INTERNAL', 'Refund history is unavailable.', 500);
    return list(res, result.data ?? []);
  }
  if (operation === 'reconcile-receipt' && verb === 'POST' && refundId) {
    const input = serviceRefundReconciliationSchema.safeParse(jsonBody(req));
    if (!input.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Choose an upload attempt and provide a Finance review note.',
        400,
      );
    const result = await db.rpc('reconcile_service_refund_receipt', {
      p_purchase_id: purchaseId,
      p_refund_id: refundId,
      p_upload_audit_id: input.data.uploadAuditId,
      p_actor_id: principal.userId,
      p_reason: input.data.reason,
    });
    if (result.error)
      return fail(
        res,
        'CONFLICT',
        'Receipt reconciliation could not be confirmed. Reload history.',
        409,
      );
    if (result.data?.status === 'referenced') return res.status(200).json({ status: 'referenced' });
    const path = result.data?.receiptPath;
    if (
      result.data?.status !== 'abandoned' ||
      typeof path !== 'string' ||
      !path.startsWith('service-refunds/' + refundId + '/')
    )
      return fail(res, 'INTERNAL', 'Receipt reconciliation unavailable.', 500);
    try {
      const storage = storageClient();
      if (!storage) return res.status(200).json({ status: 'cleanup_pending' });
      const removed = await storage.from('afhomes-payment-receipts').remove([path]);
      if (removed.error) return res.status(200).json({ status: 'cleanup_pending' });
      await audit(
        db,
        principal.userId,
        'SERVICE_REFUND_RECEIPT_REMOVED',
        'service_refund',
        refundId,
        undefined,
        { receiptPath: path },
        { reason: input.data.reason },
      );
      return res.status(200).json({ status: 'removed' });
    } catch {
      return res.status(200).json({ status: 'cleanup_pending' });
    }
  }
  if (operation === 'receipts') return fail(res, 'NOT_FOUND', 'Not found', 404);
  if (verb !== 'POST') return fail(res, 'NOT_FOUND', 'Not found', 404);
  const parsed = (
    operation === 'decision'
      ? serviceRefundDecisionSchema
      : operation === 'repayments'
        ? serviceRefundRepaymentSchema
        : serviceRefundRequestSchema
  ).safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(res, 'VALIDATION_ERROR', 'Check the refund details and Finance review.', 400);
  const action =
    operation === 'decision'
      ? serviceRefundDecisionSchema.parse(parsed.data).decision
      : operation === 'repayments'
        ? 'repay'
        : 'request';
  const input = { ...parsed.data };
  let uploadedReceipt:
    { path: string; storage: NonNullable<ReturnType<typeof storageClient>> } | undefined;
  let matchesRecordedReceipt: (() => Promise<boolean>) | undefined;
  const removeAttemptReceipt = async () => {
    if (!uploadedReceipt) return;
    try {
      const removed = await uploadedReceipt.storage
        .from('afhomes-payment-receipts')
        .remove([uploadedReceipt.path]);
      if (!removed.error)
        await audit(
          db,
          principal.userId,
          'SERVICE_REFUND_RECEIPT_REMOVED',
          'service_refund',
          refundId!,
          undefined,
          { receiptPath: uploadedReceipt.path },
        );
    } catch {
      /* The prepared audit retains the private path for reconciliation. */
    }
  };
  if (action === 'repay') {
    const repayment = serviceRefundRepaymentSchema.parse(parsed.data);
    if (repayment.receipt) {
      const bytes = Buffer.from(repayment.receipt.dataBase64, 'base64');
      if (
        bytes.length > 3 * 1024 * 1024 ||
        !mimeMatchesSignature(repayment.receipt.mimeType, bytes)
      )
        return fail(
          res,
          'VALIDATION_ERROR',
          'Choose a valid JPEG, PNG or PDF receipt up to 3 MiB.',
          400,
        );
      const storage = storageClient();
      if (!storage) return fail(res, 'INTERNAL', 'Receipt storage is not configured.', 500);
      const extension =
        repayment.receipt.mimeType === 'application/pdf'
          ? 'pdf'
          : repayment.receipt.mimeType === 'image/png'
            ? 'png'
            : 'jpg';
      const digest = createHash('sha256').update(bytes).digest('hex');
      const refund = await db
        .from('service_refunds')
        .select('id,status')
        .eq('id', refundId)
        .eq('purchase_id', purchaseId)
        .maybeSingle();
      if (refund.error) return fail(res, 'INTERNAL', 'Refund unavailable.', 500);
      if (!refund.data) return fail(res, 'NOT_FOUND', 'Refund not found.', 404);
      const recordedReceipt = () =>
        db
          .from('service_refund_repayments')
          .select('refund_id,amount,repaid_at,recorded_by,receipt_path')
          .eq('method', repayment.method)
          .eq('reference', repayment.reference.trim())
          .maybeSingle();
      const isSame = (payment: {
        refund_id: string;
        amount: string;
        repaid_at: string;
        recorded_by: string;
        receipt_path: string | null;
      }) =>
        payment.refund_id === refundId &&
        payment.recorded_by === principal.userId &&
        compareMoney(payment.amount, repayment.amount) === 0 &&
        new Date(payment.repaid_at).getTime() === new Date(repayment.repaidAt).getTime() &&
        Boolean(payment.receipt_path?.endsWith('/' + digest + '.' + extension));
      matchesRecordedReceipt = async () => {
        const existing = await recordedReceipt();
        return !existing.error && Boolean(existing.data && isSame(existing.data));
      };
      const existing = await recordedReceipt();
      if (existing.error) return fail(res, 'INTERNAL', 'Repayment history unavailable.', 500);
      if (existing.data) {
        if (isSame(existing.data)) return res.status(200).json({ id: refundId });
        return fail(
          res,
          'CONFLICT',
          'The external reference belongs to a different repayment.',
          409,
        );
      }
      if (!['approved_pending_repayment', 'partially_repaid'].includes(refund.data.status))
        return fail(res, 'CONFLICT', 'Approve the refund before recording repayment.', 409);
      const receiptPath =
        'service-refunds/' +
        refundId +
        '/' +
        principal.userId +
        '/' +
        randomUUID() +
        '/' +
        digest +
        '.' +
        extension;
      await audit(
        db,
        principal.userId,
        'SERVICE_REFUND_RECEIPT_PREPARED',
        'service_refund',
        refundId!,
        undefined,
        {
          receiptPath,
          reference: repayment.reference,
          method: repayment.method,
          amount: repayment.amount,
          repaidAt: repayment.repaidAt,
        },
      );
      const upload = await storage
        .from('afhomes-payment-receipts')
        .upload(receiptPath, bytes, { contentType: repayment.receipt.mimeType, upsert: false });
      if (upload.error)
        return fail(res, 'INTERNAL', 'Receipt upload failed. No repayment was recorded.', 500);
      uploadedReceipt = { path: receiptPath, storage };
      Object.assign(input, { receiptPath });
      if ('receipt' in input) delete input.receipt;
    }
  }
  const { data, error } = await db.rpc('manage_service_refund', {
    p_purchase_id: purchaseId,
    p_refund_id: refundId ?? null,
    p_operation: action,
    p_input: input,
    p_actor_id: principal.userId,
  });
  if (error) {
    // Only a definite database refusal permits deleting this unique attempt's object.
    const definite =
      /^(22|23|42|55)/.test(error.code ?? '') ||
      ['P0002', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '');
    if (definite) {
      const alreadyRecorded = matchesRecordedReceipt && (await matchesRecordedReceipt());
      await removeAttemptReceipt();
      if (alreadyRecorded) return res.status(200).json({ id: refundId });
    }
    // Ambiguous transport failures retain the object for explicit Finance reconciliation.
    if (error.message?.includes('REFUND_'))
      return fail(
        res,
        'CONFLICT',
        'The refund cannot be recorded. Check eligibility, previous refunds, repayment references and service review.',
        409,
      );
    return fail(
      res,
      'INTERNAL',
      'The refund could not be confirmed. Check history before retrying.',
      500,
    );
  }
  return res.status(action === 'request' ? 201 : 200).json({ id: data });
}
