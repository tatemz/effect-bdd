import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { CommandResult } from "./types.ts";

export const runCommand = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        wallDurationMillis: performance.now() - started,
      });
    });
  });

export const assertSuccessful = (result: CommandResult): void => {
  if (result.exitCode === 0) {
    return;
  }
  throw new Error(
    [
      `Command failed with exit code ${result.exitCode}: ${result.command} ${result.args.join(" ")}`,
      result.stdout.trim() === "" ? undefined : `stdout:\n${result.stdout}`,
      result.stderr.trim() === "" ? undefined : `stderr:\n${result.stderr}`,
    ]
      .filter((line) => line !== undefined)
      .join("\n\n"),
  );
};
