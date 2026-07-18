import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool, registerReferencesTool } from "./shared.js";
import {
  commonListParams,
  timestampFilters,
  rangeFilter,
  textFilter,
  commaListFilter,
  toFilterArray,
  toCommaJoined,
  amountInput,
  placeInput,
  idListOrDiff,
  entityId,
} from "../schemas.js";

const PAYMENT_TYPES = [
  "cash",
  "debit_card",
  "credit_card",
  "transfer",
  "voucher",
  "mobile_payment",
  "web_payment",
] as const;

const RECORD_STATES = ["cleared", "reconciled", "uncleared"] as const;

const createTransferSchema = z
  .object({
    pairingMode: z
      .enum(["new", "existing", "unpaired"])
      .describe(
        '"new" creates a mirror record on the target account (needs transfer.accountId). "existing" binds ' +
          "to an existing opposite-sign record on a different account (needs transfer.recordId). " +
          '"unpaired" records a transfer-type movement with no mirror.',
      ),
    accountId: entityId.optional().describe("Target account for the mirror record. Required when pairingMode is \"new\"."),
    recordId: entityId
      .optional()
      .describe(
        "Existing record to bind to. Required when pairingMode is \"existing\" — target must be on a " +
          "different account, have the opposite amount sign, and not already be paired.",
      ),
    counterAmount: amountInput
      .optional()
      .describe(
        "Amount on the counter account for a cross-currency \"new\" transfer (opposite sign to this record's " +
          "amount, currencyCode must match the counter account). Omit to auto-convert via FX.",
      ),
  })
  .describe("Account-movement settings; omit for a regular income/expense record. Independent of paymentType.");

const createRecordItem = z.object({
  accountId: entityId.describe("Account this record belongs to."),
  amount: amountInput,
  recordDate: z.string().describe("ISO 8601 date/datetime. Must not be more than ~24h in the future."),
  categoryId: entityId.optional().describe("Category ID (system or custom); auto-assigned by Wallet if omitted."),
  paymentType: z
    .enum(PAYMENT_TYPES)
    .optional()
    .describe("Payment method. Required for non-transfer records; auto-defaults to \"transfer\" when transfer is set."),
  recordState: z.enum(RECORD_STATES).optional().describe('Defaults to "cleared".'),
  labelIds: z.array(entityId).optional().describe("Label IDs to attach."),
  note: z.string().max(255).optional(),
  counterParty: z.string().max(255).optional().describe("Payee/merchant name."),
  place: placeInput.optional(),
  transfer: createTransferSchema.optional(),
});

const updateRecordItem = z.object({
  id: entityId.describe("ID of the record to update."),
  $clear: z
    .array(z.enum(["categoryId", "labelIds", "note", "counterParty", "place", "transfer"]))
    .optional()
    .describe(
      'Fields to clear/reset, e.g. ["note", "place"]. "transfer" cancels transfer state (category becomes ' +
        "Unknown). Don't also set an explicit value for a field listed here.",
    ),
  accountId: entityId
    .optional()
    .describe("Move to a different account; both accounts must be non-bank-synced and share currency."),
  amount: amountInput
    .optional()
    .describe(
      "Omit = no change. Patching amount always resets the record's currency to the account's currency, " +
        "even if the record originally held a different one.",
    ),
  categoryId: entityId.optional().describe("Locked on paired transfer records."),
  labelIds: idListOrDiff.optional(),
  note: z.string().max(255).optional(),
  counterParty: z.string().max(255).optional(),
  place: placeInput.optional().describe("Full replace, no merge — send {} to erase, or use $clear instead."),
  paymentType: z
    .enum(PAYMENT_TYPES)
    .optional()
    .describe(
      "On a paired transfer: categoryId stays locked, amount must keep the inverse sign of its mirror, and " +
        "accountId must differ from the mirror's (the cross-link updates automatically).",
    ),
  recordDate: z.string().optional().describe("Locked on bank-synced records."),
  recordState: z.enum(RECORD_STATES).optional().describe("Locked on bank-synced records."),
});

export function registerRecordTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_records",
    {
      title: "List records",
      description:
        "List transactions (records), newest first by default. If recordDate is omitted, Wallet applies a " +
        "default 3-month window automatically (returned as appliedRecordDateFilters) — pass any single bound " +
        "to override it. Response includes nextOffset when more results exist.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        accountId: entityId.optional().describe("Exact-match account filter; omit for records across all accounts."),
        recordDate: rangeFilter.describe(
          "Transaction date range filter, e.g. \"gte.2024-01-01\". Requires a range prefix. Omitting this applies a default 3-month window.",
        ),
        categoryId: commaListFilter.describe(
          "Category ID(s). Special value \"unknown\" expands to Unknown income/expense + Uncategorized. Max 10 values.",
        ),
        labelId: entityId.optional().describe("Return records that have this one label."),
        note: textFilter,
        counterParty: textFilter.describe("Filter by payee/payer name."),
        amount: rangeFilter.describe('Filter on amount.value, e.g. "gte.100.50". Requires a range prefix.'),
        recordType: z.enum(["expense", "income"]).optional(),
        paymentType: z.enum(PAYMENT_TYPES).optional(),
        recordState: commaListFilter.describe("reconciled, cleared, and/or uncleared."),
        source: commaListFilter.describe("android, ios, web, rest, mcp, backend, and/or missing."),
        sortBy: z
          .string()
          .optional()
          .describe('+/- prefixed field: recordDate, amount, createdAt, updatedAt. Default "-recordDate".'),
        convertTo: z
          .string()
          .optional()
          .describe('Convert amounts to this ISO 4217 code, "base" (profile currency), or "account". Adds a convertedAmount field per record.'),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/records", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            accountId: params.accountId,
            recordDate: toFilterArray(params.recordDate),
            categoryId: toCommaJoined(params.categoryId),
            labelId: params.labelId,
            note: toFilterArray(params.note),
            counterParty: toFilterArray(params.counterParty),
            amount: toFilterArray(params.amount),
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
            recordType: params.recordType,
            paymentType: params.paymentType,
            recordState: toCommaJoined(params.recordState),
            source: toCommaJoined(params.source),
            sortBy: params.sortBy,
            convertTo: params.convertTo,
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_record",
    {
      title: "Get record",
      description: "Fetch a single record by ID (there's no dedicated single-record path — this filters the list endpoint by id).",
      inputSchema: { id: entityId.describe("Record ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/records", { token: requestToken(extra), query: { id } })),
  );

  server.registerTool(
    "wallet_create_records",
    {
      title: "Create records",
      description:
        "Create up to 50 transactions in one call. Each item requires accountId, amount ({value, currencyCode?}) " +
        "and recordDate. Returns HTTP 200 on full success or 207 with per-item success/error details otherwise.",
      inputSchema: {
        records: z.array(createRecordItem).min(1).max(50).describe("Up to 50 records to create."),
        returnData: z
          .boolean()
          .optional()
          .describe("Set false to omit each created record's full body from the result (keeps id/success/error). Default true."),
      },
    },
    async ({ records, returnData }, extra) =>
      runTool(() =>
        walletRequest("POST", "/v1/api/records", {
          token: requestToken(extra),
          query: { returnData },
          body: records,
        }),
      ),
  );

  server.registerTool(
    "wallet_update_records",
    {
      title: "Update records",
      description:
        "Patch up to 10 existing records in one call — recategorize, relabel, annotate, move, or edit amount/date. " +
        "Bank-synced records reject changes to amount, recordDate and recordState. Returns HTTP 200 on full " +
        "success or 207 with per-item success/error details otherwise.",
      inputSchema: {
        records: z.array(updateRecordItem).min(1).max(10).describe("Up to 10 partial record updates, each with an id."),
        validation: z
          .enum(["strict"])
          .optional()
          .describe("\"strict\": validate all items first and write nothing if any fails. Default: lenient (skip invalid items, write the rest)."),
        returnData: z.boolean().optional().describe("Set false to omit each updated record's full body. Default true."),
      },
    },
    async ({ records, validation, returnData }, extra) =>
      runTool(() =>
        walletRequest("PATCH", "/v1/api/records", {
          token: requestToken(extra),
          query: { validation, returnData },
          body: records,
        }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_records",
    type: "records",
    title: "Delete records",
    description:
      "Delete up to 10 records by ID. Not allowed on bank-synced accounts; a transfer's paired records must be " +
      "deleted together in the same call. Check wallet_record_references first if unsure.",
  });

  registerReferencesTool(server, {
    name: "wallet_record_references",
    type: "records",
    title: "Check record references",
    description: "List standing orders that reference given records (via their items.recordIds).",
  });
}
