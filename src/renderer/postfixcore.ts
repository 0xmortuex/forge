// Postfix templates: type an expression, a dot and a keyword, and the whole thing is rewritten around the expression:
// `items.for` becomes a for loop over items, `user.log` becomes console.log(user). The logic here is pure text handling;
// postfix.ts connects it to the editor.

export interface PostfixTemplate {
  /** What follows the dot. */
  key: string
  description: string
  /** The snippet, with `$EXPR` where the expression goes. Monaco snippet syntax for tab stops. */
  snippet: string
}

const t = (key: string, description: string, snippet: string): PostfixTemplate => ({ key, description, snippet })

const JS: PostfixTemplate[] = [
  t('log', 'console.log(expr)', 'console.log($EXPR)'),
  t('if', 'if (expr) { }', 'if ($EXPR) {\n\t$0\n}'),
  t('else', 'if (!expr) { }', 'if (!$EXPR) {\n\t$0\n}'),
  t('null', 'if (expr == null) { }', 'if ($EXPR == null) {\n\t$0\n}'),
  t('nn', 'if (expr != null) { }', 'if ($EXPR != null) {\n\t$0\n}'),
  t('not', '!expr', '!$EXPR'),
  t('par', '(expr)', '($EXPR)'),
  t('for', 'for (const item of expr)', 'for (const ${1:item} of $EXPR) {\n\t$0\n}'),
  t('fori', 'for (let i = 0; i < expr.length; i++)', 'for (let ${1:i} = 0; ${1:i} < $EXPR.length; ${1:i}++) {\n\t$0\n}'),
  t('foreach', 'expr.forEach(item => { })', '$EXPR.forEach((${1:item}) => {\n\t$0\n})'),
  t('map', 'expr.map(item => )', '$EXPR.map((${1:item}) => $0)'),
  t('return', 'return expr', 'return $EXPR'),
  t('const', 'const name = expr', 'const ${1:name} = $EXPR'),
  t('let', 'let name = expr', 'let ${1:name} = $EXPR'),
  t('await', 'await expr', 'await $EXPR'),
  t('new', 'new expr()', 'new $EXPR($0)'),
  t('throw', 'throw expr', 'throw $EXPR'),
  t('typeof', 'typeof expr', 'typeof $EXPR'),
  t('json', 'JSON.stringify(expr)', 'JSON.stringify($EXPR)'),
  t('try', 'try { expr } catch', 'try {\n\t$EXPR\n} catch (${1:error}) {\n\t$0\n}')
]

const PY: PostfixTemplate[] = [
  t('print', 'print(expr)', 'print($EXPR)'),
  t('if', 'if expr:', 'if $EXPR:\n\t$0'),
  t('else', 'if not expr:', 'if not $EXPR:\n\t$0'),
  t('none', 'if expr is None:', 'if $EXPR is None:\n\t$0'),
  t('nn', 'if expr is not None:', 'if $EXPR is not None:\n\t$0'),
  t('not', 'not expr', 'not $EXPR'),
  t('par', '(expr)', '($EXPR)'),
  t('for', 'for item in expr:', 'for ${1:item} in $EXPR:\n\t$0'),
  t('enumerate', 'for i, item in enumerate(expr):', 'for ${1:i}, ${2:item} in enumerate($EXPR):\n\t$0'),
  t('len', 'len(expr)', 'len($EXPR)'),
  t('str', 'str(expr)', 'str($EXPR)'),
  t('list', 'list(expr)', 'list($EXPR)'),
  t('return', 'return expr', 'return $EXPR'),
  t('var', 'name = expr', '${1:name} = $EXPR'),
  t('with', 'with expr as name:', 'with $EXPR as ${1:name}:\n\t$0'),
  t('await', 'await expr', 'await $EXPR'),
  t('raise', 'raise expr', 'raise $EXPR')
]

const JAVA: PostfixTemplate[] = [
  t('sout', 'System.out.println(expr)', 'System.out.println($EXPR);'),
  t('if', 'if (expr) { }', 'if ($EXPR) {\n\t$0\n}'),
  t('else', 'if (!expr) { }', 'if (!$EXPR) {\n\t$0\n}'),
  t('null', 'if (expr == null) { }', 'if ($EXPR == null) {\n\t$0\n}'),
  t('nn', 'if (expr != null) { }', 'if ($EXPR != null) {\n\t$0\n}'),
  t('not', '!expr', '!$EXPR'),
  t('for', 'for (var item : expr)', 'for (var ${1:item} : $EXPR) {\n\t$0\n}'),
  t('return', 'return expr;', 'return $EXPR;'),
  t('var', 'var name = expr;', 'var ${1:name} = $EXPR;'),
  t('new', 'new expr()', 'new $EXPR($0)'),
  t('throw', 'throw expr;', 'throw $EXPR;')
]

const CSHARP: PostfixTemplate[] = [
  t('cw', 'Console.WriteLine(expr)', 'Console.WriteLine($EXPR);'),
  t('if', 'if (expr) { }', 'if ($EXPR)\n{\n\t$0\n}'),
  t('else', 'if (!expr) { }', 'if (!$EXPR)\n{\n\t$0\n}'),
  t('null', 'if (expr == null) { }', 'if ($EXPR == null)\n{\n\t$0\n}'),
  t('nn', 'if (expr != null) { }', 'if ($EXPR != null)\n{\n\t$0\n}'),
  t('not', '!expr', '!$EXPR'),
  t('foreach', 'foreach (var item in expr)', 'foreach (var ${1:item} in $EXPR)\n{\n\t$0\n}'),
  t('return', 'return expr;', 'return $EXPR;'),
  t('var', 'var name = expr;', 'var ${1:name} = $EXPR;'),
  t('await', 'await expr', 'await $EXPR'),
  t('throw', 'throw expr;', 'throw $EXPR;')
]

const GO: PostfixTemplate[] = [
  t('print', 'fmt.Println(expr)', 'fmt.Println($EXPR)'),
  t('if', 'if expr { }', 'if $EXPR {\n\t$0\n}'),
  t('else', 'if !expr { }', 'if !$EXPR {\n\t$0\n}'),
  t('nil', 'if expr == nil { }', 'if $EXPR == nil {\n\t$0\n}'),
  t('nn', 'if expr != nil { }', 'if $EXPR != nil {\n\t$0\n}'),
  t('not', '!expr', '!$EXPR'),
  t('for', 'for _, item := range expr', 'for ${1:_}, ${2:item} := range $EXPR {\n\t$0\n}'),
  t('return', 'return expr', 'return $EXPR'),
  t('var', 'name := expr', '${1:name} := $EXPR'),
  t('len', 'len(expr)', 'len($EXPR)')
]

const RUST: PostfixTemplate[] = [
  t('println', 'println!("{:?}", expr)', 'println!("{:?}", $EXPR);'),
  t('if', 'if expr { }', 'if $EXPR {\n\t$0\n}'),
  t('else', 'if !expr { }', 'if !$EXPR {\n\t$0\n}'),
  t('not', '!expr', '!$EXPR'),
  t('for', 'for item in expr', 'for ${1:item} in $EXPR {\n\t$0\n}'),
  t('match', 'match expr { }', 'match $EXPR {\n\t${1:_} => $0,\n}'),
  t('let', 'let name = expr;', 'let ${1:name} = $EXPR;'),
  t('return', 'return expr;', 'return $EXPR;'),
  t('ref', '&expr', '&$EXPR'),
  t('some', 'Some(expr)', 'Some($EXPR)'),
  t('ok', 'Ok(expr)', 'Ok($EXPR)')
]

const BY_LANGUAGE: Record<string, PostfixTemplate[]> = {
  typescript: JS,
  javascript: JS,
  python: PY,
  java: JAVA,
  kotlin: JAVA.filter((x) => x.key !== 'sout' && x.key !== 'new'),
  csharp: CSHARP,
  go: GO,
  rust: RUST
}

/** The languages that have postfix templates. */
export const POSTFIX_LANGUAGES = Object.keys(BY_LANGUAGE)

export interface PostfixMatch {
  /** 0-based columns: the expression starts at `start`; `end` is the cursor (after the typed keyword). */
  start: number
  end: number
  /** The expression, as typed. */
  expression: string
  key: string
  description: string
  /** Ready to insert as a Monaco snippet. */
  snippet: string
}

/** Where the expression that ends just before `dot` starts: identifiers, member access, calls, indexing, strings. */
export function expressionStart(line: string, dot: number): number {
  let i = dot
  while (i > 0) {
    const ch = line[i - 1] as string
    if (/[\w$]/.test(ch) || ch === '.') {
      i--
    } else if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '['
      let depth = 0
      let j = i - 1
      for (; j >= 0; j--) {
        const c = line[j] as string
        if (c === ch) depth++
        else if (c === open && --depth === 0) break
      }
      if (j < 0) return i // unbalanced: the expression starts after this bracket
      i = j
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const open = line.lastIndexOf(ch, i - 2)
      if (open < 0) return i
      i = open
    } else break
  }
  return i
}

/** Escapes what is not meant as snippet syntax inside the user's expression. */
const escapeSnippet = (text: string): string => text.replace(/[\\$}]/g, '\\$&')

/**
 * The postfix templates that apply at `column` (0-based) of `line`, for the keyword typed after the dot so far. The
 * result replaces the expression, the dot and the keyword.
 */
export function postfixAt(language: string, line: string, column: number): PostfixMatch[] {
  const templates = BY_LANGUAGE[language]
  if (!templates) return []
  const before = line.slice(0, column)
  const m = /\.(\w*)$/.exec(before)
  if (!m) return []
  const typed = m[1] as string
  const dot = m.index
  const start = expressionStart(before, dot)
  const expression = before.slice(start, dot)
  if (!expression || /^\d+(\.\d+)?$/.test(expression)) return [] // "1." and "3.5." are numbers, not receivers
  return templates
    .filter((x) => x.key.startsWith(typed))
    .map((x) => ({
      start,
      end: column,
      expression,
      key: x.key,
      description: x.description,
      snippet: x.snippet.split('$EXPR').join(escapeSnippet(expression))
    }))
}
