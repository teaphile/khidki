import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { LogoMark } from './ui/LogoMark';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Do not include message contents or account identifiers in logs.
    console.error('Sotto UI error', error.name, info.componentStack?.slice(0, 800));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fatal-shell">
        <div className="fatal-card">
          <LogoMark size={44} />
          <span className="auth-success__icon auth-success__icon--warning">
            <ShieldAlert size={24} aria-hidden="true" />
          </span>
          <h1>Something went wrong.</h1>
          <p>
            The interface stopped unexpectedly. Reloading is safe; no message history is stored.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={17} aria-hidden="true" /> Reload Sotto
          </button>
        </div>
      </div>
    );
  }
}
