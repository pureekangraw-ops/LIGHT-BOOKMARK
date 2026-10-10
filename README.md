# LIGHT Bookmark 🔖

**Purpose:** Help LIGHT find previously saved context in Notion quickly, then follow the pointer and read the relevant source.

**Status:** Initial design draft. This commit documents the retrieval model; it does not implement a bridge or claim automatic cross-room recall is complete.

## Core model

- **Notion remains the canonical knowledge store.**
- A bookmark is a retrieval cue, pointer, and relationship between relevant sources—not a second copy of the knowledge.
- A short summary may help identify why a source matters, but it is a navigation aid, not evidence or current truth by itself.
- LIGHT retrieves only when the current request benefits from prior context; ordinary conversation does not need a memory lookup.
- Unsaved conversation content cannot be reconstructed from a bookmark.

## Retrieval path

1. Understand the current request and identify the missing continuity context.
2. Search Notion for relevant saved context or bookmark pointers.
3. Treat search results and snippets as candidate locators, not sufficient evidence.
4. Open the relevant Notion source and read the needed context.
5. If the question concerns current operational state, verify against the responsible Owner Source; keep history distinct from current truth.
6. Answer with source references, or state UNKNOWN when the saved source is missing or inconclusive.

## Evidence so far

In the current session, the existing Notion search and page-load tools retrieved and opened a relevant saved LIGHT context page. That confirms on-demand retrieval in this session. It does **not** prove automatic invocation, tool availability, or consistent recall in every new room.

## Non-goals

- Creating a duplicate knowledge store or another GO Brain.
- Treating Notion bookmarks as authority, Work lifecycle, or an Owner Source.
- Recovering content from chats that were never saved.
- Automatically writing or changing Notion pages as part of lookup.

See [design](docs/design.md) for the proposed boundary and validation gate.
