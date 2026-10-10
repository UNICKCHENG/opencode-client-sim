# opencode-client-sim

Wear a coding client's clothes, for relay sites that only serve Codex CLI or
Claude Code requests. The plugin sends the request a real client would — its
User-Agent, `Originator: codex_cli_rs` or `claude-cli`/`x-app`/`anthropic-beta`,
a stable session or user identity, Codex's `instructions` and Claude Code's
system prompt — to a relay's `/responses` or `/v1/messages`, so a provider
that turns other clients away serves magpie's (or OpenCode's).

One provider, `client-sim`. Sign-in asks which client to impersonate
(「使用哪种方式模拟」: Codex or Claude Code), the relay's base URL, and the
API key — answered per account, not a provider of its own:

| Sign-in picks | Impersonates | Requests go as | For relays that serve |
|---|---|---|---|
| `Codex` | Codex CLI (`codex_cli_rs`) | OpenAI Responses `/responses` | Codex clients |
| `Claude Code` | Claude Code CLI (`claude-cli`) | Anthropic `/v1/messages?beta=true` | Claude Code clients |

Sign-in asks which client to impersonate (「使用哪种方式模拟」), the relay's
base URL, and the API key, and keeps one account per key
(`plugin-auth.json`); several relays,
or several keys of one relay, are several accounts magpie orders and
falls back over as a built-in's. The models are read from the relay
itself (`GET /v1/models`, under the client's identity).

Impersonation is set in the plugin's options, with a default that answers
most relays:

```json
{
  "enabled": true,
  "codex": { "clientVersion": "0.162.1", "instructions": "codex" },
  "claude-code": { "clientVersion": "2.1.296", "build": "406", "entrypoint": "cli", "sdkVersion": "0.128.0", "nodeVersion": "v26.3.0", "fakeUserId": "key", "systemPrompt": "claude-code", "betas": "auto" }
}
```

- `enabled`: the switch. `false` takes the provider off the providers page
  entirely (its tiles, and what it had declared); `true`, the default,
  has it back:

  ```sh
  magpie plugin options client-sim '{"enabled": false}'
  ```
- `clientVersion`: the client version in the User-Agent (and, for
  claude-code, in the billing marker). Bump it when a relay stops serving
  the default. Defaults follow live captures: codex-cli 0.162.1,
  claude-cli 2.1.296.
- `build`, `entrypoint`, `sdkVersion` (claude-code): the build number in
  the billing marker (`406`), the entrypoint it names (`cli`, or `sdk-cli`
  for `claude -p` style use), and the Anthropic TS SDK version the
  x-stainless marks are pinned to (`0.128.0`).
- `instructions` (codex): `"codex"` sends Codex's real base prompt —
  captured verbatim from a live 0.162.1 request — when a request has none
  of its own; any other value sends none.
- `fakeUserId` (claude-code): `"key"` is one stable `metadata.user_id` per
  key, in the JSON shape a real request carries (`device_id`, `session_id`);
  anything else sends none.
- `systemPrompt` (claude-code): `"claude-code"` prepends the billing marker
  and Claude Code's own line when a request has no system; `"sdk"` uses the
  Agent SDK lines instead; `"off"` leaves the request as it is.
- `betas` (claude-code): `"auto"` follows the captured default (the full
  2.1.296 beta list); a string is sent as `anthropic-beta` verbatim.

Each magpie session also gets its own stable conversation identity, hashed
from the session: a Codex account sends it as `session-id`, `thread-id`,
`x-client-request-id` and `x-codex-window-id`, a Claude Code one as
`x-claude-code-session-id` — the same conversation is the same ids every
request, a new one new ones, as a real client's are.

## Install

From this repository (magpie):

```sh
magpie plugin add https://github.com/UNICKCHENG/opencode-client-sim
```

or from npm, once published:

```sh
magpie plugin add @unickcheng/opencode-client-sim
```

then sign in:

```sh
magpie plugin login client-sim
```

Sign-in asks which client to impersonate (「使用哪种方式模拟」), the relay's
base URL, then the API key. The models it serves are
read from the relay itself (`GET /v1/models`, under the client's identity),
as a custom provider's model list is; a relay that won't say leaves the
defaults standing. In the app, the provider appears on the Providers page
after the plugin is installed. Agents use the models as any provider's:
`client-sim/gpt-5.6`, `client-sim/claude-sonnet-5.5`.

OpenCode, in `opencode.json`:

```json
{ "plugin": ["@unickcheng/opencode-client-sim"] }
```

then `opencode auth login`.

## Development

```sh
bun test   # 18 tests, no network: fetch is stubbed
```

The plugin is one file, `index.mjs`: `SIMS` holds the two clients — the
identity headers, the body rewrites — and one provider (`client-sim`)
wears whichever its account picked at sign-in.

## Caution

Impersonating a client against a provider that only permits it may break that
provider's terms and can get an account banned. Use it only with services you
are allowed to use, at your own risk. Keys stay in local `plugin-auth.json`
and are sent nowhere but the relay you named.

## License

MIT
