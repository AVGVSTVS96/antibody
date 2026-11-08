export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what}`);
  }

  return value;
}

export const filled = (s: string | null | undefined): s is string => s !== null && s !== undefined && s !== "";
