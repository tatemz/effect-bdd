import { setWorldConstructor } from "@cucumber/cucumber";
import type * as Counter from "../counter-domain.ts";

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

export const emptyCart: Cart = {
  items: [],
  taxEnabled: false,
};

export class BenchmarkWorld {
  readonly events: Array<string> = [];
  cart: Cart = { items: [], taxEnabled: false };
  counterState: Counter.Counter | undefined = undefined;
}

setWorldConstructor(BenchmarkWorld);
