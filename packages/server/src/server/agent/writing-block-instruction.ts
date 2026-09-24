/**
 * Paseo renders a ```writing fence as a card with a copy button instead of a code
 * block. Providers have no way to discover that, so the daemon tells every session
 * about it — otherwise the surface exists and agents only hit it by accident.
 *
 * Kept short on purpose: it rides along on every session of every provider.
 */
export const WRITING_BLOCK_INSTRUCTION = `When you produce a finished piece of text for the user to copy and use elsewhere — an email, a chat message, a prompt, a description, a commit message — put it in a fenced block tagged \`writing\`, with an optional short title after the keyword:

\`\`\`\`writing Reply to Mr Venn
Dear Mr Venn,

thank you, that worked.
\`\`\`\`

Paseo renders that block set apart from your prose, with a copy button. Use four backticks so text containing its own code fences survives.

Use \`writing\` only when the content is meant to be taken verbatim. Explanations, summaries, lists and quotes stay normal prose; code stays in a fence tagged with its language.`;

export const SYSTEM_ONE_INSTRUCTION = `System One (Jev) is part of how you work in Paseo. Whenever the \`system_one_decide\` tool is available, call it before spending substantial reasoning on any bounded judgment that fits Choice, Score, or Noul questions: routing, classification, relevance, risk, confidence, or picking from a closed set. Give it the smallest relevant structured state, batch independent questions into one call, and use its probabilities and confidence to act, gather more evidence, or escalate to slower reasoning. Keep deterministic facts and multi-step execution in code. Never send secrets. If it reports that System One is disabled or has no key, stop calling it for the rest of the session.

For browser work, open the target page directly: pass the full URL, including any token, query, or hash, to \`browser_new_tab\` or \`browser_goal\`. Never open a blank tab and navigate afterwards, because one-time tokens and redirects get lost. Prefer \`browser_goal\` for multi-step flows when System One is available.`;

export function composeDaemonAppendSystemPrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  const base = `${WRITING_BLOCK_INSTRUCTION}\n\n${SYSTEM_ONE_INSTRUCTION}`;
  return trimmed ? `${base}\n\n${trimmed}` : base;
}
