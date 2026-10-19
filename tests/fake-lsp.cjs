// @ts-check
// A tiny language server for tests, speaking real LSP over stdio. For a ".fake" file it reports an error on every line that
// contains FIXME, completes "fake-completion" and answers hover with a fixed text. Run it as: node tests/fake-lsp.cjs

/** @type {Map<string, string>} */
const documents = new Map()
let buffer = Buffer.alloc(0)

const send = (/** @type {object} */ message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

const diagnose = (/** @type {string} */ uri) => {
  const text = documents.get(uri) ?? ''
  const diagnostics = text
    .split('\n')
    .flatMap((line, i) => (line.includes('FIXME') ? [{ range: { start: { line: i, character: line.indexOf('FIXME') }, end: { line: i, character: line.indexOf('FIXME') + 5 } }, severity: 1, source: 'fake', message: 'fake: FIXME must be resolved' }] : []))
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

const handle = (/** @type {any} */ msg) => {
  switch (msg.method) {
    case 'initialize':
      return send({ id: msg.id, result: { capabilities: { textDocumentSync: 1, completionProvider: {}, hoverProvider: true } } })
    case 'textDocument/didOpen':
      documents.set(msg.params.textDocument.uri, msg.params.textDocument.text)
      return diagnose(msg.params.textDocument.uri)
    case 'textDocument/didChange':
      documents.set(msg.params.textDocument.uri, msg.params.contentChanges[msg.params.contentChanges.length - 1].text)
      return diagnose(msg.params.textDocument.uri)
    case 'textDocument/didClose':
      return documents.delete(msg.params.textDocument.uri)
    case 'textDocument/completion':
      return send({ id: msg.id, result: { isIncomplete: false, items: [{ label: 'fake-completion', kind: 1, detail: 'from the fake server' }] } })
    case 'textDocument/hover':
      return send({ id: msg.id, result: { contents: { kind: 'plaintext', value: 'fake hover text' } } })
    case 'shutdown':
      return send({ id: msg.id, result: null })
    case 'exit':
      return process.exit(0)
    default:
      // Requests we do not implement get an empty answer; notifications are ignored.
      if (msg.id !== undefined) send({ id: msg.id, result: null })
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const head = buffer.indexOf('\r\n\r\n')
    if (head < 0) return
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, head).toString())?.[1])
    if (buffer.length < head + 4 + length) return
    const body = buffer.subarray(head + 4, head + 4 + length).toString()
    buffer = buffer.subarray(head + 4 + length)
    handle(JSON.parse(body))
  }
})
