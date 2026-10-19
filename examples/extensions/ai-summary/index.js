// AI Summary: an example of an extension that asks for a permission ("ai" in extension.json) and uses
// forge.ai.complete. It needs Settings > AI to be set up; Forge asks you to approve the server the first time.

export function activate(forge) {
  forge.commands.register({
    id: 'summarize',
    title: 'Summarize Current File',
    run: async () => {
      const text = forge.editor.getText()
      if (text === null) return forge.ui.toast('Open a file first', 'warn')
      forge.ui.toast('Summarizing…')
      const summary = await forge.ai.complete([
        { role: 'system', content: 'Summarize the code in one short paragraph. No preamble.' },
        { role: 'user', content: text.slice(0, 20000) }
      ])
      forge.ui.toast(summary.trim() || '(no summary)', 'ok')
    }
  })
}
