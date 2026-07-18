import { z } from "zod";

/** Wallet entity IDs are opaque strings (not always UUID-shaped — e.g. some system IDs). */
export const entityId = z.string().min(1).describe("Wallet entity ID (opaque string).");

export const COLORS = [
  "Blue",
  "Charcoal",
  "CoffeeBrown",
  "DarkPurple",
  "Green",
  "LightBlue",
  "Lime",
  "Orange",
  "PineGreen",
  "Pink",
  "Purple",
  "Red",
  "Stone",
  "Turquoise",
  "Wine",
  "Yellow",
] as const;

export const colorSchema = z.enum(COLORS).describe("Universal Wallet color name.");

/** Records use {value, currencyCode?} for amounts; accounts/budgets use bare numbers. */
export const amountInput = z
  .object({
    value: z.number().describe("Non-zero amount. Negative = expense, positive = income."),
    currencyCode: z
      .string()
      .length(3)
      .optional()
      .describe("ISO 4217 code. Must match the record's account currency if provided; defaults to it otherwise."),
  })
  .describe("Amount as a {value, currencyCode?} object — not a bare number.");

export const placeInput = z
  .object({
    address: z.string().max(255).optional().describe("Street/full address."),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    name: z.string().max(255).optional().describe("Place name."),
  })
  .describe(
    "Location metadata for a record. On PATCH this fully replaces any existing place (no merge) — " +
      "send {} to erase, or use $clear.",
  );

/** Shared by records/budgets labelIds, and budgets accountIds/categoryIds patch fields. */
export const idListOrDiff = z
  .union([
    z.array(entityId),
    z.object({
      add: z.array(entityId).optional(),
      remove: z.array(entityId).optional(),
    }),
  ])
  .describe(
    "Either a full replacement array of IDs (null/omit = no change, [] = clear all), or {add, remove} to " +
      "adjust the existing set incrementally.",
  );

const filterHint =
  'Accepts a plain value (exact match) or a prefixed expression: "gte.X", "lte.X", "gt.X", "lt.X", "eq.X". ' +
  "Pass an array to AND multiple conditions (e.g. a range).";

const textFilterHint =
  'Accepts a plain value (exact match) or a prefixed expression: "eq.foo", "contains.foo" (case-sensitive), ' +
  '"contains-i.foo" (case-insensitive).';

export const rangeFilter = z.union([z.string(), z.array(z.string())]).optional().describe(filterHint);
export const textFilter = z.union([z.string(), z.array(z.string())]).optional().describe(textFilterHint);

export function toFilterArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

const commaListHint = "Comma-separated for multiple values (OR semantics) — pass an array or a single value.";

/** For params like categoryId/recordState/source: multiple values are OR'd via one comma-joined param. */
export const commaListFilter = z.union([z.string(), z.array(z.string())]).optional().describe(commaListHint);

export function toCommaJoined(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(",") : value;
}

/** Query params present on every list endpoint. */
export const commonListParams = {
  limit: z.number().int().min(1).max(200).optional().describe("Max items to return (1-200, default 30)."),
  offset: z.number().int().min(0).optional().describe("Items to skip, for pagination (default 0)."),
  id: z.string().optional().describe("Comma-separated entity IDs to fetch directly (max 30). Bypasses other filters/defaults."),
  agentHints: z
    .boolean()
    .optional()
    .describe("Include structured hints in the response to help guide follow-up calls."),
  withTotal: z
    .boolean()
    .optional()
    .describe("Include a total count of all matching items (costs an extra query)."),
};

/** createdAt/updatedAt range filters, present on every list endpoint. */
export const timestampFilters = {
  createdAt: rangeFilter,
  updatedAt: rangeFilter,
};
