interface CachedValue<T> {
  readonly expiresAt: number;
  readonly value: T;
}

interface SingleFlightState<T> {
  cache: CachedValue<T> | undefined;
  inFlight: Promise<T> | undefined;
}

export interface TtlSingleFlightOptions<T> {
  readonly load: () => Promise<T>;
  readonly now: () => number;
  readonly ttlMilliseconds: number;
}

const cachedValue = <T>(cache: CachedValue<T> | undefined, now: number): T | undefined =>
  cache !== undefined && now < cache.expiresAt ? cache.value : undefined;

export const createTtlSingleFlight = <T>(
  options: TtlSingleFlightOptions<T>
): (() => Promise<T>) => {
  const state: SingleFlightState<T> = { cache: undefined, inFlight: undefined };
  return (): Promise<T> => {
    const cached = cachedValue(state.cache, options.now());
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    if (state.inFlight !== undefined) {
      return state.inFlight;
    }

    const current = options
      .load()
      .then((value: T): T => {
        state.cache = {
          expiresAt: options.now() + options.ttlMilliseconds,
          value,
        };
        return value;
      })
      .finally((): void => {
        state.inFlight = undefined;
      });
    state.inFlight = current;
    return current;
  };
};

export const settleWithin = <T>(
  operation: () => Promise<T>,
  timeoutMilliseconds: number,
  failure: T
): Promise<T> =>
  new Promise((settle: (result: T) => void): void => {
    const timeout = setTimeout((): void => settle(failure), timeoutMilliseconds);
    timeout.unref();
    void Promise.resolve()
      .then(operation)
      .then((result: T): void => {
        clearTimeout(timeout);
        settle(result);
      })
      .catch((): void => {
        clearTimeout(timeout);
        settle(failure);
      });
  });
