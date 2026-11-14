/**
 * Robust JSON extraction for model output. Free and local models often wrap JSON in
 * markdown fences, prepend prose, or emit `<think>…</think>` reasoning before the answer.
 */

export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

export function extractJson(text: string): unknown {
  const cleaned = stripReasoning(text);

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], cleaned];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to brace slicing
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // try next candidate
      }
    }
  }
  throw new SyntaxError('No JSON object found in model output');
}
