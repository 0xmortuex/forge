# Languages

Forge gets code intelligence (diagnostics, completion, hover, go to definition, rename, formatting, code actions,
document symbols, folding…) from **language servers**. Which languages work depends on the server:

| Language | Server | How you get it |
| --- | --- | --- |
| TypeScript, JavaScript (and JSX/TSX) | `typescript-language-server` | Ships with Forge |
| Python | `pyright` | Ships with Forge |
| YAML | `yaml-language-server` | Ships with Forge |
| Shell (`.sh`, `.bash`, `.zsh`) | `bash-language-server` | Ships with Forge (shellcheck, if installed, adds more checks) |
| Dockerfile | `docker-langserver` | Ships with Forge (chosen by the file name `Dockerfile`/`Containerfile` too) |
| C, C++ | `clangd` | Install LLVM: https://clangd.llvm.org/installation |
| Mort | `mortc lsp` | `pip install mort-lang` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| C# | `csharp-ls` (or `OmniSharp -lsp`) | `dotnet tool install --global csharp-ls` |
| PHP | `intelephense` | `npm install -g intelephense` |
| Ruby | `solargraph` (or `ruby-lsp`) | `gem install solargraph` |
| Lua | `lua-language-server` | https://github.com/LuaLS/lua-language-server/releases |
| Zig | `zls` | https://github.com/zigtools/zls/releases |
| Dart | `dart language-server` | Install the Dart SDK |
| Kotlin | `kotlin-language-server` | https://github.com/fwcd/kotlin-language-server/releases |
| Haskell | `haskell-language-server-wrapper` | `ghcup install hls` |
| Terraform | `terraform-ls` | https://github.com/hashicorp/terraform-ls/releases |
| TOML | `taplo` | `cargo install taplo-cli --locked --features lsp` |
| XML | `lemminx` | https://github.com/eclipse/lemminx/releases |
| CMake | `cmake-language-server` | `pip install cmake-language-server` |
| Swift | `sourcekit-lsp` | Ships with the Swift toolchain |
| OCaml | `ocamllsp` | `opam install ocaml-lsp-server` |
| SQL | `sqls` | `go install github.com/sqls-server/sqls@latest` |

HTML, CSS, SCSS, Less and JSON use the editor's built-in language support (plus Emmet for HTML and CSS).

A server that is not installed is **not an error**. The first time you open a file of that language Forge writes one line in
the Output window saying what is missing and how to install it, and the file is simply edited without a server. Install it
and open a file again (Forge looks again after about 30 seconds), or run *Reload Window*.

Languages Monaco has no highlighting for (Zig, TOML, Haskell, OCaml, CMake) get basic highlighting of comments, strings,
numbers and keywords; the server provides the rest.

## Adding your own language server

Add a `languageServers` list to `settings.json` (Settings → *Open settings.json*). It is read at startup and applied again
whenever you save the file.

```json
{
  "languageServers": [
    {
      "id": "my-ls",
      "name": "My Language",
      "command": "my-language-server",
      "args": ["--stdio"],
      "extensions": [".my"],
      "languageId": "mylang"
    }
  ]
}
```

| Field | |
| --- | --- |
| `id` | Required. Lowercase letters, digits, `-`, `_` or `.`; must not repeat one of the servers above. |
| `command` | Required. A program on your `PATH` (or a full path) that speaks the Language Server Protocol on stdin/stdout. |
| `args` | Optional list of arguments (many servers need `--stdio`). |
| `extensions` | Required. File extensions the server handles, with the dot. |
| `languageId` | Optional. The language id sent to the server; defaults to `id`. |
| `name` | Optional. Used in messages. |

A mistake in an entry is reported in the Output with the entry number and what is wrong, for example
`languageServers[1].command must be the program to run, such as "zls"`. An entry cannot replace one of Forge's own servers
(TypeScript, Python, clangd, Mort, or any in the table above): pick a new id and extension.

The server runs once per project folder, is started when you open the first file it handles, and is stopped when Forge
closes.
