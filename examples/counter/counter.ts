import { Result } from "effect";

export type Counter = {
  readonly value: number;
};

export type CounterRejection = "AlreadyExists" | "DoesNotExist";

export const create = (counter: Counter | undefined): Result.Result<Counter, CounterRejection> =>
  counter === undefined ? Result.succeed({ value: 0 }) : Result.fail("AlreadyExists");

export const increment = (
  counter: Counter | undefined,
): Result.Result<Counter, CounterRejection> =>
  counter === undefined
    ? Result.fail("DoesNotExist")
    : Result.succeed({ ...counter, value: counter.value + 1 });

export const decrement = (
  counter: Counter | undefined,
): Result.Result<Counter, CounterRejection> =>
  counter === undefined
    ? Result.fail("DoesNotExist")
    : Result.succeed({ ...counter, value: counter.value - 1 });
