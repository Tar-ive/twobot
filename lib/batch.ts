// Concurrent batch runner with a hard concurrency cap.
// Generic: takes an array of tasks, runs at most `concurrency` at once.

export type BatchProgress = {
  completed: number;
  total: number;
  errors: number;
};

export async function runBatch<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: {
    concurrency?: number;
    onProgress?: (p: BatchProgress) => void;
    maxRetries?: number;
  } = {}
): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
  const concurrency = opts.concurrency ?? 10;
  const maxRetries = opts.maxRetries ?? 3;
  const results: Array<{ ok: true; value: R } | { ok: false; error: Error } | undefined> = new Array(items.length).fill(undefined);
  let cursor = 0;
  let completed = 0;
  let errors = 0;

  function isRetryable(e: any): boolean {
    const msg = (e?.message ?? String(e)).toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("throttle") ||
      msg.includes("1002") ||
      msg.includes("429") ||
      msg.includes("unexpected shape") ||
      msg.includes("empty") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("503") ||
      msg.includes("502")
    );
  }

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      let lastErr: Error | null = null;
      let success = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const v = await fn(items[i], i);
          results[i] = { ok: true, value: v };
          success = true;
          break;
        } catch (e) {
          lastErr = e as Error;
          if (attempt === maxRetries || !isRetryable(e)) break;
          // Exponential backoff with jitter: 1.5s, 3s, 6s, 12s
          const backoff = 1500 * Math.pow(2, attempt) + Math.random() * 1000;
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      if (!success) {
        results[i] = { ok: false, error: lastErr! };
        errors++;
      }
      completed++;
      opts.onProgress?.({ completed, total: items.length, errors });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results as Array<{ ok: true; value: R } | { ok: false; error: Error }>;
}
