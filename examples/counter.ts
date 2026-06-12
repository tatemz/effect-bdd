import { Result } from "effect"

export type Counter = {
  readonly value: number
  readonly active: boolean
}

export type CounterRejection = "AlreadyExists" | "DoesNotExist" | "MaximumReached" | "MinimumReached" | "Disabled"

export const MIN = 0
export const MAX = 5

export const create = (counter: Counter | undefined): Result.Result<Counter, CounterRejection> =>
  counter === undefined ? Result.succeed({ value: MIN, active: true }) : Result.fail("AlreadyExists")

export const increment = (counter: Counter | undefined): Result.Result<Counter, CounterRejection> => {
  if (counter === undefined) {
    return Result.fail("DoesNotExist")
  }

  if (!counter.active) {
    return Result.fail("Disabled")
  }

  if (counter.value >= MAX) {
    return Result.fail("MaximumReached")
  }

  return Result.succeed({ ...counter, value: counter.value + 1 })
}

export const decrement = (counter: Counter | undefined): Result.Result<Counter, CounterRejection> => {
  if (counter === undefined) {
    return Result.fail("DoesNotExist")
  }

  if (!counter.active) {
    return Result.fail("Disabled")
  }

  if (counter.value <= MIN) {
    return Result.fail("MinimumReached")
  }

  return Result.succeed({ ...counter, value: counter.value - 1 })
}

export const disable = (counter: Counter | undefined): Result.Result<Counter, CounterRejection> => {
  if (counter === undefined) {
    return Result.fail("DoesNotExist")
  }

  return Result.succeed({ ...counter, active: false })
}
