const importSpecifierRe = () => /(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g

/** Character ranges of *source* that are code — string, template-literal and
 *  comment text excluded (template `${…}` interpolations ARE code). The
 *  specifier regex is not syntax-aware, so this is what keeps a plugin's own
 *  copy and comments — `const label = 'Copy keys from'`, `// import 'x'` —
 *  from being read as import syntax (rejected as "unsupported import") or
 *  rewritten in place (a mapped specifier inside a string must stay verbatim).
 *  Regex literals are excluded too: a quote or backtick inside a pattern
 *  (#120208) must not open a string/template state. */

/** Keywords after which a `/` opens a regex literal, never a division. */
const regexKeywordRe = /^(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$/

/** True when the `/` at `slash` (already known not to start `//` or `/*`)
 *  opens a regex literal: the previous significant char cannot end a value.
 *  Standard division-vs-regex heuristic. */
function isRegexStart(source: string, slash: number): boolean {
  let j = slash - 1

  while (j >= 0 && /\s/.test(source[j])) {
    j -= 1
  }

  if (j < 0) {
    return true
  }

  const prev = source[j]

  // Postfix `++`/`--` ends a value (division); a lone `+`/`-` cannot.
  if (prev === '+' || prev === '-') {
    return source[j - 1] !== prev
  }

  // Identifier, number, string/template end, `)` or `]` end a value.
  if (prev === ')' || prev === ']' || prev === "'" || prev === '"' || prev === '`') {
    return false
  }

  // Block-end `}` resolves toward regex — `} /re/` (statement-start
  // pattern) is real code, `} / 2` (dividing a block) is not. Revisit if a
  // plugin ever divides a block result.
  if (prev === '}') {
    return true
  }

  if (/[A-Za-z0-9_$]/.test(prev)) {
    let k = j

    while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) {
      k -= 1
    }

    // `x.return / 2` divides a property, it is not `return /re/`.
    if (source[k] === '.') {
      return false
    }

    return regexKeywordRe.test(source.slice(k + 1, j + 1))
  }

  return true
}

/** End offset (exclusive) of the regex literal opened at `slash`, or -1 when
 *  the pattern never closes on this line (so the `/` was a division).
 *  Escapes and `[...]` classes are honored so a quote or backtick inside the
 *  pattern (#120208) cannot leak into the surrounding lex. */
function regexEnd(source: string, slash: number): number {
  let j = slash + 1
  let inClass = false

  while (j < source.length) {
    const c = source[j]

    if (c === '\\') {
      j += 2
    } else if (c === '\n') {
      return -1
    } else if (c === '[') {
      inClass = true
      j += 1
    } else if (c === ']') {
      inClass = false
      j += 1
    } else if (c === '/' && !inClass) {
      j += 1

      while (j < source.length && /[A-Za-z]/.test(source[j])) {
        j += 1
      }

      return j
    } else {
      j += 1
    }
  }

  return -1
}

function codeRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const stack: Array<'expr' | 'template'> = []
  let state: 'block-comment' | 'code' | 'double' | 'line-comment' | 'single' | 'template' = 'code'
  let codeStart = 0
  let i = 0

  const closeCode = (end: number) => {
    if (end > codeStart) {
      ranges.push([codeStart, end])
    }
  }

  while (i < source.length) {
    const ch = source[i]
    const next = i + 1 < source.length ? source[i + 1] : ''

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        closeCode(i)
        state = 'line-comment'
        i += 2
      } else if (ch === '/' && next === '*') {
        closeCode(i)
        state = 'block-comment'
        i += 2
      } else if (ch === "'") {
        closeCode(i)
        state = 'single'
        i += 1
      } else if (ch === '"') {
        closeCode(i)
        state = 'double'
        i += 1
      } else if (ch === '`') {
        closeCode(i)
        stack.push('template')
        state = 'template'
        i += 1
      } else if (ch === '/') {
        // A lone `/` (not `//` or `/*`, handled above) opens a regex literal
        // when the previous significant token cannot end a value (#120208).
        // Otherwise it is a division and stays plain code.
        const end = isRegexStart(source, i) ? regexEnd(source, i) : -1

        if (end > 0) {
          // The pattern is not code: import-looking text inside it must
          // neither match nor be rewritten in place.
          closeCode(i)
          i = end
          codeStart = i
        } else {
          i += 1
        }
      } else if (ch === '}' && stack[stack.length - 1] === 'expr') {
        closeCode(i)
        stack.pop()
        state = 'template'
        i += 1
      } else {
        i += 1
      }

      continue
    }

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = 'code'
        codeStart = i
      }

      i += 1

      continue
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        i += 2
        state = 'code'
        codeStart = i
      } else {
        i += 1
      }

      continue
    }

    if (state === 'single' || state === 'double') {
      if (ch === '\\') {
        i += 2
      } else if (ch === (state === 'single' ? "'" : '"')) {
        i += 1
        state = 'code'
        codeStart = i
      } else if (ch === '\n') {
        // Unterminated literal — recover as code so one stray quote cannot
        // swallow the rest of the file.
        i += 1
        state = 'code'
        codeStart = i
      } else {
        i += 1
      }

      continue
    }

    // Template-literal text.
    if (ch === '\\') {
      i += 2
    } else if (ch === '$' && next === '{') {
      stack.push('expr')
      state = 'code'
      i += 2
      codeStart = i
    } else if (ch === '`') {
      stack.pop()
      state = 'code'
      i += 1
      codeStart = i
    } else {
      i += 1
    }
  }

  closeCode(source.length)

  return ranges
}

/** True when *at* sits inside a code range (ordered, non-overlapping). */
function inCode(ranges: Array<[number, number]>, at: number): boolean {
  for (const [start, end] of ranges) {
    if (at < start) {
      return false
    }

    if (at < end) {
      return true
    }
  }

  return false

}

/** Derived from Hermes Desktop runtime-loader.ts, MIT licensed. */
export function rewriteImports(source: string, map: Readonly<Record<string, string>>): string {
  const ranges = codeRanges(source)
  const unsupported = new Set<string>()
  const rewritten = source.replace(importSpecifierRe(), (whole, pre: string, quote: string, spec: string, offset: number) => {
    if (!inCode(ranges, offset)) return whole
    if (!Object.hasOwn(map, spec)) { unsupported.add(spec); return whole }
    return `${pre}${quote}${map[spec]}${quote}`
  })
  if (unsupported.size) throw new Error(`unsupported imports: ${[...unsupported].join(', ')} — runtime plugins may only import @hermes/plugin-sdk and react`)
  return rewritten
}
