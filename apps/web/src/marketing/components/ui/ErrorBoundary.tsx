import { Button } from '@jad/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../../lib/telemetry';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-cream-100 p-6 text-center">
        <div>
          <h1 className="font-display text-4xl text-navy-900">We couldn’t open this page.</h1>
          <p className="mt-3 text-ink-600">Please refresh and try again.</p>
          <Button
            variant="secondary"
            type="button"
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            Refresh page
          </Button>
        </div>
      </main>
    );
  }
}
