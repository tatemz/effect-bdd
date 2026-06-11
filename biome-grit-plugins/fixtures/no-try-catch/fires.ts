export const risky = (run: () => number): number | undefined => {
  try {
    return run()
  } catch {
    return undefined
  }
}
