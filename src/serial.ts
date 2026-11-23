/**
 * Runs the functions given to it one at a time, in the order given, so a change that reads and then writes can't
 * interleave with another and lose it. A failure is passed to its caller and doesn't stop the ones after it.
 */
export function serial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = last.then(fn, fn);
    last = next.catch(() => {});
    return next;
  };
}
