'use client';

type LogLevel = 'log' | 'info' | 'warn' | 'error';

type TakuClientLogMessage = {
  __taku: true;
  type: 'taku:client-log';
  level: LogLevel;
  message: string;
  timestamp: number;
};

const LOG_BRIDGE_FLAG = '__takuClientLogBridgeInstalled__';

export function installClientLogBridge(): void {
  if (typeof window === 'undefined') return;
  const anyWindow = window as unknown as Record<string, unknown>;
  if (anyWindow[LOG_BRIDGE_FLAG]) return;
  anyWindow[LOG_BRIDGE_FLAG] = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const postLog = (level: LogLevel, args: unknown[]) => {
    const payload: TakuClientLogMessage = {
      __taku: true,
      type: 'taku:client-log',
      level,
      message: formatArgs(args),
      timestamp: Date.now(),
    };
    try {
      window.parent?.postMessage(payload, '*');
    } catch {
      // ignore
    }
  };

  console.log = (...args: unknown[]) => {
    postLog('log', args);
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    postLog('info', args);
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    postLog('warn', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    postLog('error', args);
    original.error(...args);
  };

  window.addEventListener('error', (event) => {
    const args = [
      event.message,
      event.filename,
      event.lineno,
      event.colno,
      event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.error,
    ];
    postLog('error', args);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason =
      event.reason instanceof Error ? (event.reason.stack ?? event.reason.message) : event.reason;
    postLog('error', ['unhandledrejection', reason]);
  });
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}
