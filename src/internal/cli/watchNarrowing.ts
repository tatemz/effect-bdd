import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * The environment variable through which a watch parent narrows a child run to
 * the changed feature files. Passing the narrowing in the environment instead
 * of editing argv means child argv stays exactly the user's original flags, so
 * aliases, repeated flags, and interpreter options cannot be mangled.
 *
 * @internal
 */
export const narrowEnvName = "EFFECT_BDD_WATCH_FEATURES";

const featurePathsJson = Schema.fromJsonString(Schema.Array(Schema.String));

/**
 * The environment value for a set of narrowed feature paths, encoded as JSON
 * so paths containing colons or other delimiters round-trip unchanged.
 *
 * @internal
 */
export const narrowEnvValue = Schema.encodeEffect(featurePathsJson);

/**
 * Read a narrowed feature list from an environment record. Returns `None`
 * when the variable is absent, malformed, or not a JSON array of strings; a
 * present JSON empty array is a deliberate empty run.
 *
 * @internal
 */
export const narrowFromEnv = (
  env: Record<string, string | undefined>,
): Option.Option<ReadonlyArray<string>> => {
  const value = env[narrowEnvName];
  if (value === undefined) {
    return Option.none();
  }
  return Schema.decodeOption(featurePathsJson)(value);
};

/**
 * Apply the narrowing only to a marked watch child. The parent may inherit
 * variables from its shell, so an unmarked CLI invocation must use its parsed
 * feature patterns unchanged.
 *
 * @internal
 */
export const applyFeatureNarrowing = <A extends { readonly features: ReadonlyArray<string> }>(
  options: A,
  env: Record<string, string | undefined>,
): A =>
  isWatchChildEnv(env)
    ? Option.match(narrowFromEnv(env), {
        onNone: () => options,
        onSome: (features) => ({ ...options, features }),
      })
    : options;

/**
 * Whether an environment record marks this process as a watch child, which
 * must not start its own watcher. This is the belt to the parent's braces of
 * removing `--watch` from child argv: it also covers `--watch=true` spellings
 * an exact-token argv filter would miss.
 *
 * @internal
 */
export const isWatchChildEnv = (env: Record<string, string | undefined>): boolean =>
  Predicate.isNotUndefined(env[watchChildEnvName]);

/**
 * The environment variable that marks a process as a watch child.
 *
 * @internal
 */
export const watchChildEnvName = "EFFECT_BDD_WATCH_CHILD";

/**
 * The child marker value: a truthy string for cheap `if (env.X)` checks.
 *
 * @internal
 */
export const watchChildEnvValue = "1";
