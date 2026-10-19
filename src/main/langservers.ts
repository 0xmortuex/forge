// The language servers Forge knows about beyond its core four (TypeScript/JavaScript, Python, C/C++, Mort), and the check for
// servers the user adds in settings.json. A server is found by file extension or, for files like Dockerfile, by file name.
// Some ship with Forge (npm packages); the rest are used when they are installed, and Forge says once, with the install command,
// when one is missing.

export interface ServerDef {
  /** Short and stable: "gopls". */
  id: string
  /** What the user knows it as: "Go". */
  name: string
  /** File extension (lowercase, with the dot) -> the language id sent to the server. */
  extensions: Record<string, string>
  /** Whole file names (lowercase) -> language id, for files without an extension. */
  names?: Record<string, string>
  /** An npm package that ships with Forge... */
  bundled?: { pkg: string; bin: string; args: string[] }
  /** ...or programs to look for on PATH, tried in order. */
  commands?: { command: string; args: string[] }[]
  /** How to get it, shown when it is missing. */
  install?: string
}

export const BUILTIN_DEFS: ServerDef[] = [
  // ---- shipped with Forge ----
  { id: 'yaml', name: 'YAML', extensions: { '.yml': 'yaml', '.yaml': 'yaml' }, bundled: { pkg: 'yaml-language-server', bin: 'yaml-language-server', args: ['--stdio'] } },
  { id: 'bash', name: 'Shell', extensions: { '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript' }, bundled: { pkg: 'bash-language-server', bin: 'bash-language-server', args: ['start'] } },
  { id: 'docker', name: 'Dockerfile', extensions: { '.dockerfile': 'dockerfile' }, names: { dockerfile: 'dockerfile', containerfile: 'dockerfile' }, bundled: { pkg: 'dockerfile-language-server-nodejs', bin: 'docker-langserver', args: ['--stdio'] } },
  // ---- used when installed ----
  { id: 'gopls', name: 'Go', extensions: { '.go': 'go' }, commands: [{ command: 'gopls', args: [] }], install: 'Install it with: go install golang.org/x/tools/gopls@latest' },
  { id: 'rust-analyzer', name: 'Rust', extensions: { '.rs': 'rust' }, commands: [{ command: 'rust-analyzer', args: [] }], install: 'Install it with: rustup component add rust-analyzer' },
  { id: 'csharp', name: 'C#', extensions: { '.cs': 'csharp' }, commands: [{ command: 'csharp-ls', args: [] }, { command: 'OmniSharp', args: ['-lsp'] }], install: 'Install it with: dotnet tool install --global csharp-ls' },
  { id: 'php', name: 'PHP', extensions: { '.php': 'php' }, commands: [{ command: 'intelephense', args: ['--stdio'] }], install: 'Install it with: npm install -g intelephense' },
  { id: 'ruby', name: 'Ruby', extensions: { '.rb': 'ruby' }, commands: [{ command: 'solargraph', args: ['stdio'] }, { command: 'ruby-lsp', args: [] }], install: 'Install it with: gem install solargraph' },
  { id: 'lua', name: 'Lua', extensions: { '.lua': 'lua' }, commands: [{ command: 'lua-language-server', args: [] }], install: 'Get it from https://github.com/LuaLS/lua-language-server/releases' },
  { id: 'zls', name: 'Zig', extensions: { '.zig': 'zig' }, commands: [{ command: 'zls', args: [] }], install: 'Get it from https://github.com/zigtools/zls/releases' },
  { id: 'dart', name: 'Dart', extensions: { '.dart': 'dart' }, commands: [{ command: 'dart', args: ['language-server'] }], install: 'Install the Dart SDK: https://dart.dev/get-dart' },
  { id: 'kotlin', name: 'Kotlin', extensions: { '.kt': 'kotlin', '.kts': 'kotlin' }, commands: [{ command: 'kotlin-language-server', args: [] }], install: 'Get it from https://github.com/fwcd/kotlin-language-server/releases' },
  { id: 'haskell', name: 'Haskell', extensions: { '.hs': 'haskell' }, commands: [{ command: 'haskell-language-server-wrapper', args: ['--lsp'] }], install: 'Install it with ghcup: ghcup install hls' },
  { id: 'terraform', name: 'Terraform', extensions: { '.tf': 'terraform', '.tfvars': 'terraform' }, commands: [{ command: 'terraform-ls', args: ['serve'] }], install: 'Get it from https://github.com/hashicorp/terraform-ls/releases' },
  { id: 'toml', name: 'TOML', extensions: { '.toml': 'toml' }, commands: [{ command: 'taplo', args: ['lsp', 'stdio'] }], install: 'Install it with: cargo install taplo-cli --locked --features lsp' },
  { id: 'xml', name: 'XML', extensions: { '.xml': 'xml', '.xsd': 'xml', '.xsl': 'xml' }, commands: [{ command: 'lemminx', args: [] }], install: 'Get it from https://github.com/eclipse/lemminx/releases' },
  { id: 'cmake', name: 'CMake', extensions: { '.cmake': 'cmake' }, names: { 'cmakelists.txt': 'cmake' }, commands: [{ command: 'cmake-language-server', args: [] }], install: 'Install it with: pip install cmake-language-server' },
  { id: 'swift', name: 'Swift', extensions: { '.swift': 'swift' }, commands: [{ command: 'sourcekit-lsp', args: [] }], install: 'It ships with the Swift toolchain: https://www.swift.org/install' },
  { id: 'ocaml', name: 'OCaml', extensions: { '.ml': 'ocaml', '.mli': 'ocaml' }, commands: [{ command: 'ocamllsp', args: [] }], install: 'Install it with: opam install ocaml-lsp-server' },
  { id: 'sqls', name: 'SQL', extensions: { '.sql': 'sql' }, commands: [{ command: 'sqls', args: [] }], install: 'Install it with: go install github.com/sqls-server/sqls@latest' }
]

const ID = /^[a-z0-9][a-z0-9._-]*$/
const EXT = /^\.[a-z0-9][a-z0-9_+-]*$/i

/**
 * Turns the `languageServers` list of settings.json into server definitions. Throws a message saying which entry is wrong and
 * how: a typo here must not silently leave a language without support.
 *
 * An entry looks like { "id": "my-ls", "name": "My Language", "command": "my-ls", "args": ["--stdio"],
 * "extensions": [".my"], "languageId": "my" }.
 */
export function customDefs(raw: unknown, reservedIds: string[]): ServerDef[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('"languageServers" must be a list')
  const seen = new Set<string>()
  return raw.map((item, i): ServerDef => {
    const at = `languageServers[${i}]`
    if (typeof item !== 'object' || item === null) throw new Error(`${at} must be an object`)
    const o = item as Record<string, unknown>
    const id = o['id']
    if (typeof id !== 'string' || !ID.test(id)) throw new Error(`${at}.id must be lowercase letters, digits, "-", "_" or "."`)
    if (reservedIds.includes(id) || seen.has(id)) throw new Error(`${at}.id "${id}" is already used by another language server`)
    seen.add(id)
    const command = o['command']
    if (typeof command !== 'string' || !command.trim()) throw new Error(`${at}.command must be the program to run, such as "zls"`)
    const args = o['args'] ?? []
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new Error(`${at}.args must be a list of strings`)
    const exts = o['extensions']
    if (!Array.isArray(exts) || !exts.length || !exts.every((e) => typeof e === 'string' && EXT.test(e))) {
      throw new Error(`${at}.extensions must be a list of file extensions such as [".zig"]`)
    }
    const languageId = o['languageId'] ?? id
    if (typeof languageId !== 'string' || !languageId) throw new Error(`${at}.languageId must be a string`)
    const name = typeof o['name'] === 'string' && o['name'] ? o['name'] : id
    return {
      id,
      name,
      extensions: Object.fromEntries((exts as string[]).map((e) => [e.toLowerCase(), languageId])),
      commands: [{ command, args: args as string[] }],
      install: `Check the "command" of ${at} in settings.json, and that it is installed`
    }
  })
}
