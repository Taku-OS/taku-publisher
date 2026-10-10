/** Page-local cancellation UI; the original run subscription owns the outcome. */
export type RunCancellationView = {
  phase: 'available' | 'requesting' | 'awaiting-terminal' | 'terminal';
  error?: string;
};

export function createRunCancellation(input: {
  runId: string;
  state: string;
  cancel: (runId: string) => Promise<unknown>;
  onChange: (view: RunCancellationView) => void;
}) {
  let view: RunCancellationView = { phase: 'available' };
  let disposed = false;
  const publish = (next: RunCancellationView) => {
    view = next;
    if (!disposed) input.onChange(next);
  };
  const observe = (state: string) => {
    if (disposed || view.phase === 'terminal') return;
    if (['succeeded', 'failed', 'cancelled'].includes(state)) {
      publish({ phase: 'terminal' });
    } else if (state === 'cancelling') {
      publish({ phase: 'awaiting-terminal' });
    }
  };
  observe(input.state);
  if (input.state === 'cancelling') {
    // A restored page has no pending RPC of its own. Let the user explicitly
    // ask the Host to confirm the same run again; do not start new work.
    publish({ phase: 'available', error: 'Cancellation has not yet been confirmed' });
  }
  const isRequestPending = () => !disposed && view.phase === 'requesting';
  const isStillActive = () => !disposed && view.phase !== 'terminal';

  return {
    get view() {
      return view;
    },
    observe,
    async request() {
      if (disposed || view.phase !== 'available') return;
      // Synchronous guard: two clicks before React renders still send one RPC.
      publish({ phase: 'requesting' });
      try {
        await input.cancel(input.runId);
        if (isRequestPending()) {
          publish({ phase: 'awaiting-terminal' });
        }
      } catch (error) {
        if (isStillActive()) {
          publish({
            phase: 'available',
            error: error instanceof Error ? error.message : 'Cancellation request failed',
          });
        }
      }
      // `cancelling` is only an intent, not final proof. An RPC failure may
      // therefore enable confirmation retry without changing the run state.
      // A cancel receipt is not a terminal result. Never clear the journal,
      // stop the subscription, read a result, or create another run here.
    },
    dispose() {
      disposed = true;
    },
  };
}
