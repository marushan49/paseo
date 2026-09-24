# Writing blocks

A writing block is text the agent wrote for you to take somewhere else — an email, a chat message, a prompt, a description. Paseo renders it as a card with a copy button, so it reads apart from the agent's prose instead of dissolving into it.

## The convention

An agent marks it with a fence tagged `writing`, optionally followed by a title:

````markdown
I'd make the message friendlier:

```writing Reply to Mr Venn
Dear Mr Venn,

thank you, that worked.
```

That reads less demanding.
````

The title is the rest of the info line verbatim, so `Re: Angebot (final)` works. Everything before and after the fence stays normal prose.

Four backticks when the content has its own code fences. Three is fine otherwise.

## Why a fence

A fence is the one markdown construct every model gets right, and markdown-it already tokenises it — including the unterminated fence mid-stream, so the card is there from the first character instead of appearing when the turn ends.

It also degrades well. A surface that doesn't know `writing` — GitHub, the CLI, an older Paseo app — shows a code block: wrong font, right content, still copyable. Nothing is lost, which is why this needed no protocol change.

## Where it lives

- `packages/app/src/components/markdown/fence/index.tsx` dispatches the fence. `writing` is checked before the language table, because a title is not a language name.
- `packages/app/src/components/markdown/writing/` owns the card.
- `packages/server/src/server/agent/writing-block-instruction.ts` holds the instruction the daemon appends to every session, ahead of the operator's own `appendSystemPrompt`. Providers can't discover a host convention on their own, so all five are told.

The body is rendered verbatim, not re-parsed as markdown. `**fett**` in a WhatsApp draft has to paste as asterisks, and what you see has to be what the copy button gives you.

## The line that keeps it useful

`writing` is only for content meant to be taken verbatim. Explanations, summaries, lists and quotes stay prose; code stays in a fence tagged with its language. Without that line every second answer turns into a card and the distinction stops carrying information.
