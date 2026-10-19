// "Go to Test": from a source file to its tests and back, by naming convention.
//   foo.ts <-> foo.test.ts, foo.spec.ts      foo.py <-> test_foo.py, foo_test.py
//   Foo.java <-> FooTest.java                foo.go <-> foo_test.go

interface Naming {
  /** The name a file would have without the test marker, or null when it is not a test. */
  stem: string
  isTest: boolean
}

const TEST_PATTERNS: RegExp[] = [
  /^(.+)\.(?:test|spec)\.[^.]+$/, // foo.test.ts, foo.spec.tsx
  /^test_(.+)\.py$/, // test_foo.py
  /^(.+)_test\.(?:py|go|rs|c|cc|cpp)$/, // foo_test.py, foo_test.go
  /^(.+?)(?:Tests?|Spec)\.(?:java|kt|cs|swift|scala)$/ // FooTest.java
]

export function naming(fileName: string): Naming {
  for (const re of TEST_PATTERNS) {
    const m = re.exec(fileName)
    if (m) return { stem: m[1] as string, isTest: true }
  }
  const dot = fileName.lastIndexOf('.')
  return { stem: dot > 0 ? fileName.slice(0, dot) : fileName, isTest: false }
}

const baseName = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)

/** The files that pair with `path` (its tests if it is a source file, its sources if it is a test), nearest folder first. */
export function relatedFiles(path: string, all: string[]): string[] {
  const here = naming(baseName(path))
  const dirOf = (p: string): string => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
  const depth = (p: string): number => {
    // How many leading folders the two paths share: closer files come first.
    const a = dirOf(path).split(/[\\/]/)
    const b = dirOf(p).split(/[\\/]/)
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n
  }
  return all
    .filter((p) => {
      if (p === path) return false
      const other = naming(baseName(p))
      return other.stem === here.stem && other.isTest !== here.isTest
    })
    .sort((x, y) => depth(y) - depth(x) || x.localeCompare(y))
}
