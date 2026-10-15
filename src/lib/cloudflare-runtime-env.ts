import { AsyncLocalStorage } from "node:async_hooks";

type RuntimeBindings = Record<string, unknown>;

const runtimeBindings = new AsyncLocalStorage<RuntimeBindings>();

function isRecord(value: unknown): value is RuntimeBindings {
  return typeof value === "object" && value !== null;
}

/**
 * Exposes the Worker bindings passed to the custom fetch entry only for the
 * lifetime of that request. AsyncLocalStorage avoids leaking values between
 * concurrent requests handled by the same Worker isolate.
 */
export function runWithCloudflareBindings<T>(
  bindings: unknown,
  callback: () => T,
): T {
  return runtimeBindings.run(isRecord(bindings) ? bindings : {}, callback);
}

export function getCloudflareBinding(name: string): string | undefined {
  const value = runtimeBindings.getStore()?.[name];
  return typeof value === "string" ? value : undefined;
}
