import 'server-only';

export type ProxyErrorCode =
  | 'INVALID_REQUEST'
  | 'MISSING_PROXY_BASE_URL'
  | 'MISSING_PROXY_ACCESS_TOKEN'
  | 'MISSING_PROXY_APP_ID'
  | 'UNAUTHORIZED'
  | 'PAYMENT_REQUIRED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON';

export class ProxyError extends Error {
  readonly code: ProxyErrorCode;
  readonly status?: number;
  readonly url?: string;
  readonly method?: string;

  constructor(params: {
    code: ProxyErrorCode;
    message: string;
    status?: number;
    url?: string;
    method?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'ProxyError';
    this.code = params.code;
    this.status = params.status;
    this.url = params.url;
    this.method = params.method;

    if (params.cause !== undefined) {
      // Avoid TS target differences for Error.cause while still attaching for debugging.
      const self = this as unknown as { cause?: unknown };
      self.cause = params.cause;
    }
  }
}

export function isProxyError(error: unknown): error is ProxyError {
  return error instanceof ProxyError;
}

export function safeSnippet(text: string, maxChars: number): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…(truncated)`;
}
