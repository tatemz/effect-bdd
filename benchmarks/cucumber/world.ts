import { setWorldConstructor } from "@cucumber/cucumber";

export type LineItem = {
  readonly sku: string;
  readonly qty: number;
  readonly price: number;
};

export type Cart = {
  readonly items: ReadonlyArray<LineItem>;
  readonly payload?: Payload;
  readonly taxEnabled: boolean;
};

export type Payload = {
  readonly sku: string;
  readonly qty: number;
};

export type Counter = {
  readonly value: number;
  readonly active: boolean;
};

export type CounterRejection =
  | "AlreadyExists"
  | "DoesNotExist"
  | "MaximumReached"
  | "MinimumReached"
  | "Disabled";

export type CounterScenarioState = {
  readonly counter: Counter | undefined;
  readonly rejection: CounterRejection | undefined;
};

export const emptyCart: Cart = {
  items: [],
  taxEnabled: false,
};

export const initialCounterState: CounterScenarioState = {
  counter: undefined,
  rejection: undefined,
};

export class BenchmarkWorld {
  readonly events: Array<string> = [];
  cart: Cart = emptyCart;
  counterState: CounterScenarioState = initialCounterState;
}

setWorldConstructor(BenchmarkWorld);
