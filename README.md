# wallet-mcp

A local [MCP](https://modelcontextprotocol.io) server for the [BudgetBakers Wallet](https://budgetbakers.com/) REST API. Runs as a stdio subprocess — no network listener of its own.

Covers Records (transactions), Accounts, Categories, and Budgets. Labels have no dedicated read/write endpoints in the Wallet API, so they're only usable as `labelIds` on records/budgets.

## Prerequisites

- Node.js 18 or newer (`node --version`)
- A [BudgetBakers Wallet](https://budgetbakers.com/) account on the **Premium** plan — the REST API isn't available on the free plan
- An MCP-compatible client: [Claude Code](https://docs.claude.com/en/docs/claude-code), Claude Desktop, or any other MCP client

## Setup

```bash
git clone https://github.com/kirikatiya/wallet-mcp.git
cd wallet-mcp
npm install
npm run build
```

Generate an API token at https://web.budgetbakers.com/settings/rest-api. Keep it secret —
don't commit it, paste it into a shared config file, or pass it as a bare CLI argument.
It's provided to the server via the `WALLET_API_TOKEN` environment variable, as shown below.

## Register with an MCP client

### Claude Code

```bash
claude mcp add wallet -- env WALLET_API_TOKEN=<your_token> node /absolute/path/to/wallet-mcp/dist/index.js
```

Verify it's connected with `claude mcp list`, then ask Claude something like *"list my
Wallet accounts"* to confirm it can reach the API.

### Claude Desktop / other JSON-config clients

Add a `wallet` entry to the client's MCP server config (for Claude Desktop:
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

Restart the client after editing the config so it picks up the new server.

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

## Troubleshooting

- **"WALLET_API_TOKEN environment variable is not set"** — the `env` block (or `env
  WALLET_API_TOKEN=... node ...` prefix) isn't reaching the server process. Double-check
  it's set on the MCP server entry itself, not just your shell.
- **HTTP 401 from the API** — token is invalid, expired, or was revoked; generate a new
  one at https://web.budgetbakers.com/settings/rest-api.
- **HTTP 403 / a "Premium required" style message** — the REST API needs an active
  Wallet Premium subscription.
- **HTTP 429** — you've hit the 300 requests/hour limit; wait for it to reset or reduce
  call frequency.
- **Server doesn't show up in the client** — confirm `npm run build` succeeded (there
  should be a `dist/index.js`) and that the path in your config is absolute, not relative.

## Development

```bash
npm run dev    # tsc --watch
npm start      # run the built server
```

## License

[MIT](LICENSE)
