import * as Context from "effect/Context";
import type { StepDefinition } from "../Errors.ts";

/** @internal */
export interface StepMetadataValue {
  readonly step: string;
  readonly line: number;
  readonly definition?: StepDefinition;
}

/** @internal */
export class StepMetadata extends Context.Service<StepMetadata, StepMetadataValue>()(
  "effect-bdd/internal/StepMetadata",
) {}
