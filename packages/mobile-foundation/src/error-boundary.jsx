import { Component } from 'react';
import { ErrorState, Screen } from '@jamzo/mobile-ui';

/** Last-resort boundary: a rendering bug shows a recoverable screen instead of a crash. */
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.props.logger?.error('render error', {
      message: error?.message,
      stack: info?.componentStack?.slice(0, 500),
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Screen scroll={false}>
        <ErrorState
          title="This screen hit a problem"
          message="Please try again. If it keeps happening, contact support."
          onRetry={() => this.setState({ error: null })}
        />
      </Screen>
    );
  }
}
