# wallet-mcp

A local [MCP](https://modelcontextprotocol.io) server for the [BudgetBakers Wallet](https://budgetbakers.com/) REST API. Runs as a stdio subprocess — no network listener of its own.

Covers Records (transactions), Accounts, Categories, and Budgets. Labels have no dedicated read/write endpoints in the Wallet API, so they're only usable as `labelIds` on records/budgets.

## Setup

```bash
npm install
npm run build
```

Requires a Wallet **Premium** subscription. Generate an API token at
https://web.budgetbakers.com/settings/rest-api, then set it as an environment variable —
never commit it or pass it on the command line.

## Register with Claude Code

```bash
claude mcp add wallet -- env WALLET_API_TOKEN=<your_token> node /absolute/path/to/wallet-mcp/dist/index.js
```

Or add directly to your MCP client config:

```json
{
  "mcpServers": {
    "wallet": {
      "command": "node",
      "args": ["/absolute/path/to/wallet-mcp/dist/index.js"],
      "env": {
        "WALLET_API_TOKEN": "<your_token>"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `wallet_list_records` | List transactions, with pagination and amount/date/note/payee filters |
| `wallet_create_records` | Create up to 20 transactions |
| `wallet_update_records` | Patch up to 10 transactions |
| `wallet_delete_records` | Delete up to 10 transactions |
| `wallet_list_accounts` | List accounts |
| `wallet_get_account` | Get one account |
| `wallet_create_account` | Create an account |
| `wallet_update_accounts` | Patch up to 10 accounts |
| `wallet_account_references` | Check what references an account |
| `wallet_list_categories` | List categories (system + custom) |
| `wallet_get_category` | Get one category |
| `wallet_create_category` | Create a custom category |
| `wallet_update_categories` | Patch up to 10 categories |
| `wallet_delete_categories` | Delete up to 10 custom categories |
| `wallet_category_references` | Check what references a category |
| `wallet_list_budgets` | List budgets |
| `wallet_get_budget` | Get one budget |
| `wallet_create_budget` | Create a budget |
| `wallet_update_budgets` | Patch up to 10 budgets |
| `wallet_delete_budgets` | Delete up to 10 budgets |

## Notes

- Batch write endpoints (`POST`/`PATCH`/`DELETE` with multiple items) can return HTTP 207
  with a mix of per-item successes and failures; that's returned as normal tool output,
  not an error.
- Wallet rate-limits at 300 requests/hour. Tool responses append a warning once the
  `X-RateLimit-Remaining` header drops to 5 or below.
- Filter parameters on `wallet_list_records` accept the API's `gte.`/`lte.`/`contains.`/
  `contains-i.` prefix syntax (e.g. `"gte.100"`), or a plain value for exact match.

## Development

```bash
npm run dev    # tsc --watch
npm start      # run the built server
```
