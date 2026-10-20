import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionsFor, argsFor, composeFileOf, parseContainers, parseImages, stateOf } from '../../src/main/dockerparse'

const PS = [
  JSON.stringify({ ID: 'a1', Names: 'web,web-alias', Image: 'nginx:1', Status: 'Up 3 minutes', State: 'running', Ports: '0.0.0.0:80->80/tcp' }),
  JSON.stringify({ ID: 'b2', Names: 'db', Image: 'postgres', Status: 'Exited (0) 2 hours ago', State: 'exited', Ports: '' }),
  ''
].join('\n')

test('containers: one JSON object per line', () => {
  const c = parseContainers(PS)
  assert.equal(c.length, 2)
  assert.deepEqual(c[0], { id: 'a1', name: 'web', image: 'nginx:1', status: 'Up 3 minutes', state: 'running', ports: '0.0.0.0:80->80/tcp' })
  assert.equal(c[1]?.state, 'exited')
  assert.deepEqual(parseContainers(''), [])
})

test('state falls back to the status text when docker omits it', () => {
  assert.equal(stateOf('', 'Up 5 seconds'), 'running')
  assert.equal(stateOf('', 'Up 5 seconds (Paused)'), 'paused')
  assert.equal(stateOf('', 'Exited (1) a minute ago'), 'exited')
  assert.equal(stateOf('weird', ''), 'other')
})

test('images', () => {
  const i = parseImages(JSON.stringify({ ID: 'sha1', Repository: 'nginx', Tag: '1', Size: '187MB', CreatedSince: '2 weeks ago' }))
  assert.deepEqual(i, [{ id: 'sha1', repository: 'nginx', tag: '1', size: '187MB', created: '2 weeks ago' }])
})

test('garbled output is an error, not an empty list', () => {
  assert.throws(() => parseContainers('Cannot connect to the Docker daemon'), /Unexpected output from docker/)
})

test('actions depend on the state', () => {
  assert.deepEqual(actionsFor('running'), ['stop', 'restart', 'pause', 'remove'])
  assert.deepEqual(actionsFor('paused'), ['unpause', 'stop', 'remove'])
  assert.deepEqual(actionsFor('exited'), ['start', 'remove'])
})

test('arguments: remove forces, ids are validated', () => {
  assert.deepEqual(argsFor('stop', 'web'), ['stop', 'web'])
  assert.deepEqual(argsFor('remove', 'web'), ['rm', '-f', 'web'])
  assert.throws(() => argsFor('stop', '--all'), /Not a container id/)
  assert.throws(() => argsFor('stop', 'a b'), /Not a container id/)
})

test('compose file: the first of docker compose’s own names', () => {
  assert.equal(composeFileOf(['a.txt', 'docker-compose.yml', 'compose.yaml']), 'compose.yaml')
  assert.equal(composeFileOf(['docker-compose.yml']), 'docker-compose.yml')
  assert.equal(composeFileOf(['x']), null)
})
