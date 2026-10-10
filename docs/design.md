# LIGHT Bookmark — Design

## Problem

LIGHT can search and load saved Notion pages, but retrieval must bring back enough context to be useful. Search snippets alone can omit surrounding decisions, constraints, and relationships. A separate memory store would duplicate Notion and create another source to maintain.

## Decision

Treat LIGHT Bookmark as a lightweight retrieval/indexing function over Notion. Its job is to help LIGHT find the right source and resume from it—not to hold the source content itself.

### Bookmark shape

A bookmark should contain only what improves retrieval:

- a concise topic or recognition cue;
- a pointer to the canonical Notion page or record;
- the relationship or reason the source is relevant;
- an optional brief orientation summary, clearly non-authoritative.

Do not copy full source content into the bookmark. Do not infer current status from an old bookmark.

### Runtime behavior

- **Trigger:** use retrieval when the request depends on a prior work thread, idea, decision, lesson, or other saved context.
- **Locate:** search Notion using the current topic and relevant cues.
- **Read:** open the selected source and read enough surrounding content to restore meaning and constraints.
- **Verify:** when current status or authority matters, consult the responsible Owner Source. Preserve conflicts and uncertainty.
- **Return:** answer with the source pointer and distinguish saved history from present truth.
- **No hit:** say the saved context was not found; do not invent missing history.

Work identity and lifecycle remain in the Work System. Current operational truth remains with each Owner Source. The bookmark does not change permissions or authority.

## Start with existing tools

The existing Notion search and page-load tools are the first retrieval path. Do not build a separate service merely to wrap the same search/load calls.

## Validation gate before a bridge

Run a fresh-room test using a continuity-dependent prompt whose relevant context is already saved in Notion. Record whether LIGHT:

1. invokes retrieval without being explicitly told to search;
2. finds the relevant pointer rather than an unrelated match;
3. opens and uses the source page, not just the search excerpt;
4. separates historical context from current truth; and
5. reports missing or ambiguous context as UNKNOWN.

A thin, read-only bridge is justified only if this test shows a repeatable gap—such as inconsistent tool availability, poor retrieval precision, or failure to invoke search when context is needed. If built, it should query Notion and return pointers plus concise orientation; it should not become a second store.

## Current unknowns

- Whether the relevant Notion tools are available consistently in newly opened rooms.
- Whether a short personalization instruction reliably triggers retrieval at the right time.
- Whether native search can consistently rank LIGHT-specific context well enough without a curated pointer index.

These are validation questions, not reasons to create additional infrastructure before testing.
