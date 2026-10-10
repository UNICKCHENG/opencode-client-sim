// What each mask sends, against a captured fetch: the URL it goes to, the
// identity it wears, and what it left of the request it was given. Nothing
// here reaches a network: the plugin's fetch calls globalThis.fetch, which
// the test holds.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { ClientSimPlugin, _internal } from "./index.mjs"

const { baseOf, stableUUID, codexUserAgent, ccUserAgent, modelList } = _internal

const realFetch = globalThis.fetch
let asked
const stub = async (url, init) => {
	asked = { url: String(url), init }
	return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
}
beforeEach(() => {
	globalThis.fetch = stub
})
afterEach(() => {
	asked = undefined
	globalThis.fetch = realFetch
})

// an account of the client it names: codex unless said otherwise
const account = (meta) => ({
	type: "api",
	key: "sk-relay-1",
	metadata: { client: "codex", baseURL: "https://relay.example.com", models: "gpt-5.6, gpt-5.6-sol", ...meta },
})
const ccAccount = (meta) => account({ client: "claude-code", baseURL: "https://cc-relay.example.com", models: "claude-sonnet-5.5", ...meta })

const hooksOf = async (options) => await ClientSimPlugin({ client: {} }, options)

test("baseOf normalizes what the user pasted", () => {
	expect(baseOf("https://relay.example.com/")).toBe("https://relay.example.com")
	expect(baseOf("relay.example.com")).toBe("https://relay.example.com")
	expect(baseOf("https://relay.example.com/sub/")).toBe("https://relay.example.com/sub")
	expect(() => baseOf("not an address at all")).toThrow()
})

test("stableUUID is a stable UUID-shaped identity of its seed", () => {
	const a = stableUUID("seed")
	expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
	expect(stableUUID("seed")).toBe(a)
	expect(stableUUID("other")).not.toBe(a)
})

test("sign-in asks which client, the relay's address, then the key — models come from the relay", async () => {
	const [method] = (await hooksOf()).auth.methods
	expect(method.type).toBe("api")
	expect(method.prompts.map((p) => p.key)).toEqual(["client", "baseURL"])
	const [client, base] = method.prompts
	expect(client.type).toBe("select")
	expect(client.options.map((o) => o.value)).toEqual(["codex", "claude-code"])
	expect(client.validate("codex")).toBe(null)
	expect(client.validate("vscode")).toBeTruthy()
	expect(base.validate("relay.example.com")).toBe(null)
	expect(base.validate("nope")).toBeTruthy()
})

test("the model list of an account is the models it signed in with", () => {
	expect(modelList(account({}))).toEqual(["gpt-5.6", "gpt-5.6-sol"])
	expect(modelList(account({ models: "" }))).toEqual([])
})

test("the models hook lists the account's models under its provider, in its client's API family", async () => {
	const hooks = await hooksOf()
	const list = await hooks.provider.models({ models: { kept: {} } }, { auth: account({}) })
	expect(Object.keys(list)).toEqual(["gpt-5.6", "gpt-5.6-sol"])
	expect(list["gpt-5.6"].providerID).toBe("client-sim")
	expect(list["gpt-5.6"].api.npm).toBe("@ai-sdk/openai")
	// a claude-code account's models carry the Anthropic npm
	const cc = await hooks.provider.models({ models: {} }, { auth: ccAccount({ models: "claude-sonnet-5.5" }) })
	expect(cc["claude-sonnet-5.5"].api.npm).toBe("@ai-sdk/anthropic")
	// no list signed in with: the provider keeps what it had
	expect(await hooks.provider.models({ models: { kept: {} } }, { auth: account({ models: "" }) })).toEqual({ kept: {} })
})

test("with no list of its own, the models are read from the relay under the client's identity", async () => {
	const asked = []
	const was = globalThis.fetch
	globalThis.fetch = async (url, init) => {
		asked.push([String(url), init])
		return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5.5" }] }), { headers: { "content-type": "application/json" } })
	}
	try {
		const hooks = await hooksOf()
		const auth = { ...ccAccount({ models: "" }), key: "sk-disc-1" }
		const list = await hooks.provider.models({ models: { kept: {} } }, { auth })
		expect(Object.keys(list)).toEqual(["claude-sonnet-5.5"])
		expect(list["claude-sonnet-5.5"].providerID).toBe("client-sim")
		// the discovery asks the relay's /v1/models wearing the client's clothes
		expect(asked[0][0]).toBe("https://cc-relay.example.com/v1/models")
		const h = new Headers(asked[0][1].headers)
		expect(h.get("user-agent")).toContain("claude-cli/")
		expect(h.get("authorization")).toBe("Bearer sk-disc-1")
		expect(h.get("accept")).toBe("application/json")
		// a relay that won't say leaves the provider's defaults standing
		globalThis.fetch = async () => new Response("nope", { status: 404 })
		expect(await hooks.provider.models({ models: { kept: {} } }, { auth: account({ baseURL: "https://x.example.com", key: "k2", models: "" }) })).toEqual({ kept: {} })
	} finally {
		globalThis.fetch = was
	}
})

test("the provider switched off in the options is not declared at all", async () => {
	const hooks = await hooksOf({ enabled: false })
	const config = { provider: { "client-sim": { name: "was here" }, other: {} } }
	await hooks.config(config)
	expect(config.provider["client-sim"]).toBeUndefined()
	expect(config.provider.other).toEqual({}) // untouched
})

test("the config hook declares one provider with a default model list", async () => {
	const config = { provider: {} }
	await (await hooksOf()).config(config)
	expect(config.provider["client-sim"].name).toBe("Client Sim")
	expect(config.provider["client-sim"].npm).toBe("@ai-sdk/openai")
	expect(Object.keys(config.provider["client-sim"].models).length).toBeGreaterThan(0)
})

test("a codex account sends the request a Codex CLI would", async () => {
	const hooks = await hooksOf({ codex: { clientVersion: "0.162.1" } })
	const loader = await hooks.auth.loader(async () => account({}))
	expect(loader.baseURL).toBe("https://relay.example.com")
	expect(loader.apiKey).toBe("sk-relay-1")
	await loader.fetch("https://client-sim.invalid/responses", {
		method: "POST",
		headers: {
			authorization: "Bearer sk-relay-1",
			"x-stainless-lang": "js",
			"x-stainless-runtime": "bun",
		},
		body: JSON.stringify({ model: "gpt-5.6", stream: true, input: [] }),
	})
	expect(asked.url).toBe("https://relay.example.com/responses")
	const h = asked.init.headers
	expect(h.get("user-agent")).toBe(codexUserAgent("0.162.1"))
	expect(h.get("originator")).toBe("codex_cli_rs")
	// 0.162.1 over plain HTTP sends no OpenAI-Beta; it names its beta
	// features instead, and no SDK marks at all
	expect(h.get("openai-beta")).toBe(null)
	expect(h.get("x-codex-beta-features")).toBe("remote_compaction_v2")
	expect(h.get("x-stainless-lang")).toBe(null)
	expect(h.get("authorization")).toBe("Bearer sk-relay-1")
	const body = JSON.parse(asked.init.body)
	expect(body.store).toBe(false)
	expect(body.include).toEqual(["reasoning.encrypted_content"])
	expect(body.reasoning).toEqual({ summary: "auto" })
	expect(body.instructions).toContain("You are a coding agent running in the Codex CLI")
	expect(body.model).toBe("gpt-5.6")
})

test("a codex request with its own instructions keeps them", async () => {
	const hooks = await hooksOf()
	const loader = await hooks.auth.loader(async () => account({}))
	await loader.fetch("https://client-sim.invalid/responses", {
		headers: {},
		body: JSON.stringify({ instructions: "my own", input: [] }),
	})
	expect(JSON.parse(asked.init.body).instructions).toBe("my own")
})

test("chat.headers gives each session a stable conversation id of its own", async () => {
	const hooks = await hooksOf()
	// the session marks come from the account's loader, as they do in the host
	const codexLoader = await hooks.auth.loader(async () => account({}))
	const out = { headers: {} }
	hooks["chat.headers"]({ model: { providerID: "client-sim" }, sessionID: "s-1", provider: { options: codexLoader } }, out)
	expect(out.headers["session-id"]).toMatch(/^[0-9a-f-]{36}$/)
	expect(out.headers["thread-id"]).toBe(out.headers["session-id"])
	expect(out.headers["x-client-request-id"]).toBe(out.headers["session-id"])
	expect(out.headers["x-codex-window-id"]).toBe(out.headers["session-id"] + ":0")
	const again = { headers: {} }
	hooks["chat.headers"]({ model: { providerID: "client-sim" }, sessionID: "s-1", provider: { options: codexLoader } }, again)
	expect(again.headers["session-id"]).toBe(out.headers["session-id"])
	const other = { headers: {} }
	hooks["chat.headers"]({ model: { providerID: "client-sim" }, sessionID: "s-2", provider: { options: codexLoader } }, other)
	expect(other.headers["session-id"]).not.toBe(out.headers["session-id"])
	// a claude-code account names its session in its own header
	const ccLoader = await hooks.auth.loader(async () => ccAccount({}))
	const cc = { headers: {} }
	hooks["chat.headers"]({ model: { providerID: "client-sim" }, sessionID: "s-1", provider: { options: ccLoader } }, cc)
	expect(cc.headers["x-claude-code-session-id"]).toMatch(/^[0-9a-f-]{36}$/)
	// another provider's request, or none of a session: nothing added
	const none = { headers: {} }
	hooks["chat.headers"]({ model: { providerID: "zcode" }, sessionID: "s-1", provider: { options: codexLoader } }, none)
	hooks["chat.headers"]({ model: { providerID: "client-sim" }, sessionID: "" }, none)
	expect(none.headers).toEqual({})
})

test("a claude-code account sends the request a Claude Code CLI would", async () => {
	const hooks = await hooksOf({ "claude-code": { clientVersion: "2.1.296" } })
	const loader = await hooks.auth.loader(async () => ccAccount({}))
	await loader.fetch("https://client-sim.invalid/messages", {
		method: "POST",
		headers: { "x-stainless-package-version": "9.9.9", authorization: "Bearer sk-relay-1" },
		body: JSON.stringify({ model: "claude-sonnet-5.5", stream: true, messages: [] }),
	})
	expect(asked.url).toBe("https://cc-relay.example.com/v1/messages?beta=true")
	const h = asked.init.headers
	expect(h.get("user-agent")).toBe(ccUserAgent("2.1.296"))
	expect(h.get("x-app")).toBe("cli")
	expect(h.get("anthropic-version")).toBe("2023-06-01")
	expect(h.get("anthropic-beta")).toContain("claude-code-20250219")
	expect(h.get("anthropic-beta")).toContain("afk-mode-2026-01-31")
	expect(h.get("anthropic-dangerous-direct-browser-access")).toBe("true")
	// a real Claude Code is built on the TS SDK and says so, pinned to a
	// version of it, whatever SDK magpie's side runs
	expect(h.get("x-stainless-package-version")).toBe("0.128.0")
	expect(h.get("x-stainless-lang")).toBe("js")
	// pinned to a real node version — the host runs Bun, and a "node"
	// runtime naming a Bun version would be a tell
	expect(h.get("x-stainless-runtime-version")).toBe("v26.3.0")
	const body = JSON.parse(asked.init.body)
	expect(body.system[0].text).toContain("cc_version=2.1.296")
	expect(body.system[1].text).toContain("Claude Code")
	const uid = JSON.parse(body.metadata.user_id)
	expect(uid.device_id).toMatch(/^[0-9a-f]{64}$/)
	expect(uid.session_id).toMatch(/^[0-9a-f-]{36}$/)
})

test("a cc request keeps its own system, and the user id is stable per key", async () => {
	const hooks = await hooksOf()
	const load = async (key = "sk-relay-1") => await hooks.auth.loader(async () => ({ ...ccAccount({}), key }))
	await (await load()).fetch("https://client-sim.invalid/messages", {
		headers: {},
		body: JSON.stringify({ system: [{ type: "text", text: "mine" }], messages: [] }),
	})
	const first = JSON.parse(asked.init.body)
	expect(first.system).toEqual([{ type: "text", text: "mine" }])
	await (await load()).fetch("https://client-sim.invalid/messages", { headers: {}, body: JSON.stringify({ messages: [] }) })
	expect(JSON.parse(asked.init.body).metadata.user_id).toBe(first.metadata.user_id)
	// a different key is a different user
	await (await load("sk-relay-2")).fetch("https://client-sim.invalid/messages", { headers: {}, body: JSON.stringify({ messages: [] }) })
	expect(JSON.parse(asked.init.body).metadata.user_id).not.toBe(first.metadata.user_id)
})

test("an account of a client that isn't one says so at load", async () => {
	const hooks = await hooksOf()
	await expect(hooks.auth.loader(async () => account({ client: "vscode" }))).rejects.toThrow("unknown client")
})

test("options can turn the impersonation's marks off", async () => {
	const hooks = await hooksOf({ "claude-code": { systemPrompt: "off", fakeUserId: "off", betas: "" } })
	const loader = await hooks.auth.loader(async () => ccAccount({}))
	await loader.fetch("https://client-sim.invalid/messages", { headers: {}, body: JSON.stringify({ messages: [] }) })
	const body = JSON.parse(asked.init.body)
	expect(body.system).toBeUndefined()
	expect(body.metadata).toBeUndefined()
	// an empty betas is no header, not an empty one
	expect(asked.init.headers.get("anthropic-beta")).toBe(null)
})

test("a non-streaming request asks for JSON, a streaming one for events", async () => {
	const hooks = await hooksOf()
	const loader = await hooks.auth.loader(async () => account({}))
	await loader.fetch("https://client-sim.invalid/responses", { headers: {}, body: JSON.stringify({ stream: false, input: [] }) })
	expect(asked.init.headers.get("accept")).toBe("application/json")
	await loader.fetch("https://client-sim.invalid/responses", { headers: {}, body: JSON.stringify({ stream: true, input: [] }) })
	expect(asked.init.headers.get("accept")).toBe("text/event-stream")
})

test("an account without a relay address says so, not a cryptic address error", async () => {
	const hooks = await hooksOf()
	await expect(hooks.auth.loader(async () => account({ baseURL: "" }))).rejects.toThrow("sign in again")
})

test("a request that isn't JSON passes through as it was", async () => {
	const hooks = await hooksOf()
	const loader = await hooks.auth.loader(async () => account({}))
	await loader.fetch("https://client-sim.invalid/responses", { headers: {}, body: "not json" })
	expect(asked.init.body).toBe("not json")
})
