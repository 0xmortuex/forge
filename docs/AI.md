# AI features

Forge has a built-in AI assistant. It is **off until you set it up**, and it talks to a server **you** choose: nothing is
sent anywhere by default, and there is no Forge-hosted service.

## What you get

| | |
| --- | --- |
| **AI Assistant window** (<kbd>Alt</kbd>+<kbd>8</kbd>) | A chat about the code in the editor. Answers stream in as Markdown. Each question carries the selection (or the whole open file); choose *Attach: whole file* or *nothing* under the box. Code blocks in answers have **Copy**, **Insert** (at the cursor) and **Replace selection** buttons. **Stop** cancels an answer, **New Chat** starts over. |
| **Selection actions** | Right-click selected code → *AI: Explain Code*, *Find and Fix Problems*, *Write Tests*, *Write Documentation*, *Suggest Refactoring* (also in the Command Palette). With no selection they use the whole file. |
| **Inline suggestions** | Grey ghost text after a pause in typing; <kbd>Tab</kbd> accepts. **Off by default** (Settings → AI → *Suggest code as you type*) because every pause sends a request. A small, fast model works best (*Model for suggestions*). |
| **Commit messages** | *Generate message* in the Commit window describes the ticked changes (tracked files as a diff, new files by their content). |

## Setting it up

Open **Settings → AI** and fill in:

1. **Server URL**: any server that speaks the OpenAI "chat completions" protocol (`POST {URL}/chat/completions`).
2. **Model**: the model name that server expects.
3. **API key** (if the server needs one), then **Test connection**.

| Service | Server URL | Notes |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | Anthropic's OpenAI-compatible endpoint (which Anthropic describes as mainly for trying things out; some Claude-specific features are not available through it). The model is e.g. `claude-sonnet-5-5`. |
| Ollama (local) | `http://localhost:11434/v1` | No key needed; the model must be pulled first (`ollama pull <name>`). |
| LM Studio (local) | `http://localhost:1234/v1` | No key needed. |

## Privacy and safety

- **Your code leaves your machine** when you ask a question, run an action, accept inline suggestions, or generate a
  commit message: the selection or file (up to about 40,000 characters), or the diff, goes to the server you set.
  Only use a server you trust with that code.
- The **first time** Forge would send code to a server, it asks you to agree to that host. Declining sends nothing. The
  agreement is remembered per host. A server on this machine (`localhost`, `127.0.0.1`) is not asked about.
- **Inline suggestions** ask you the same question when you switch them on, not in the middle of typing.
- The **API key** is stored encrypted by your operating system (Electron `safeStorage`, which uses Windows DPAPI, the macOS
  Keychain, or the Linux secret store) in a separate file, never in `settings.json`. It is only used by Forge's main process, which makes the requests; it is
  never read back into the window after you save it (you can only replace or remove it). If your system has no keychain, Forge refuses to store the key instead of saving it in
  plain text.
- Forge sends **no telemetry** and talks to no server other than the one you configured.
- The assistant never edits files by itself: it only inserts or replaces text when you press a button, as one undo step,
  and leaves the file unsaved.

## Troubleshooting

- *"AI is not set up yet"*: the URL or the model is empty.
- *"Could not reach host"*: wrong URL, the server is not running, or no network. *Test connection* shows the exact reason.
- *"… answered 401"*: the key is missing or wrong. *"… answered 404"*: the URL probably needs `/v1` at the end, or the
  model name is not one the server knows.
- Inline suggestions never appear: check that **Suggest code as you type** is on, the model is set, and that you paused
  for about half a second after typing.
- *"… answered 400" mentioning `max_tokens` or `temperature`*: Forge sends both on short requests (suggestions, commit
  messages, the connection test). Some models, such as OpenAI's reasoning models, reject them. Choose an ordinary chat model
  instead. Forge has only been exercised against a mock server, so a real service may need a setting this version lacks;
  please report what you see.
