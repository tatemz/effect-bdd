import { Context, Effect, Layer, Match, Schema } from "effect";

/**
 * The closed set of languages the Greeter speaks.
 *
 * `Language.English` is the one spelling of `"en"` the codebase uses.
 */
export const Language = {
  English: "en",
  Spanish: "es",
} as const;
export type Language = (typeof Language)[keyof typeof Language];

/** Decodes `"en"`/`"es"` into the enum; anything else fails the step. */
export const LanguageSchema: Schema.Enum<typeof Language> = Schema.Enum(Language);

/**
 * Greets a visitor in one language.
 *
 * A `Context.Service` with a single `greet` effect, so handlers depend on the
 * capability rather than on which language implementation is installed; pick
 * an implementation with `Greeter.layerFor`.
 */
export class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: Effect.Effect<string>;
  }
>()("greeter-api/Greeter") {
  private static readonly layerGreeting = (message: string) =>
    Layer.succeed(Greeter, {
      greet: Effect.succeed(message),
    });

  /** The English `Greeter`, greeting with "Hello!". */
  static readonly layerEnglish = Greeter.layerGreeting("Hello!");

  /** The Spanish `Greeter`, greeting with "¡Hola!". */
  static readonly layerSpanish = Greeter.layerGreeting("¡Hola!");

  /**
   * Total mapping from the `Language` enum to an implementation layer.
   *
   * Matched exhaustively over `Language`, so adding a language is a compile
   * error until a layer exists for it.
   */
  static layerFor(language: Language): Layer.Layer<Greeter> {
    return Match.value(language).pipe(
      Match.when(Language.English, () => Greeter.layerEnglish),
      Match.when(Language.Spanish, () => Greeter.layerSpanish),
      Match.exhaustive,
    );
  }
}
