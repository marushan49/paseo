---
title: System One with Jev
description: Give every Paseo coding agent a fast typed decision primitive for routing, scoring, and bounded judgments.
nav: System One
order: 34
category: Agents
---

# System One with Jev

Paseo can give Claude Code, Codex, OpenCode, Pi, Copilot, and other supported tool clients the same TypeSafe System One capability. Jev complements the agent's main model. It handles small structured judgments; it does not replace the coding agent or execute work itself.

Enable it under **Settings → your host → System One**. Enter a TypeSafe API key, choose a model such as `jev-latest`, set the confidence threshold, and turn on **Use System One decisions**.

The key is write-only from the app's point of view. Paseo stores it under the host's private data directory in a file readable only by that user. Daemon configuration responses contain only whether a key is configured and where it came from. Paseo can also use `TYPESAFE_API_KEY` or `~/.config/typesafe-ai/env` as a fallback. Paseo checks a new key with TypeSafe before saving it and refuses one that TypeSafe rejects. If a saved key is rejected later, each request falls through to the next configured key.

## What agents receive

Paseo exposes one shared tool, `system_one_decide`, and a short shared instruction that tells agents to use it before spending substantial reasoning on a bounded judgment.

One call contains:

- `state`: the smallest useful structured facts about the current task.
- `questions`: up to 32 independent Choice, Score, or Noul questions that all use that state.

Agents batch every currently useful question into one request. Jev returns typed answers, probabilities, confidence, model, and latency. The agent then decides whether to act, gather more evidence, or escalate to slower reasoning.

Good uses include routing a task, ranking a short candidate set, checking relevance or risk, classifying an observed UI state, and choosing the next action from a closed set. Deterministic facts, multi-step planning, code execution, and final verification stay with ordinary code and the coding agent.

Never place API keys, passwords, tokens, private keys, or other secrets in the state or questions.

## Browser goals

The [`browser_goal` tool](/docs/browser) uses the same System One configuration. Paseo enriches Jev with the current URL, an accessibility summary, recent actions, and allowed value slots. Jev chooses the next bounded action; Paseo executes it locally and requires explicit text or URL checks before reporting success.
