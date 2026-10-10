# opencode-client-sim

Wear a coding client's clothes, for relay sites that only serve Codex CLI or
Claude Code requests. The plugins send the request a real client would — its
User-Agent, `Originator: codex_cli_rs` or `claude-cli`/`x-app`/`anthropic-beta`,
a stable session or user identity, Codex's `instructions` and Claude Code's
system prompt — to a relay's `/responses` or `/v1/messages`, so a provider
that turns other clients away serves magpie's (or OpenCode's).

Two providers, one package:

| Provider id | Impersonates | For relays that serve |
|---|---|---|
| `codex-sim` | Codex CLI (`codex_cli_rs`) | Codex clients, OpenAI Responses `/responses` |
| `claude-code-sim` | Claude Code CLI (`claude-cli`) | Claude Code clients, Anthropic `/v1/messages` |

Sign-in keeps a relay's base URL and an API key, as one account per key
(`plugin-auth.json`); several relays, or several keys of one relay, are
several accounts magpie orders and falls back over as a built-in's.

Impersonation is set in the plugin's options, with a default that answers
most relays:

```json
{
  "codex": { "clientVersion": "0.162.1", "instructions": "codex" },
  "claude-code": { "clientVersion": "2.1.296", "build": "406", "entrypoint": "cli", "sdkVersion": "0.128.0", "nodeVersion": "v26.3.0", "fakeUserId": "key", "systemPrompt": "claude-code", "betas": "auto" }
}
```

- `enabled`: the switch. `false` takes that sim off the providers page
  entirely (its tiles, and what it had declared); `true`, the default,
  has it back. A relay site you no longer use is one option away:

  ```sh
  magpie plugin options client-sim '{"claude-code": {"enabled": false}}'
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
from the session: codex-sim sends it as `session-id`, `thread-id`,
`x-client-request-id` and `x-codex-window-id`, claude-code-sim as
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
magpie plugin login codex-sim   # or claude-code-sim
```

Sign-in asks the relay's base URL, then the API key — the same two things a
custom OpenAI provider takes. The models it serves are read from the relay
itself (`GET /v1/models`, under the client's identity), as a custom
provider's model list is; a relay that won't say leaves the defaults
standing. In the app, the providers appear on the Providers page after the
plugin is installed. Agents use the models as any provider's:
`codex-sim/gpt-5.6`, `claude-code-sim/claude-sonnet-5.5`.

OpenCode, in `opencode.json`:

```json
{ "plugin": ["@unickcheng/opencode-client-sim"] }
```

then `opencode auth login`.

## Development

```sh
bun test   # 15 tests, no network: fetch is stubbed
```

The plugin is one file, `index.mjs`: `makePlugin(sim)` builds a provider from
a `SIMS` entry — the identity headers, the body rewrites, the sign-in prompts
— and the same code serves both `codex-sim` and `claude-code-sim`.

## Caution

Impersonating a client against a provider that only permits it may break that
provider's terms and can get an account banned. Use it only with services you
are allowed to use, at your own risk. Keys stay in local `plugin-auth.json`
and are sent nowhere but the relay you named.

## License

MIT
