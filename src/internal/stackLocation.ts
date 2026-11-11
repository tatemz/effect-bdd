import * as Arr from "effect/Array";
import * as Str from "effect/String";

/** @internal */
export interface StackLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/** @internal */
export const filePathFromStackUrl = (url: string): string => {
  if (!Str.startsWith("file://")(url)) {
    return url;
  }
  const [host, ...segments] = Str.split(Str.slice(7)(url), "/");
  const decoded = decodeURIComponent(pathnameFromFileUrl(host, segments));
  return /^\/[A-Za-z]:\//.test(decoded) ? Str.slice(1)(decoded) : decoded;
};

const pathnameFromFileUrl = (
  host: string,
  segments: ReadonlyArray<string>,
): string =>
  host === "" || host === "localhost"
    ? `/${Arr.join(segments, "/")}`
    : `//${host}/${Arr.join(segments, "/")}`;

/** @internal */
export const parseStackLocation = (location: string): StackLocation | undefined => {
  const match = /^(.*):(\d+):(\d+)$/.exec(location);
  return match === null
    ? undefined
    : {
        path: filePathFromStackUrl(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
      };
};
