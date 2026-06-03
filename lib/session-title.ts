// Derive a human-readable session NAME for display everywhere in the UI.
//
// Owner feedback: "For each session I want to see the session NAME, not just
// the folder it is in." So we never show the project folder or a raw hex id;
// instead we prefer an explicit slug, then a cleaned-up first prompt, then a
// short id-based fallback.

interface TitleSource {
  slug_name?: string
  first_prompt?: string
  session_id: string
}

// Leading filler / greetings to strip from a derived first-prompt title.
const FILLER_PREFIXES = [
  'hi there',
  'hey there',
  'hello there',
  'hi claude',
  'hey claude',
  'hello claude',
  'hi',
  'hey',
  'hello',
  'yo',
  'ok',
  'okay',
  'so',
  'well',
  'um',
  'uh',
  'please',
  'pls',
  'thanks',
  'thank you',
  'good morning',
  'good afternoon',
  'good evening',
]

function titleCaseSlug(slug: string): string {
  const cleaned = slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned
    .split(' ')
    .map((word) => {
      if (!word) return word
      // Leave words that are already mixed/upper case (acronyms, camelCase) alone.
      if (/[A-Z]/.test(word.slice(1)) || word === word.toUpperCase()) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

// Strip a leading "hi i'm rohan", "hey claude," etc. — repeatedly, since a
// prompt may stack several greetings ("hi, ok so ...").
function stripLeadingFiller(text: string): string {
  let out = text.trim()
  let changed = true
  while (changed) {
    changed = false
    const lower = out.toLowerCase()
    for (const filler of FILLER_PREFIXES) {
      // Match the filler word/phrase as a prefix when followed by a word
      // boundary (punctuation, space, or end).
      if (lower === filler) {
        out = ''
        changed = true
        break
      }
      if (lower.startsWith(filler) && /[\s,.!:;-]/.test(lower.charAt(filler.length))) {
        out = out.slice(filler.length).replace(/^[\s,.!:;-]+/, '')
        changed = true
        break
      }
    }
    // "i'm rohan" / "i am rohan" style self-introductions after a greeting.
    const introMatch = out.match(/^(i['’]?m|i am|my name is|this is)\s+\S+[\s,.!:;-]+/i)
    if (introMatch) {
      out = out.slice(introMatch[0].length)
      changed = true
    }
  }
  return out.trim()
}

// Drop a leading file path or path-like token (./src/x, /Users/..., a/b/c.ts).
function stripLeadingPath(text: string): string {
  return text
    .replace(/^(?:in\s+|at\s+|the\s+)?(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\s*[:,-]?\s*/i, '')
    .trim()
}

// Claude Hub's own recall/memory prompts (and Claude Code continuation summaries)
// sometimes appear as a session's first user message. They make terrible titles
// ("User's last message: …", "Excerpts from past sessions: …"). Treat as no
// usable prompt so we fall through to the id-based fallback.
function isScaffoldingPrompt(text: string): boolean {
  const s = text.trimStart().toLowerCase()
  return (
    s.startsWith("user's last message") ||
    s.startsWith('excerpts from past sessions') ||
    s.startsWith('numbered excerpts') ||
    s.startsWith('projects:') ||
    s.startsWith('project:') ||
    s.startsWith('first prompt:') ||
    s.startsWith('this session is being continued') ||
    s.startsWith('caveat:')
  )
}

function deriveFromFirstPrompt(firstPrompt: string): string {
  if (isScaffoldingPrompt(firstPrompt)) return ''
  // Normalize: strip markdown code fences/backticks/markup noise, collapse ws.
  let text = firstPrompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`+/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  text = stripLeadingFiller(text)
  text = stripLeadingPath(text)
  text = stripLeadingFiller(text)

  if (!text) return ''

  // First meaningful sentence / clause.
  const sentenceMatch = text.match(/^[^.!?\n]+/)
  let clause = (sentenceMatch ? sentenceMatch[0] : text).trim()

  // If the first clause is very short (e.g. "test"), keep it; otherwise cap.
  if (clause.length > 60) {
    // Try to cut at a clause break (comma) before hard-truncating.
    const commaCut = clause.slice(0, 60).lastIndexOf(',')
    if (commaCut > 24) {
      clause = clause.slice(0, commaCut)
    } else {
      const spaceCut = clause.slice(0, 60).lastIndexOf(' ')
      clause = clause.slice(0, spaceCut > 24 ? spaceCut : 60).trimEnd() + '…'
    }
  }

  return clause.trim()
}

/**
 * A human session NAME, in priority order:
 *  (a) prettified `slug_name` if present
 *  (b) a concise title derived from `first_prompt`
 *  (c) 'Session ' + first 8 chars of the id
 * Never returns an empty string.
 */
export function sessionTitle(s: TitleSource): string {
  if (s.slug_name && s.slug_name.trim()) {
    const pretty = titleCaseSlug(s.slug_name)
    if (pretty) return pretty
  }

  if (s.first_prompt && s.first_prompt.trim()) {
    const derived = deriveFromFirstPrompt(s.first_prompt)
    if (derived) return derived
  }

  return 'Session ' + (s.session_id || '').slice(0, 8)
}

/** Capped variant of {@link sessionTitle}, truncating to `n` chars with an ellipsis. */
export function sessionTitleShort(s: TitleSource, n = 40): string {
  const full = sessionTitle(s)
  if (full.length <= n) return full
  const slice = full.slice(0, n).trimEnd()
  // Avoid cutting mid-word when there's a reasonable space to break on.
  const spaceCut = slice.lastIndexOf(' ')
  const base = spaceCut > Math.floor(n * 0.6) ? slice.slice(0, spaceCut) : slice
  return base.trimEnd() + '…'
}
