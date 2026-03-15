// ============================================================
// Retry utility with exponential backoff
// ============================================================

import { CONFIG } from "../config.js";

export async function retry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = CONFIG.maxRetries,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error(`[${label}] Aborted`);

    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (attempt === maxRetries) break;

      const delaySec = CONFIG.retryBaseDelaySec * Math.pow(3, attempt);
      console.warn(`[${label}] Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${delaySec}s...`);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delaySec * 1000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        }, { once: true });
      });
    }
  }

  throw lastError ?? new Error(`[${label}] All retries exhausted`);
}
