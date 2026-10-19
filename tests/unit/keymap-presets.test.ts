import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { KEYMAP_PRESETS, PRESETS } from '../../src/renderer/keymap-presets'

// Every command id that exists, read from where the commands are registered.
const registered = new Set([...readFileSync(join(__dirname, '../../src/renderer/builtin-commands.ts'), 'utf8').matchAll(/register\(\{ id: '([\w.]+)'/g)].map((m) => m[1] as string))

// Keys Forge itself owns in every window: a preset must not take them (see the F-key handler in main.ts).
const OWNED = new Set(['F9', 'Shift+F9', 'F8', 'Shift+F8', 'F7', 'F11', 'Shift+F11', 'Ctrl+F11', 'Shift+F10', 'F1', 'Ctrl+F2'])

test('there is a preset for every entry in the list, and the other way round', () => {
  assert.deepEqual(KEYMAP_PRESETS.map(([id]) => id).sort(), Object.keys(PRESETS).sort())
})

test('every preset names only commands that exist', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const id of Object.keys(preset)) assert.ok(registered.has(id), `${name}: no command "${id}"`)
  }
})

test('no preset gives two commands the same shortcut', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const seen = new Map<string, string>()
    for (const [id, keys] of Object.entries(preset)) {
      assert.ok(!seen.has(keys), `${name}: ${keys} is used by both ${seen.get(keys)} and ${id}`)
      seen.set(keys, id)
    }
  }
})

test('shortcuts are written in the form Forge understands', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const [id, keys] of Object.entries(preset)) {
      assert.match(keys, /^((Ctrl|Alt|Shift|Win|Cmd)\+)*([A-Z0-9]|F\d{1,2}|[-,.;/\[\]=`'\\]|Up|Down|Left|Right|Enter|Tab|Space|Home|End|PageUp|PageDown|Delete|Insert|Backspace)$/, `${name}: ${id} = "${keys}"`)
    }
  }
})

test('presets do not take the keys Forge keeps for debugging and full screen', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const [id, keys] of Object.entries(preset)) assert.ok(!OWNED.has(keys), `${name}: ${id} wants ${keys}, which Forge owns`)
  }
})
