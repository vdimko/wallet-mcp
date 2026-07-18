import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool } from "../format.js";
import { pagination, numericFilter, dateFilter, textFilter, toFilterArray, uuid } from "../schemas.js";

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

const transferSchema = z
  .object({
    pairingMode: z
      .enum(["new", "existing", "unpaired"])
      .describe(
        '"new" creates the paired transfer record, "existing" links to an existing counterpart record, "unpaired" leaves this side of the transfer without a pair.',
      ),
  })
  .passthrough()
  .describe("Pairing details for transfer-type records; omit for normal income/expense records.");

const createRecordItem = z.object({
  accountId: uuid.describe("Existing non-bank-synced account this record belongs to."),
  amount: z
    .number()
    .describe("Non-zero transaction amount in the account's currency. Negative = expense, positive = income."),
  recordDate: z
    .string()
    .describe("ISO 8601 date/datetime. Must be within ~24h in the future or ~10 years in the past."),
  paymentType: z.enum(PAYMENT_TYPES).describe("Payment method used for the transaction."),
  categoryId: uuid.optional().describe("Category to assign; auto-assigned by Wallet if omitted."),
  recordState: z.enum(RECORD_STATES).optional().describe('Record status. Defaults to "cleared".'),
  labelIds: z.array(uuid).optional().describe("Label UUIDs to attach to the record."),
  note: z.string().max(255).optional().describe("Free-text description, max 255 characters."),
  counterParty: z.string().max(255).optional().describe("Payer/payee name, max 255 characters."),
  transfer: transferSchema.optional(),
});

const updateRecordItem = z.object({
  id: uuid.describe("ID of the record to update."),
  accountId: uuid
    .optional()
    .describe("Move to a different non-bank-synced account; both accounts must share currency."),
  categoryId: uuid.optional().describe("New category; locked on Transfer records."),
  labelIds: z.array(uuid).optional().describe("Replaces all labels on the record; pass [] to clear."),
  note: z.string().max(255).optional(),
  counterParty: z.string().max(255).optional(),
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  recordState: z.enum(RECORD_STATES).optional().describe("Locked on bank-synced records."),
  recordDate: z.string().optional().describe("Locked on bank-synced records."),
  amount: z
    .number()
    .optional()
    .describe("Locked on bank-synced records. Wallet recalculates refAmount automatically."),
});

export function registerRecordTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_records",
    {
      title: "List records",
      description:
        "List transactions (records) from Wallet, newest first by default. Supports pagination and " +
        "range/text filters on amount, recordDate, note and payee. Response includes nextOffset when more " +
        "results are available.",
      inputSchema: {
        ...pagination,
        amount: numericFilter,
        recordDate: dateFilter,
        note: textFilter,
        payee: textFilter,
      },
    },
    async ({ limit, offset, amount, recordDate, note, payee }) =>
      runTool(() =>
        walletRequest("GET", "/records", {
          query: {
            limit,
            offset,
            amount: toFilterArray(amount),
            recordDate: toFilterArray(recordDate),
            note: toFilterArray(note),
            payee: toFilterArray(payee),
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_create_records",
    {
      title: "Create records",
      description:
        "Create up to 20 transactions (records) in one call. Each item requires accountId, amount, " +
        "recordDate and paymentType; category is auto-assigned if omitted. Returns HTTP 200 on full success " +
        "or 207 with per-item success/error details on partial failure.",
      inputSchema: {
        records: z.array(createRecordItem).min(1).max(20).describe("Up to 20 records to create."),
      },
    },
    async ({ records }) => runTool(() => walletRequest("POST", "/records", { body: records })),
  );

  server.registerTool(
    "wallet_update_records",
    {
      title: "Update records",
      description:
        "Patch up to 10 existing records in one call, e.g. to recategorize, relabel, or annotate them. " +
        "Bank-synced records reject changes to amount, recordDate and recordState. Returns HTTP 200 on full " +
        "success or 207 with per-item success/error details on partial failure.",
      inputSchema: {
        records: z.array(updateRecordItem).min(1).max(10).describe("Up to 10 partial record updates, each with an id."),
      },
    },
    async ({ records }) => runTool(() => walletRequest("PATCH", "/records", { body: records })),
  );

  server.registerTool(
    "wallet_delete_records",
    {
      title: "Delete records",
      description:
        "Delete up to 10 records by ID. Not allowed on bank-synced accounts; a transfer's paired records " +
        "must be deleted together in the same call; records referenced by an active standing order cannot " +
        "be deleted.",
      inputSchema: {
        ids: z.array(uuid).min(1).max(10).describe("Up to 10 record IDs to delete."),
      },
    },
    async ({ ids }) =>
      runTool(() => walletRequest("DELETE", "/v1/api/records", { query: { id: ids.join(",") } })),
  );
}
