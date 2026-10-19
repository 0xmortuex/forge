// @ts-check
// The Database window: open a SQLite file from the tree, browse it, run SQL, and the read-only guarantee.
const fs = require('node:fs')
const path = require('node:path')
const { clipboard } = require('electron')
const initSqlJs = require('sql.js')
const { run } = require('../harness.cjs')

run('database', { 'notes.txt': 'plain notes\n', 'broken.sqlite': 'this is not a database file at all, just text that is long enough to look plausible\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const dbFile = path.join(root, 'shop.db')

  // ---- a real database file to open ----
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, bio TEXT, avatar BLOB);
    INSERT INTO users VALUES (1, 'Ada', 36, 'likes, commas', x'DEADBEEF');
    INSERT INTO users VALUES (2, 'Grace', 45, NULL, NULL);
    INSERT INTO users VALUES (3, 'Linus', 28, 'kernel', NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200) INSERT INTO orders SELECT i, 1 + i % 3, i * 1.5 FROM n;
    CREATE VIEW adults AS SELECT name FROM users WHERE age >= 30;
  `)
  fs.writeFileSync(dbFile, Buffer.from(db.export()))
  db.close()
  const original = fs.readFileSync(dbFile)

  const gridRows = () => js("document.querySelectorAll('#db-grid tbody tr').length")
  const gridText = () => text('db-grid')
  const clickTable = (/** @type {string} */ name) => js(`document.querySelector('.db-table[data-table=${JSON.stringify(name)}]').click()`)
  const setQuery = async (/** @type {string} */ sql) => {
    await js("document.querySelector('#db-editor textarea').focus(); undefined")
    key('A', ['control'])
    await sleep(150)
    await type(sql)
    await sleep(150)
    key('Enter', ['control'])
  }

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('shop.db'), 5000)
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'shop.db').click()")
  check('opening a .db file shows the Database window', !!(await waitFor(() => js("!document.getElementById('view-db').hidden && document.getElementById('db-title').textContent === 'shop.db'"), 10000)))
  const schema = await text('db-schema')
  check('the schema lists the tables and the view', schema.includes('users') && schema.includes('orders') && schema.includes('adults'), schema)
  check('...with row counts, and "view" for the view', schema.includes('1,200') && schema.includes('view') && /users\s*3/.test(schema), schema)

  // ---- browse ----
  await clickTable('users')
  check('clicking a table previews its rows', !!(await waitFor(async () => (await gridRows()) === 3, 6000)), String(await gridRows()))
  const grid = await gridText()
  check('NULL is shown as NULL, and binary data as a BLOB size', grid.includes('NULL') && grid.includes('‹BLOB 4 B›'), grid)
  check('the preview query is put in the editor', (await js("document.querySelector('#db-editor .view-lines').textContent.replace(/\\u00a0/g, ' ')")).includes('SELECT * FROM "users"'))
  check('the status says how many rows and how long', /3 rows in \d+ ms/.test(await text('db-status')), await text('db-status'))

  // ---- columns in the tree ----
  await js("document.querySelector('.db-table[data-table=\"users\"] .db-chev').click()")
  check('the arrow shows a table\'s columns with types and keys', !!(await waitFor(async () => /id\s*INTEGER\s*PK/.test(await text('db-schema')) && (await text('db-schema')).includes('name'), 3000)), await text('db-schema'))

  // ---- sorting and CSV ----
  const firstName = () => js("document.querySelector('#db-grid tbody tr td:nth-child(3)')?.textContent ?? ''")
  await js("[...document.querySelectorAll('#db-grid th')].find(th => th.textContent.startsWith('name')).click()")
  check('clicking a column header sorts ascending', !!(await waitFor(async () => (await firstName()) === 'Ada', 3000)), await firstName())
  await js("[...document.querySelectorAll('#db-grid th')].find(th => th.textContent.startsWith('name')).click()")
  check('and again descending', !!(await waitFor(async () => (await firstName()) === 'Linus', 3000)), await firstName())
  await js("document.getElementById('db-csv').click()")
  const csv = clipboard.readText()
  check('Copy as CSV puts the result on the clipboard', csv.startsWith('id,name,age,bio,avatar') && csv.includes('Ada,36'), csv.slice(0, 120))
  check('...quoting fields with commas, and writing NULL as empty', csv.includes('"likes, commas"') && csv.includes('2,Grace,45,,'), csv)

  // ---- running SQL ----
  await setQuery('SELECT name FROM users WHERE age > 30 ORDER BY name')
  check('Ctrl+Enter runs what is typed', !!(await waitFor(async () => (await gridRows()) === 2 && (await gridText()).includes('Grace'), 6000)), await gridText())
  await setQuery('SELECT 1 AS a; SELECT 2 AS b')
  check('several statements give a tab for each result', !!(await waitFor(async () => (await js("document.querySelectorAll('#db-tabs .db-tab').length")) === 2, 6000)))
  await js("document.querySelectorAll('#db-tabs .db-tab')[1].click()")
  check('...and the tabs switch between them', !!(await waitFor(async () => (await gridText()).includes('b') && (await gridText()).includes('2'), 3000)))

  // ---- read-only ----
  await setQuery('DELETE FROM users')
  check('a write is refused by SQLite itself', !!(await waitFor(async () => /readonly|read-only/i.test(await text('db-status')), 6000)), await text('db-status'))
  await setQuery('DROP TABLE orders')
  check('so is dropping a table', !!(await waitFor(async () => /readonly|read-only/i.test(await text('db-status')), 6000)), await text('db-status'))
  check('the file on disk is byte-for-byte unchanged', Buffer.compare(fs.readFileSync(dbFile), original) === 0)

  // ---- limits ----
  await clickTable('orders')
  check('a big table shows the first 1,000 rows and says so', !!(await waitFor(async () => (await gridRows()) === 1000 && (await gridText()).includes('Only the first 1,000 rows'), 8000)), String(await gridRows()))
  await js("(() => { const s = document.getElementById('db-limit'); s.value = '100'; s.dispatchEvent(new Event('change')) })()")
  await clickTable('orders')
  check('the row limit can be lowered', !!(await waitFor(async () => (await gridRows()) === 100, 6000)), String(await gridRows()))

  // ---- a runaway query can be stopped, and the window keeps working ----
  await setQuery('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c')
  check('Stop is offered while a query runs', !!(await waitFor(() => js("!document.getElementById('db-stop').hidden"), 4000)))
  await sleep(800)
  await js("document.getElementById('db-stop').click()")
  check('stopping ends it with a message', !!(await waitFor(async () => /stopped/i.test(await text('db-status')), 6000)), await text('db-status'))
  check('and Run is back', !(await js("document.getElementById('db-run').hidden")))
  await setQuery('SELECT COUNT(*) AS n FROM orders')
  check('the database still works afterwards (it is reloaded)', !!(await waitFor(async () => (await gridText()).includes('1200'), 10000)), await gridText())

  // ---- not a database ----
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'broken.sqlite').click()")
  check('a file that is not SQLite gives a clear error', !!(await waitFor(async () => /not a SQLite database/.test((await text('log')) + (await text('db-status'))), 6000)), (await text('log')).slice(-200))
})
