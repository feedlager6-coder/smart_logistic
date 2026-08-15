import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-xl font-semibold text-foreground">
              Что-то пошло не так
            </h1>
            <p className="text-sm text-muted-foreground">
              Произошла непредвиденная ошибка в интерфейсе. Данные в безопасности — это только визуальный сбой.
            </p>
            <p className="text-xs font-mono bg-muted rounded px-3 py-2 text-left break-all text-destructive">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 py-2 hover:bg-primary/90 transition-colors"
            >
              Перезагрузить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
