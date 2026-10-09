export type Counter = {
  readonly value: number;
};

/** Creates a counter at zero. */
export const create = (): Counter => ({ value: 0 });

/** Adds one to a counter. */
export const increment = (counter: Counter): Counter => ({
  ...counter,
  value: counter.value + 1,
});

/** Subtracts one from a counter. */
export const decrement = (counter: Counter): Counter => ({
  ...counter,
  value: counter.value - 1,
});
