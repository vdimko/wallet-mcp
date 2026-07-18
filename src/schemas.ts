import { z } from "zod";

export const uuid = z.string().uuid();

export const pagination = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max items to return (default 30, max 200)."),
  offset: z.number().int().min(0).optional().describe("Number of items to skip (default 0)."),
};

const filterPrefixHint =
  'Accepts a plain value (exact match) or a prefixed expression: "gte.100", "lte.500", "gt.0", "lt.1000", "eq.100". Pass multiple entries to AND several conditions (e.g. ["gte.100", "lte.500"] for a range).';

const textFilterHint =
  'Accepts a plain value (exact match) or a prefixed expression: "eq.foo", "contains.foo" (case-sensitive), "contains-i.foo" (case-insensitive).';

export const numericFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe(filterPrefixHint);

export const dateFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe(`ISO 8601 date/datetime. Date-only values use whole-day UTC semantics. ${filterPrefixHint}`);

export const textFilter = z.union([z.string(), z.array(z.string())]).optional().describe(textFilterHint);

export const colorHint = "One of the 16 Wallet-supported color names/hex values shown in the Web app's palette.";

export function toFilterArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}
