// Client Sim: one provider that wears a coding client's clothes, for relay
// sites that only serve Codex CLI or Claude Code requests. Which client
// is a sign-in question, not a provider of its own: pick Codex or Claude
// Code, paste the relay's base URL and API key, and every request of that
// account goes as the client you picked —
//
//   Codex  — the request a real Codex CLI (codex_cli_rs) sends: its
//             User-Agent and Originator, a stable per-session Session-Id,
//             store:false and the Codex base instructions, against the
//             relay's /responses.
//   Claude Code — the request a real Claude Code CLI sends: claude-cli
//             User-Agent, x-app, anthropic-beta, a stable per-key
//             metadata.user_id and Claude Code's system prompt when the
//             request has none, against the relay's /v1/messages?beta=true.
//
// Sign-in's ways are the clients — Codex or Claude Code — then it asks the
// relay's base URL and an API key; the
// models it serves are read from the relay itself. Each is kept as one
// account per key (plugin-auth.json), so several relays, or several keys
// of one relay, are several accounts magpie orders and falls back over as
// it does a built-in's. What to impersonate is set in the plugin's
// options (magpie plugin options client-sim '<json>'):
//
//   { "enabled": true,
//     "codex": { "clientVersion": "0.162.1", "instructions": "codex" },
//     "claude-code": { "clientVersion": "2.1.296", "fakeUserId": "key",
//                "systemPrompt": "claude-code", "betas": "auto" } }
import { createHash } from "node:crypto"
import os from "node:os"

// How a real Codex CLI names itself (verified against codex-cli 0.162.1,
// captured live): the OS version is the machine's own, as codex reports it.
const codexPlatform = () => {
	const v = os.release()
	if (process.platform === "darwin") return `Mac OS ${v}; ${process.arch === "arm64" ? "arm64" : "x86_64"}) Mac OS`
	if (process.platform === "win32") return `Windows 11; x86_64) Windows`
	return `${process.arch}) Linux`
}

const codexUserAgent = (v) => `codex_cli_rs/${v} (${codexPlatform()}`
// observed live on claude-cli 2.1.296 run with `claude -p`:
// "claude-cli/2.1.296 (external, sdk-cli)" — the paren part names the entrypoint
const ccUserAgent = (v, entrypoint = "cli") => `claude-cli/${v} (external, ${entrypoint})`

// The base prompt a Codex CLI sends as instructions, condensed to what a
// relay's checks read of it. Not the model's own instructions: a request
// that already has instructions keeps its own.
// The base prompt a real Codex CLI sends, captured verbatim from a live
// codex-cli 0.162.1 request (its generic base prompt; nothing of this
// machine is in it). A request that already has instructions keeps its own.
const CODEX_INSTRUCTIONS = "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.\n\nYour capabilities:\n\n- Receive user prompts and other context provided by the harness, such as files in the workspace.\n- Communicate with the user by streaming thinking & responses, and by making & updating plans.\n- Emit function calls to run terminal commands and apply patches. Depending on how this specific run is configured, you can request that these function calls be escalated to the user for approval before running. More on this in the \"Sandbox and approvals\" section.\n\nWithin this context, Codex refers to the open-source agentic coding interface (not the old Codex language model built by OpenAI).\n\n# How you work\n\n## Personality\n\nYour default personality and tone is concise, direct, and friendly. You communicate efficiently, always keeping the user clearly informed about ongoing actions without unnecessary detail. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. Unless explicitly asked, you avoid excessively verbose explanations about your work.\n\n# AGENTS.md spec\n- Repos often contain AGENTS.md files. These files can appear anywhere within the repository.\n- These files are a way for humans to give you (the agent) instructions or tips for working within the container.\n- Some examples might be: coding conventions, info about how code is organized, or instructions for how to run or test code.\n- Instructions in AGENTS.md files:\n    - The scope of an AGENTS.md file is the entire directory tree rooted at the folder that contains it.\n    - For every file you touch in the final patch, you must obey instructions in any AGENTS.md file whose scope includes that file.\n    - Instructions about code style, structure, naming, etc. apply only to code within the AGENTS.md file's scope, unless the file states otherwise.\n    - More-deeply-nested AGENTS.md files take precedence in the case of conflicting instructions.\n    - Direct system/developer/user instructions (as part of a prompt) take precedence over AGENTS.md instructions.\n- The contents of the AGENTS.md file at the root of the repo and any directories from the CWD up to the root are included with the developer message and don't need to be re-read. When working in a subdirectory of CWD, or a directory outside the CWD, check for any AGENTS.md files that may be applicable.\n\n## Responsiveness\n\n### Preamble messages\n\nBefore making tool calls, send a brief preamble to the user explaining what you\u2019re about to do. When sending preamble messages, follow these principles and examples:\n\n- **Logically group related actions**: if you\u2019re about to run several related commands, describe them together in one preamble rather than sending a separate note for each.\n- **Keep it concise**: be no more than 1-2 sentences, focused on immediate, tangible next steps. (8\u201312 words for quick updates).\n- **Build on prior context**: if this is not your first tool call, use the preamble message to connect the dots with what\u2019s been done so far and create a sense of momentum and clarity for the user to understand your next actions.\n- **Keep your tone light, friendly and curious**: add small touches of personality in preambles feel collaborative and engaging.\n- **Exception**: Avoid adding a preamble for every trivial read (e.g., `cat` a single file) unless it\u2019s part of a larger grouped action.\n\n**Examples:**\n\n- \u201cI\u2019ve explored the repo; now checking the API route definitions.\u201d\n- \u201cNext, I\u2019ll patch the config and update the related tests.\u201d\n- \u201cI\u2019m about to scaffold the CLI commands and helper functions.\u201d\n- \u201cOk cool, so I\u2019ve wrapped my head around the repo. Now digging into the API routes.\u201d\n- \u201cConfig\u2019s looking tidy. Next up is patching helpers to keep things in sync.\u201d\n- \u201cFinished poking at the DB gateway. I will now chase down error handling.\u201d\n- \u201cAlright, build pipeline order is interesting. Checking how it reports failures.\u201d\n- \u201cSpotted a clever caching util; now hunting where it gets used.\u201d\n\n## Task execution\n\nYou are a coding agent. Please keep going until the query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. Autonomously resolve the query to the best of your ability, using the tools available to you, before coming back to the user. Do NOT guess or make up an answer.\n\nYou MUST adhere to the following criteria when solving queries:\n\n- Working on the repo(s) in the current environment is allowed, even if they are proprietary.\n- Analyzing code for vulnerabilities is allowed.\n- Showing user code and tool call details is allowed.\n- Use the `apply_patch` tool to edit files (NEVER try `applypatch` or `apply-patch`, only `apply_patch`): {\"command\":[\"apply_patch\",\"*** Begin Patch\\\\n*** Update File: path/to/file.py\\\\n@@ def example():\\\\n- pass\\\\n+ return 123\\\\n*** End Patch\"]}\n\nIf completing the user's task requires writing or modifying files, your code and final answer should follow these coding guidelines, though user instructions (i.e. AGENTS.md) may override these guidelines:\n\n- Fix the problem at the root cause rather than applying surface-level patches, when possible.\n- Avoid unneeded complexity in your solution.\n- Do not attempt to fix unrelated bugs or broken tests. It is not your responsibility to fix them. (You may mention them to the user in your final message though.)\n- Update documentation as necessary.\n- Keep changes consistent with the style of the existing codebase. Changes should be minimal and focused on the task.\n- Use `git log` and `git blame` to search the history of the codebase if additional context is required.\n- NEVER add copyright or license headers unless specifically requested.\n- Do not waste tokens by re-reading files after calling `apply_patch` on them. The tool call will fail if it didn't work. The same goes for making folders, deleting folders, etc.\n- Do not `git commit` your changes or create new git branches unless explicitly requested.\n- Do not add inline comments within code unless explicitly requested.\n- Do not use one-letter variable names unless explicitly requested.\n- NEVER output inline citations like \"\u3010F:README.md\u2020L5-L14\u3011\" in your outputs. The CLI is not able to render these so they will just be broken in the UI. Instead, if you output valid filepaths, users will be able to click on them to open the files in their editor.\n\n## Validating your work\n\nIf the codebase has tests or the ability to build or run, consider using them to verify that your work is complete. \n\nWhen testing, your philosophy should be to start as specific as possible to the code you changed so that you can catch issues efficiently, then make your way to broader tests as you build confidence. If there's no test for the code you changed, and if the adjacent patterns in the codebases show that there's a logical place for you to add a test, you may do so. However, do not add tests to codebases with no tests.\n\nSimilarly, once you're confident in correctness, you can suggest or use formatting commands to ensure that your code is well formatted. If there are issues you can iterate up to 3 times to get formatting right, but if you still can't manage it's better to save the user time and present them a correct solution where you call out the formatting in your final message. If the codebase does not have a formatter configured, do not add one.\n\nFor all of testing, running, building, and formatting, do not attempt to fix unrelated bugs. It is not your responsibility to fix them. (You may mention them to the user in your final message though.)\n\nBe mindful of whether to run validation commands proactively. In the absence of behavioral guidance:\n\n- When running in the non-interactive approval mode **never**, proactively run tests, lint and do whatever you need to ensure you've completed the task.\n- When working in interactive approval modes like **untrusted**, or **on-request**, hold off on running tests or lint commands until the user is ready for you to finalize your output, because these commands take time to run and slow down iteration. Instead suggest what you want to do next, and let the user confirm first.\n- When working on test-related tasks, such as adding tests, fixing tests, or reproducing a bug to verify behavior, you may proactively run tests regardless of approval mode. Use your judgement to decide whether this is a test-related task.\n\n## Ambition vs. precision\n\nFor tasks that have no prior context (i.e. the user is starting something brand new), you should feel free to be ambitious and demonstrate creativity with your implementation.\n\nIf you're operating in an existing codebase, you should make sure you do exactly what the user asks with surgical precision. Treat the surrounding codebase with respect, and don't overstep (i.e. changing filenames or variables unnecessarily). You should balance being sufficiently ambitious and proactive when completing tasks of this nature.\n\nYou should use judicious initiative to decide on the right level of detail and complexity to deliver based on the user's needs. This means showing good judgment that you're capable of doing the right extras without gold-plating. This might be demonstrated by high-value, creative touches when scope of the task is vague; while being surgical and targeted when scope is tightly specified.\n\n## Sharing progress updates\n\nFor especially longer tasks that you work on (i.e. requiring many tool calls, or a plan with multiple steps), you should provide progress updates back to the user at reasonable intervals. These updates should be structured as a concise sentence or two (no more than 8-10 words long) recapping progress so far in plain language: this update demonstrates your understanding of what needs to be done, progress so far (i.e. files explores, subtasks complete), and where you're going next.\n\nBefore doing large chunks of work that may incur latency as experienced by the user (i.e. writing a new file), you should send a concise message to the user with an update indicating what you're about to do to ensure they know what you're spending time on. Don't start editing or writing large files before informing the user what you are doing and why.\n\nThe messages you send before tool calls should describe what is immediately about to be done next in very concise language. If there was previous work done, this preamble message should also include a note about the work done so far to bring the user along.\n\n## Presenting your work and final message\n\nYour final message should read naturally, like an update from a concise teammate. For casual conversation, brainstorming tasks, or quick questions from the user, respond in a friendly, conversational tone. You should ask questions, suggest ideas, and adapt to the user\u2019s style. If you've finished a large amount of work, when describing what you've done to the user, you should follow the final answer formatting guidelines to communicate substantive changes. You don't need to add structured formatting for one-word answers, greetings, or purely conversational exchanges.\n\nYou can skip heavy formatting for single, simple actions or confirmations. In these cases, respond in plain sentences with any relevant next step or quick option. Reserve multi-section structured responses for results that need grouping or explanation.\n\nThe user is working on the same computer as you, and has access to your work. As such there's no need to show the full contents of large files you have already written unless the user explicitly asks for them. Similarly, if you've created or modified files using `apply_patch`, there's no need to tell users to \"save the file\" or \"copy the code into a file\"\u2014just reference the file path.\n\nIf there's something that you think you could help with as a logical next step, concisely ask the user if they want you to do so. Good examples of this are running tests, committing changes, or building out the next logical component. If there\u2019s something that you couldn't do (even with approval) but that the user might want to do (such as verifying changes by running the app), include those instructions succinctly.\n\nBrevity is very important as a default. You should be very concise (i.e. no more than 10 lines), but can relax this requirement for tasks where additional detail and comprehensiveness is important for the user's understanding.\n\n### Final answer structure and style guidelines\n\nYou are producing plain text that will later be styled by the CLI. Follow these rules exactly. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.\n\n**Section Headers**\n\n- Use only when they improve clarity \u2014 they are not mandatory for every answer.\n- Choose descriptive names that fit the content\n- Keep headers short (1\u20133 words) and in `**Title Case**`. Always start headers with `**` and end with `**`\n- Leave no blank line before the first bullet under a header.\n- Section headers should only be used where they genuinely improve scanability; avoid fragmenting the answer.\n\n**Bullets**\n\n- Use `-` followed by a space for every bullet.\n- Merge related points when possible; avoid a bullet for every trivial detail.\n- Keep bullets to one line unless breaking for clarity is unavoidable.\n- Group into short lists (4\u20136 bullets) ordered by importance.\n- Use consistent keyword phrasing and formatting across sections.\n\n**Monospace**\n\n- Wrap all commands, file paths, env vars, and code identifiers in backticks (`` `...` ``).\n- Apply to inline examples and to bullet keywords if the keyword itself is a literal file/command.\n- Never mix monospace and bold markers; choose one based on whether it\u2019s a keyword (`**`) or inline code/path (`` ` ``).\n\n**File References**\nWhen referencing files in your response, make sure to include the relevant start line and always follow the below rules:\n  * Use inline code to make file paths clickable.\n  * Each reference should have a stand alone path. Even if it's the same file.\n  * Accepted: absolute, workspace\u2011relative, a/ or b/ diff prefixes, or bare filename/suffix.\n  * Line/column (1\u2011based, optional): :line[:column] or #Lline[Ccolumn] (column defaults to 1).\n  * Do not use URIs like file://, vscode://, or https://.\n  * Do not provide range of lines\n  * Examples: src/app.ts, src/app.ts:42, b/server/index.js#L10, C:\\repo\\project\\main.rs:12:5\n\n**Structure**\n\n- Place related bullets together; don\u2019t mix unrelated concepts in the same section.\n- Order sections from general \u2192 specific \u2192 supporting info.\n- For subsections (e.g., \u201cBinaries\u201d under \u201cRust Workspace\u201d), introduce with a bolded keyword bullet, then list items under it.\n- Match structure to complexity:\n  - Multi-part or detailed results \u2192 use clear headers and grouped bullets.\n  - Simple results \u2192 minimal headers, possibly just a short list or paragraph.\n\n**Tone**\n\n- Keep the voice collaborative and natural, like a coding partner handing off work.\n- Be concise and factual \u2014 no filler or conversational commentary and avoid unnecessary repetition\n- Use present tense and active voice (e.g., \u201cRuns tests\u201d not \u201cThis will run tests\u201d).\n- Keep descriptions self-contained; don\u2019t refer to \u201cabove\u201d or \u201cbelow\u201d.\n- Use parallel structure in lists for consistency.\n\n**Don\u2019t**\n\n- Don\u2019t use literal words \u201cbold\u201d or \u201cmonospace\u201d in the content.\n- Don\u2019t nest bullets or create deep hierarchies.\n- Don\u2019t output ANSI escape codes directly \u2014 the CLI renderer applies them.\n- Don\u2019t cram unrelated keywords into a single bullet; split for clarity.\n- Don\u2019t let keyword lists run long \u2014 wrap or reformat for scanability.\n\nGenerally, ensure your final answers adapt their shape and depth to the request. For example, answers to code explanations should have a precise, structured explanation with code references that answer the question directly. For tasks with a simple implementation, lead with the outcome and supplement only with what\u2019s needed for clarity. Larger changes can be presented as a logical walkthrough of your approach, grouping related steps, explaining rationale where it adds value, and highlighting next actions to accelerate the user. Your answers should provide the right level of detail while being easily scannable.\n\nFor casual greetings, acknowledgements, or other one-off conversational messages that are not delivering substantive information or structured results, respond naturally without section headers or bullet formatting.\n\n# Tool Guidelines\n\n## Shell commands\n\nWhen using the shell, you must adhere to the following guidelines:\n\n- When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`. (If the `rg` command is not found, then use alternatives.)\n- Do not use python scripts to attempt to output larger chunks of a file.\n\n"

// Claude Code's first system block, sent when a request has no system of
// its own. A relay that reads the system prompt sees the client it expects.
const CC_SYSTEM = `You are Claude Code, Anthropic's official CLI for Claude.`

// The beta flags a real claude-cli 2.1.296 sends, captured live.
const CC_BETAS = "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,effort-2025-11-24,dangerous-tool-use-2026-09-03,afk-mode-2026-01-31"

// The first system block a real Claude Code request carries: a billing
// marker naming the client's exact build and entrypoint (observed:
// "x-anthropic-billing-header: cc_version=2.1.296.406; cc_entrypoint=sdk-cli;").
const ccBilling = (version, build, entrypoint) => `x-anthropic-billing-header: cc_version=${version}.${build}; cc_entrypoint=${entrypoint};`

// The x-stainless marks a real Claude Code request carries (it is built on
// the Anthropic TS SDK 0.128.0 and says so) — pinned, so the relay reads a
// coherent client whatever SDK version magpie's side happens to run.
const stainlessHeaders = (packageVersion, nodeVersion) => ({
	"X-Stainless-Lang": "js",
	"X-Stainless-Package-Version": packageVersion,
	"X-Stainless-OS": process.platform === "darwin" ? "MacOS" : process.platform === "win32" ? "Windows" : "Linux",
	"X-Stainless-Arch": process.arch === "arm64" ? "arm64" : "x64",
	"X-Stainless-Runtime": "node",
	// pinned, not read from this process: magpie's plugin host runs under
	// Bun, and a "node" runtime naming a Bun version is a tell
	"X-Stainless-Runtime-Version": nodeVersion,
	"X-Stainless-Retry-Count": "0",
	"X-Stainless-Timeout": "300",
})

// stableUUID derives a UUID-shaped identity from a seed: the same seed is
// the same identity across requests and restarts, a different seed a
// different one. The seed is hashed, never sent, so the relay can't read
// the key or session it came from.
const stableUUID = (seed) => {
	const h = createHash("sha256").update(seed).digest("hex")
	return [h.slice(0, 8), h.slice(8, 12), "4" + h.slice(13, 16), "8" + h.slice(17, 20), h.slice(20, 32)].join("-")
}

// baseOf normalizes what the user pasted: a scheme and host at least, no
// trailing slash, so `${base}${path}` is always a whole URL.
const baseOf = (s) => {
	let u = String(s ?? "").trim()
	if (!u) throw new Error("no address")
	if (!/^https?:\/\//i.test(u)) u = "https://" + u
	u = u.replace(/\/+$/, "")
	// a host is a host: no spaces, and a dot (or localhost), so "not an
	// address at all" isn't accepted for one
	const host = u.match(/^https?:\/\/([^/]+)/i)?.[1] ?? ""
	if (!host || /\s/.test(host) || (!host.includes(".") && host !== "localhost")) throw new Error("not an address: " + s)
	return u
}

// bodyOf reads what the SDK sent, JSON or not: what isn't JSON passes
// through untouched, as a request that mentions no model to rewrite.
const bodyOf = async (init) => {
	const b = init?.body
	if (typeof b !== "string") return { json: undefined, text: b }
	try {
		return { json: JSON.parse(b), text: b }
	} catch {
		return { json: undefined, text: b }
	}
}

// simulated is the fetch the SDK's requests go through: the identity a client
// would have, on the URL the relay expects, in a body shaped as the client
// sends it. Everything else the request was — auth, model, messages,
// tools — stays as magpie built it.
const simulated = (sim, opts, auth) => {
	const meta = auth?.metadata ?? {}
	const base = baseOf(meta.baseURL)
	const version = String(opts.clientVersion ?? "").trim() || sim.defaultVersion
	return async (input, init) => {
		const url = `${base}${sim.path}`
		const headers = new Headers(init?.headers)
		// the AI SDK's own marks would tell the relay this is a library, not
		// a client; a client sends none of them
		for (const k of [...headers.keys()]) if (/^x-stainless/i.test(k)) headers.delete(k)
		for (const [k, v] of Object.entries(sim.headers(version, opts))) {
			// an identity header the options turned off (an empty anthropic-beta)
			// is left off, not sent empty for a relay to wonder at
			if (v === "") continue
			headers.set(k, v)
		}
		const { json: body } = await bodyOf(init)
		// a streaming request takes events, a non-streaming one JSON — the
		// same client's requests say so the same way
		if (sim.accept && body !== undefined) headers.set("Accept", body.stream === false ? "application/json" : "text/event-stream")
		const rewritten = body === undefined ? init?.body : JSON.stringify(sim.body(body, { opts, auth, version }))
		return globalThis.fetch(url, { ...init, method: init?.method ?? "POST", headers, body: rewritten })
	}
}

// promptOf asks the one thing sign-in needs that a key alone doesn't
// say: where the relay is. Which client to wear is the way you sign in
// (the method buttons, one screen), and the key is asked after, as every
// api sign-in's is. The models aren't asked: they are read from the relay
// (discoverModels).
const promptOf = () => [
	{
		type: "text",
		key: "baseURL",
		message: "Relay base URL, no path",
		placeholder: "https://relay.example.com",
		validate: (v) => {
			try {
				baseOf(v)
				return null
			} catch {
				return "an address like https://relay.example.com"
			}
		},
	},
]

// the ways to sign in are the clients: picking Codex or Claude Code is
// picking what to wear, on the screen where a sign-in's way is picked —
// one button a client, not a question more. authorize stamps the account
// with the choice; the key still comes after, as every api sign-in's does.
const methodsOf = () =>
	["codex", "claude-code"].map((client) => ({
		type: "api",
		label: client === "codex" ? "Codex" : "Claude Code",
		placeholder: "sk-…",
		prompts: promptOf(),
		authorize: async () => ({ type: "success", metadata: { client } }),
	}))

// configModel/runtimeModel are the two shapes a model is listed in: what
// the config hook declares and what a models hook returns.
const configModel = (id) => ({
	id,
	providerID: "",
	name: id,
	api: { id, url: "", npm: "" },
	status: "active",
	headers: {},
	options: {},
	cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
	limit: { context: 0, input: undefined, output: 0 },
	capabilities: {
		temperature: false, reasoning: true, attachment: true, toolcall: true,
		input: { text: true, image: true, audio: false, video: false, pdf: true },
		output: { text: true, image: false, audio: false, video: false, pdf: false },
		interleaved: false,
	},
	release_date: "",
	variants: {},
})
const runtimeModel = (id, providerID, npm) => ({
	...configModel(id),
	providerID,
	api: { id, url: "", npm },
})

// modelList reads the model list the account signed in with; a blank list
// is no list: the provider keeps what it had rather than promise models
// the relay never named.
const modelList = (auth) =>
	String(auth?.metadata?.models ?? "")
		.split(",")
		.map((m) => m.trim())
		.filter(Boolean)

// discoverModels asks the relay itself which models it serves, as a real
// client's list comes to it: GET /v1/models under the client's own
// identity, so a relay that checks the caller there too reads the client
// it expects. A list once read is kept for a while; a relay that won't
// say leaves the provider's defaults standing.
const MODEL_TTL = 10 * 60 * 1000
const modelCache = new Map() // key -> { list, at }
const discoverModels = async (sim, opts, auth) => {
	const key = auth?.key ?? ""
	const was = modelCache.get(key)
	if (was && Date.now() - was.at < MODEL_TTL) return was.list
	const headers = new Headers()
	headers.set("authorization", `Bearer ${key}`)
	const version = String(opts.clientVersion ?? "").trim() || sim.defaultVersion
	for (const [k, v] of Object.entries(sim.headers(version, opts))) {
		if (v === "" || k.toLowerCase() === "accept") continue
		headers.set(k, v)
	}
	headers.set("Accept", "application/json")
	const r = await globalThis.fetch(`${baseOf(auth?.metadata?.baseURL)}/v1/models`, { headers })
	if (!r.ok) throw new Error("relay answered " + r.status + " for /v1/models")
	const j = await r.json()
	const list = (j?.data ?? j?.models ?? [])
		.map((m) => String(m?.id ?? "").trim())
		.filter(Boolean)
	modelCache.set(key, { list, at: Date.now() })
	return list
}

// simOf is the client an account picked at sign-in; the account's
// metadata names it, and every request of that account wears it.
const simOf = (client, what = "account") => {
	const sim = SIMS[client]
	if (!sim) throw new Error(`unknown client ${JSON.stringify(client)} on ${what}; sign in again`)
	return sim
}

// the plugin: one provider, client-sim. Which client to imitate is a
// sign-in question answered per account, not a provider of its own.
const makePlugin = async (_input, options = {}) => {
	const optsOf = (client) => ({ ...SIMS[client].defaults, ...(options?.[client] ?? {}) })
	const enabled = options?.enabled !== false
	const providerID = "client-sim"
	return {
		auth: {
			provider: providerID,
			loader: async (getAuth) => {
				const auth = await getAuth()
				if (!(auth?.type === "api" && auth.key)) throw new Error("sign in with the client to imitate, a relay base URL and API key first")
				if (!String(auth.metadata?.baseURL ?? "").trim()) throw new Error("this account says no relay address; sign in again")
				const sim = simOf(auth.metadata?.client)
				const opts = optsOf(sim.key)
				const version = String(opts.clientVersion ?? "").trim() || sim.defaultVersion
				return {
					baseURL: baseOf(auth.metadata?.baseURL),
					apiKey: auth.key,
					headers: sim.headers(version, opts),
					fetch: simulated(sim, opts, auth),
					// chat.headers reads this: the session identity headers of the
					// client this account wears
					sessionHeaders: sim.sessionHeaders ?? null,
				}
			},
			methods: methodsOf(),
		},
		async config(config) {
			config.provider ??= {}
			const was = config.provider[providerID] ?? {}
			if (!enabled) {
				// switched off: what it may have declared before goes, or it
				// would linger on as a provider nothing signs in to
				delete config.provider[providerID]
				return
			}
			config.provider[providerID] = {
				name: "Client Sim",
				npm: SIMS.codex.npm,
				api: "https://client-sim.invalid",
				// a list to show before any account says its own; the account's
				// models hook replaces it with what it signed in with, each
				// model carrying the npm of the client that account wears
				models: Object.fromEntries(SIMS.codex.defaultModels.map((m) => [m, configModel(m)])),
				...was,
			}
		},
		provider: {
			id: providerID,
			async models(provider, { auth } = {}) {
				const mine = modelList(auth)
				const client = auth?.metadata?.client
				if (client && !mine.length && auth?.key && String(auth.metadata?.baseURL ?? "").trim()) {
					// what the relay says it serves, as a custom OpenAI provider's
					// model list is; what it won't say, the defaults stand for
					try { mine.push(...(await discoverModels(simOf(client), optsOf(client), auth))) } catch {}
				}
				if (!mine.length) return provider?.models ?? {}
				const npm = client ? simOf(client).npm : SIMS.codex.npm
				return Object.fromEntries(mine.map((m) => [m, runtimeModel(m, providerID, npm)]))
			},
		},
		// chat.headers gives each magpie session its own stable client
		// identity: the same conversation is the same id every request, a new
		// one a new id, as a real client's is. Which identity headers belong
		// on it comes from the account's own loader options, so an account
		// wears its client's session marks, whichever it picked.
		"chat.headers"({ model, sessionID, provider }, out) {
			if (model?.providerID !== providerID || !sessionID) return
			const sessionHeaders = provider?.options?.sessionHeaders
			if (!sessionHeaders) return
			Object.assign(out.headers, sessionHeaders(stableUUID(`${providerID} session ${sessionID}`)))
		},
	}
}

// The two clients. npm names the API the SDK speaks, which is also the
// shape magpie's gateway builds: Responses for Codex, Anthropic Messages
// for Claude Code — so the fetch rewrites identity, not protocol.
const SIMS = {
	codex: {
		key: "codex",
		npm: "@ai-sdk/openai",
		path: "/responses",
		defaultVersion: "0.162.1",
		// captured live from codex-cli 0.162.1: session, thread and client
		// request all name the conversation, the window its own id
		sessionHeaders: (u) => ({ "session-id": u, "thread-id": u, "x-client-request-id": u, "x-codex-window-id": `${u}:0` }),
		defaultModels: ["gpt-5.6", "gpt-5.6-sol"],
		accept: true,
		defaults: { instructions: "codex" },
		headers: (v) => ({
			"User-Agent": codexUserAgent(v),
			Originator: "codex_cli_rs",
			// the beta flags this build turns on over plain HTTP (0.162.1 sends
			// no OpenAI-Beta there; the websocket beta is not our transport)
			"x-codex-beta-features": "remote_compaction_v2",
			Accept: "text/event-stream",
		}),
		body: (b, { opts }) => {
			const out = { ...b, store: false }
			// as the client asks for it: reasoning payloads back, summarized
			if (out.include === undefined) out.include = ["reasoning.encrypted_content"]
			if (out.reasoning === undefined) out.reasoning = { summary: "auto" }
			if (out.instructions === undefined && opts.instructions === "codex") out.instructions = CODEX_INSTRUCTIONS
			return out
		},
	},
	"claude-code": {
		key: "claude-code",
		npm: "@ai-sdk/anthropic",
		// a real Claude Code request goes to /v1/messages?beta=true (observed)
		path: "/v1/messages?beta=true",
		defaultVersion: "2.1.296",
		defaultBuild: "406",
		// a real request names its session in a header too (observed:
		// X-Claude-Code-Session-Id)
		sessionHeaders: (u) => ({ "x-claude-code-session-id": u }),
		defaultModels: ["claude-sonnet-5.5", "claude-opus-5.5"],
		accept: false,
		defaults: { fakeUserId: "key", systemPrompt: "claude-code", betas: "auto", entrypoint: "cli", sdkVersion: "0.128.0", nodeVersion: "v26.3.0" },
		headers: (v, opts) => ({
			"User-Agent": ccUserAgent(v, opts.entrypoint),
			"x-app": "cli",
			"anthropic-version": "2023-06-01",
			"anthropic-beta": opts.betas === "auto" ? CC_BETAS : String(opts.betas ?? ""),
			// observed on a real request; the SDK's browser-access workaround
			"anthropic-dangerous-direct-browser-access": "true",
			// a real Claude Code is built on the Anthropic TS SDK and says so,
			// pinned so the runtime version can't name the host's own
			...stainlessHeaders(String(opts.sdkVersion ?? "").trim() || "0.128.0", String(opts.nodeVersion ?? "").trim() || "v26.3.0"),
		}),
		body: (b, { opts, auth, version }) => {
			const out = { ...b }
			if (opts.systemPrompt !== "off" && out.system === undefined) {
				// a real request's first system block is the billing marker, then
				// the client's own line (observed on 2.1.296)
				const mine =
						opts.systemPrompt === "sdk"
							? ["You are a Claude agent, built on Anthropic's Claude Agent SDK.", "\nYou are an agent working with the user toward their goals, using your own judgment along the way.\n\n"]
							: [CC_SYSTEM]
				out.system = [{ type: "text", text: ccBilling(version, String(opts.build ?? "406").trim() || "406", String(opts.entrypoint ?? "cli")) }, ...mine.map((text) => ({ type: "text", text }))]
			}
			// one user per key, stable across requests and restarts, in the
			// shape a real request carries (observed on 2.1.296): a JSON string
			// with a device id and the session id
			if (opts.fakeUserId === "key" && auth?.key && out.metadata?.user_id === undefined) {
				const device = createHash("sha256").update("cc device " + auth.key).digest("hex")
				out.metadata = { ...(out.metadata ?? {}), user_id: JSON.stringify({ device_id: device, account_uuid: "", session_id: stableUUID("cc " + auth.key) }) }
			}
			return out
		},
	},
}

export const ClientSimPlugin = makePlugin

// for tests
export const _internal = {
	SIMS, baseOf, stableUUID, codexUserAgent, ccUserAgent, simulated, modelList, promptOf, configModel, runtimeModel, simOf,
	constants: { CODEX_INSTRUCTIONS, CC_SYSTEM },
}
