import { twMerge } from "tailwind-merge";

export type ClassValue =
  | string
  | false
  | null
  | undefined
  | ClassValue[]
  | Readonly<Record<string, boolean | null | undefined>>;

/** Joins class names: strings, arrays (flattened) and {class: condition} maps. */
export function clsx(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) {
      const nested = clsx(...value);
      if (nested) out.push(nested);
    } else {
      for (const [name, on] of Object.entries(value)) if (on) out.push(name);
    }
  }
  return out.join(" ");
}

/** clsx + tailwind-merge: later utilities win over earlier ones of the same group. */
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(...values));
}
