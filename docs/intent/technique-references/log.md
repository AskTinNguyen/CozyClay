# Technique References: Prompt Log

Append-only. Each user prompt verbatim, with credentials and machine paths redacted.

## L-1 (2026-10-24) | class: intent | -> rev 1

> <local path>
>
> Check this repo of mine, propose anything that you can take from it to improve our CozyClay custom implementation for AI Agentic Cinematic Production

The orchestrator compared the owner's cinematic-atlas repo (a local study site over film-directing books, with page-level camera tags, concepts, scenario quizzes and learning paths) with the camera library (techniques, capabilities, coverage, shot prompt engine) and proposed seven additions. This intent is proposal 7.

## L-2 (2026-10-24) | class: intent | -> rev 1

> Write all seven proposals as planned intents in docs/intent/, ordered as you recommended.

Written as `planned`; the `Waits for` lines carry the recommended order.

Proposal 7 bundled a colour script (Scene and Viewport) and technique references (Camera and Shots); the contract gives each intent one area, so it was written as two intents, `colour-script` and `technique-references`.

## L-3 (2026-10-24) | class: decision | -> rev 2

> https://github.com/AskTinNguyen/CozyClay/pull/8
>
> Spawn Agent Sessions to work on these intents and merge them into main

The owner's go-ahead for the cinematic-atlas plan. A cloud orchestrator session runs workers and merges after proof under the contract's `after-proof` authority.

## L-4 (2026-10-24) | class: decision | -> rev 2

> Acceptable regarding licensing because we are using this tool internally for prototyping and proof of concepts

Resolves F-1 with option (a): citations only, limited to the camera and directing books, with atlas links only when the owner sets its URL.
