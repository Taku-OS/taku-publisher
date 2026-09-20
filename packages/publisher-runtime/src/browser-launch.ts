import { spawn } from 'node:child_process';

export interface BrowserLaunch {
  status: 'requested' | 'failed' | 'timed_out' | 'skipped';
  exit_code?: number;
}

// Launcher acceptance is not proof that a page became visible. Never expose
// stderr here: OS errors can repeat URLs containing one-time launch values.
export function launchBrowser(url: string, options: {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<BrowserLaunch> {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: [url] }
    : process.platform === 'win32'
      ? { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
      : { file: 'xdg-open', args: [url] };
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      stdio: 'ignore', windowsHide: true, env: options.env ?? process.env,
    });
    const timer = setTimeout(() => {
      // Some Linux launchers stay alive with the browser. Do not kill it.
      child.unref();
      resolve({ status: 'timed_out' });
    }, options.timeoutMs ?? 5_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ status: 'failed' });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ status: code === 0 ? 'requested' : 'failed', ...(code === null ? {} : { exit_code: code }) });
    });
  });
}
