import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
    this.setState({ error });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <div className="error-screen__card">
            <p className="error-screen__eyebrow">Unexpected error</p>
            <h1 className="error-screen__title">Something went wrong.</h1>
            <p className="error-screen__message">
              The table ran into an issue. Try reloading the page to reconnect and restore the
              current session.
            </p>
            {this.state.error?.message && (
              <pre className="error-screen__details" aria-live="polite">
                {this.state.error.message}
              </pre>
            )}
            <div className="error-screen__actions">
              <button
                className="error-screen__button"
                type="button"
                onClick={() => window.location.reload()}
              >
                Reload table
              </button>
              <a className="error-screen__link" href="/">
                Go to home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
