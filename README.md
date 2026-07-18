# wallet-mcp

An [MCP](https://modelcontextprotocol.io) server for the [BudgetBakers Wallet](https://budgetbakers.com/) REST API. Runs as a persistent HTTP service using MCP's [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http) transport — meant to be run as a long-lived background process (e.g. via systemd) that MCP clients connect to over the network, rather than a stdio subprocess a client spawns itself.

Covers Records (transactions), Accounts, Categories, and Budgets. Labels have no dedicated read/write endpoints in the Wallet API, so they're only usable as `labelIds` on records/budgets.

## Prerequisites

- Node.js 18 or newer (`node --version`)
- A [BudgetBakers Wallet](https://budgetbakers.com/) account on the **Premium** plan — the REST API isn't available on the free plan
- An MCP client that supports Streamable HTTP transport (Claude Code, or any custom MCP client)

## Setup

```bash
git clone https://github.com/kirikatiya/wallet-mcp.git
cd wallet-mcp
npm install
npm run build
```

Generate an API token at https://web.budgetbakers.com/settings/rest-api — keep it secret,
don't commit it anywhere. Unlike a typical stdio MCP server, **the token is not configured
on the server at all**: each MCP client sends its own token per request via the standard
`Authorization: Bearer <token>` HTTP header, and the server forwards it straight through to
the Wallet API. This lets multiple callers/agents share one running instance, each using
their own Wallet account. (If you do want a single fixed token for every caller instead,
set `WALLET_API_TOKEN` in the server's environment — it's used as a fallback whenever a
request has no `Authorization` header.)

## Running it

```bash
npm start
```

By default it listens on `http://127.0.0.1:7691/mcp` — loopback only, not reachable from
the network, since it's designed to be called by other processes/agents on the same
machine. Override with the `WALLET_MCP_HOST` / `WALLET_MCP_PORT` env vars if needed.

### As a background service (systemd)

A ready-to-adapt unit is in [`systemd/wallet-mcp.service.example`](systemd/wallet-mcp.service.example).
To install as a per-user service (no root required):

```bash
cp systemd/wallet-mcp.service.example ~/.config/systemd/user/wallet-mcp.service
# edit the paths inside to match where you cloned the repo
systemctl --user daemon-reload
systemctl --user enable --now wallet-mcp.service
loginctl enable-linger "$USER"   # keeps it running after you log out
```

Check it's up: `systemctl --user status wallet-mcp.service` and `curl -s -X POST
http://127.0.0.1:7691/mcp -H 'Content-Type: application/json' -H 'Accept:
application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.

⚠️ If you ever change the bind host to something other than `127.0.0.1` (e.g. to allow
access from other machines), put it behind a firewall/VPN — the server has no
authentication of its own beyond forwarding whatever `Authorization` header it receives.

## Register with an MCP client

### Claude Code

```bash
claude mcp add --transport http wallet http://127.0.0.1:7691/mcp \
  --header "Authorization: Bearer <your_token>"
```

Verify it's connected with `claude mcp list`, then ask Claude something like *"list my
Wallet accounts"* to confirm it can reach the API.

### Other MCP clients

Point the client at `http://127.0.0.1:7691/mcp` using Streamable HTTP transport, and
configure it to send `Authorization: Bearer <your_token>` with each request — consult
your client's docs for where custom headers are set on an HTTP MCP server entry.

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
- Wallet rate-limits at 300 requests/hour **per token**. Tool responses append a warning
  once the `X-RateLimit-Remaining` header drops to 5 or below.
- Filter parameters on `wallet_list_records` accept the API's `gte.`/`lte.`/`contains.`/
  `contains-i.` prefix syntax (e.g. `"gte.100"`), or a plain value for exact match.
- Each MCP request is stateless: the server doesn't persist sessions between calls, so
  there's nothing to clean up if a client disconnects mid-conversation.

## Troubleshooting

- **"No Wallet API token available"** — neither the request's `Authorization` header nor
  the server's `WALLET_API_TOKEN` env var provided a token. Check your client is sending
  the header on every request, not just at connection time.
- **HTTP 401/404 from the API with a token set** — token is invalid, expired, or was
  revoked; generate a new one at https://web.budgetbakers.com/settings/rest-api.
- **HTTP 403 / a "Premium required" style message** — the REST API needs an active
  Wallet Premium subscription.
- **HTTP 429** — you've hit the 300 requests/hour limit; wait for it to reset or reduce
  call frequency.
- **Client can't connect** — confirm the service is actually running (`systemctl --user
  status wallet-mcp.service` or `curl` the `/mcp` endpoint) and that the client is
  configured for Streamable HTTP, not stdio.

## Development

```bash
npm run dev    # tsc --watch
npm start      # run the built server
```

## License

[MIT](LICENSE)
