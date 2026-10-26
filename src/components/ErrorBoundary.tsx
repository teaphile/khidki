import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { LogoMark } from './ui/LogoMark';

type State = { failed: boolean };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally silent in production so plaintext state is never logged.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-boundary">
        <div className="error-boundary__card">
          <LogoMark size={34} />
          <h1>Something interrupted Khidki</h1>
          <p>
            Active messages in memory were cleared safely. Reload the page to reconnect to your
            account.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            Reload Khidki
          </button>
        </div>
      </main>
    );
  }
}
