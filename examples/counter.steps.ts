import { Bdd } from "effect-bdd"
import { Effect, Result, Schema } from "effect"
import * as Counter from "./counter.ts"

type CounterScenarioState = {
  readonly counter: Counter.Counter | undefined
  readonly rejection: Counter.CounterRejection | undefined
}

type CountCaptures = {
  readonly count: number
}

type ExpectedValueCaptures = {
  readonly expectedValue: number
}

const count = Bdd.capture("count", Schema.FiniteFromString)
const expectedValue = Bdd.capture("expectedValue", Schema.FiniteFromString)

const initialScenarioState: CounterScenarioState = {
  counter: undefined,
  rejection: undefined
}

const recordCounterResult = (
  state: CounterScenarioState,
  result: Result.Result<Counter.Counter, Counter.CounterRejection>
): CounterScenarioState =>
  Result.match(result, {
    onSuccess: (counter) => ({ counter, rejection: undefined }),
    onFailure: (rejection) => ({ ...state, rejection })
  })

const createCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.create(state.counter))

const incrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.increment(state.counter))

const decrementCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.decrement(state.counter))

const disableCounter = (state: CounterScenarioState): CounterScenarioState =>
  recordCounterResult(state, Counter.disable(state.counter))

const incrementCounterTimes = (state: CounterScenarioState, times: number): CounterScenarioState =>
  Array.from({ length: times }).reduce<CounterScenarioState>((current) => incrementCounter(current), state)

const reject = (message: string): Effect.Effect<never, string> => Effect.fail(message)

const expectCounter = (state: CounterScenarioState): Effect.Effect<Counter.Counter, string> =>
  state.counter === undefined ? reject("Expected a counter to exist.") : Effect.succeed(state.counter)

const expectRejection = (
  state: CounterScenarioState,
  expected: Counter.CounterRejection
): Effect.Effect<CounterScenarioState, string> =>
  state.rejection === expected
    ? Effect.succeed(state)
    : reject(`Expected rejection ${expected}, got ${state.rejection ?? "none"}.`)

const givenNoCounterExists = Bdd.given`no counter exists`(() => Effect.succeed(initialScenarioState))

const givenCounterWasCreated = Bdd.given`a counter was created`(() =>
  Effect.succeed(createCounter(initialScenarioState))
)

const givenCounterAtValue = Bdd.given`a counter at value ${count}`(({ count }: CountCaptures) =>
  Effect.succeed(incrementCounterTimes(createCounter(initialScenarioState), count))
)

const whenCounterIsCreated = Bdd.when`the counter is created`((state: CounterScenarioState) =>
  Effect.succeed(createCounter(state))
)

const whenCounterIsCreatedAgain = Bdd.when`the counter is created again`((state: CounterScenarioState) =>
  Effect.succeed(createCounter(state))
)

const whenCounterIsIncremented = Bdd.when`the counter is incremented`((state: CounterScenarioState) =>
  Effect.succeed(incrementCounter(state))
)

const whenCounterIsIncrementedTimes = Bdd.when`the counter is incremented ${count} times`(
  ({ count }: CountCaptures, state: CounterScenarioState) => Effect.succeed(incrementCounterTimes(state, count))
)

const whenCounterIsDecremented = Bdd.when`the counter is decremented`((state: CounterScenarioState) =>
  Effect.succeed(decrementCounter(state))
)

const whenCounterIsDisabled = Bdd.when`the counter is disabled`((state: CounterScenarioState) =>
  Effect.succeed(disableCounter(state))
)

const thenCounterValueIs = Bdd.then`the counter value is ${expectedValue}`(
  ({ expectedValue }: ExpectedValueCaptures, state: CounterScenarioState) =>
    Effect.flatMap(expectCounter(state), (counter) =>
      counter.value === expectedValue
        ? Effect.succeed(state)
        : reject(`Expected counter value ${expectedValue}, got ${counter.value}.`)
    )
)

const thenCounterIsActive = Bdd.then`the counter is active`((state: CounterScenarioState) =>
  Effect.flatMap(expectCounter(state), (counter) =>
    counter.active ? Effect.succeed(state) : reject("Expected the counter to be active.")
  )
)

const thenChangeIsRejectedBecauseCounterAlreadyExists =
  Bdd.then`the change is rejected because the counter already exists`((state: CounterScenarioState) =>
    expectRejection(state, "AlreadyExists")
  )

const thenChangeIsRejectedBecauseCounterReachedMaximum =
  Bdd.then`the change is rejected because the counter reached its maximum`((state: CounterScenarioState) =>
    expectRejection(state, "MaximumReached")
  )

const thenChangeIsRejectedBecauseCounterReachedMinimum =
  Bdd.then`the change is rejected because the counter reached its minimum`((state: CounterScenarioState) =>
    expectRejection(state, "MinimumReached")
  )

const thenChangeIsRejectedBecauseCounterIsDisabled = Bdd.then`the change is rejected because the counter is disabled`(
  (state: CounterScenarioState) => expectRejection(state, "Disabled")
)

const thenChangeIsRejectedBecauseCounterDoesNotExist =
  Bdd.then`the change is rejected because the counter does not exist`((state: CounterScenarioState) =>
    expectRejection(state, "DoesNotExist")
  )

const creatingACounter = Bdd.scenario("Creating a counter").pipe(
  givenNoCounterExists,
  whenCounterIsCreated,
  thenCounterValueIs,
  thenCounterIsActive
)

const counterIsCreatedOnlyOnce = Bdd.scenario("A counter is created only once").pipe(
  givenCounterWasCreated,
  whenCounterIsCreatedAgain,
  thenChangeIsRejectedBecauseCounterAlreadyExists
)

const countingUp = Bdd.scenario("Counting up").pipe(
  givenCounterWasCreated,
  whenCounterIsIncrementedTimes,
  thenCounterValueIs
)

const countingDown = Bdd.scenario("Counting down").pipe(
  givenCounterAtValue,
  whenCounterIsDecremented,
  thenCounterValueIs
)

const counterNeverCountsAboveFive = Bdd.scenario("The counter never counts above 5").pipe(
  givenCounterAtValue,
  whenCounterIsIncremented,
  thenChangeIsRejectedBecauseCounterReachedMaximum
)

const counterNeverCountsBelowZero = Bdd.scenario("The counter never counts below 0").pipe(
  givenCounterWasCreated,
  whenCounterIsDecremented,
  thenChangeIsRejectedBecauseCounterReachedMinimum
)

const disablingCounterFreezesIt = Bdd.scenario("Disabling a counter freezes it").pipe(
  givenCounterAtValue,
  whenCounterIsDisabled,
  whenCounterIsIncremented,
  thenChangeIsRejectedBecauseCounterIsDisabled
)

const missingCounterCannotChange = Bdd.scenario("A missing counter cannot change").pipe(
  givenNoCounterExists,
  whenCounterIsIncremented,
  thenChangeIsRejectedBecauseCounterDoesNotExist
)

export const counter = Bdd.feature("Counter").pipe(
  creatingACounter,
  counterIsCreatedOnlyOnce,
  countingUp,
  countingDown,
  counterNeverCountsAboveFive,
  counterNeverCountsBelowZero,
  disablingCounterFreezesIt,
  missingCounterCannotChange
)
