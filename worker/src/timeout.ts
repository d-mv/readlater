/** Thrown when an operation runs past its deadline. Its `name` matches the
 * TimeoutError of AbortSignal.timeout() and Playwright, so one check covers all. */
export class TimeoutError extends Error {
  override name = "TimeoutError";
}

/** Rejects with a TimeoutError if `promise` hasn't settled within `timeoutMs`.
 * The underlying work is not cancelled — callers that own resources must bound
 * or clean them up themselves. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
