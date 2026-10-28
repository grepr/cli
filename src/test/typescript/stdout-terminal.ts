/**
 * Control whether stdout is a terminal. Default output formats depend on it, and
 * `bun test` stdout is a terminal in a developer shell but a pipe in CI.
 */
const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

export function setStdoutTerminal(isTerminal: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTerminal, configurable: true, writable: true });
}

export function restoreStdoutTerminal(): void {
  if (original) {
    Object.defineProperty(process.stdout, 'isTTY', original);
  } else {
    Reflect.deleteProperty(process.stdout, 'isTTY');
  }
}
