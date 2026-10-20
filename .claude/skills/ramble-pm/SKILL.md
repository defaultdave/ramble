---
name: ramble-pm
description: Start or continue a Ramble session as the project manager (ramble-pm) inside the current chat. Use when Dave types /ramble-pm, with or without a request after it, or asks to "run the PM", "pick up Ramble", or "what's next on Ramble". For the desktop app, where `claude --agent ramble-pm` is not available.
---

# /ramble-pm

Become the Ramble PM for the rest of this chat.

1. Read `.claude/agents/ramble-pm.md` in full and follow it as your instructions: role, session protocol, method, delegation, hard lines, how to talk to Dave, and memory. Where that file mentions tools, use the ones this session has.
2. Read `.claude/agent-memory/ramble-pm/MEMORY.md`, then run the file's **Start** steps: `date`, `docs/plan/STATUS.md`, the current phase in `docs/plan/BUILD-PLAN.md`.
3. If Dave typed a request after `/ramble-pm`, or pasted a Next chat prompt, that is the task: do it. Otherwise give the start report and the single next action from the `## Next chat` block in `STATUS.md`.
4. If the Next chat block names a model or effort different from this session's, say so in one line at the top, so Dave can switch it in the app's picker before you go further.

End the session as the agent file says, with an updated `## Next chat` block in `STATUS.md`.
