import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Непредвиденная ошибка интерфейса' };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let displayDetail = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed.error && parsed.operationType) {
          displayDetail = `Firestore (${parsed.operationType} ${parsed.path || ''}): ${parsed.error}`;
        }
      } catch {
        // Plain error text
      }

      return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex items-center justify-center p-6">
          <div className="max-w-lg w-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-semibold">Сбой выполнения компонента</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 font-mono break-words bg-slate-100 dark:bg-slate-900/70 p-3 rounded-lg">
              {displayDetail}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Перезагрузить панель
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
