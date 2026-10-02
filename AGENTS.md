# AGENTS.md — Rules for the AI Agent working on Safe-Drop

Read `idea.md` fully before writing any code. It is the single source of truth.

## Rules

- Follow `idea.md` exactly. If something is ambiguous or you want to deviate, ask first.
- Use only the stack in Section 6. Do not add databases, auth providers, or SaaS.
- Prefer built-in Web APIs. Justify every new dependency in the PR description.
- TypeScript on the server, React on the client, no CSS libraries.
- Never log codes, tokens, filenames, or file contents.
- Never store raw tokens. Never put codes or filenames in R2 keys.
- Write tests alongside each phase. Do not move to the next phase with failing tests.
- Keep Worker code CPU-light (the free plan allows about 10 ms CPU per request). No heavy processing on the server.
- Keep the code small, commented, and readable. The project owner will maintain it alone.
- Review security-critical code (RoomDO, cookie auth, file validation) especially carefully and explain it in comments.
- Codes must be 6 digits (not 4). The Stitch UI shows 4 boxes — they have already been corrected to 6.
