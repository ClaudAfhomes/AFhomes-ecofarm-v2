import { useCallback } from 'react';

import { ApiError } from '../lib/api/errors';
import { Alert } from './Alert';
import { Button } from './Button';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
}

function describeError(error: unknown): { message: string; requestId?: string } {
  if (error instanceof ApiError) {
    return { message: error.message, requestId: error.requestId };
  }
  return { message: 'An unexpected error occurred. Please try again.' };
}

/**
 * Generic recoverable error state (UI-UX §10 "Error"). Maps the API error
 * envelope to a readable message; surfaces the correlation `requestId`; offers
 * retry. Never renders raw stack traces or server internals
 * (DEVELOPMENT-GUIDELINES §10; API-SPECIFICATION §8).
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const { message, requestId } = describeError(error);
  const handleRetry = useCallback(() => onRetry?.(), [onRetry]);

  return (
    <Alert variant="danger" title="Something went wrong">
      <p>{message}</p>
      {requestId ? <p className="prose">Reference: {requestId}</p> : null}
      {onRetry ? (
        <p>
          <Button variant="secondary" onClick={handleRetry}>
            Retry
          </Button>
        </p>
      ) : null}
    </Alert>
  );
}
