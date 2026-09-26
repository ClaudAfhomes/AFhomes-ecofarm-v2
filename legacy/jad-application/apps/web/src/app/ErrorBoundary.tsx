import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '../components/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * App-level error boundary (FRONTEND-ARCHITECTURE §9). Catches render-time
 * (unexpected) exceptions only and shows a designed, recoverable error state -
 * never a raw stack trace. API/form errors are handled by the query layer and
 * UI states, not by this boundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Minimal client diagnostics without PII (DEVELOPMENT-GUIDELINES §10;
    // NFR-CONF-001). Server-side audit is authoritative (NFR-AUD-001).
    console.error('Unexpected render error', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="container">
        <div role="alert" style={{ padding: 'var(--space-8) 0' }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred while rendering this page.</p>
          <Button onClick={this.handleReset}>Try again</Button>
        </div>
      </main>
    );
  }
}
