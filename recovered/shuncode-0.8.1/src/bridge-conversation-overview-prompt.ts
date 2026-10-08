/** Sent with MCP initialize; guidance applies per conversation, not per connection. */
export const BRIDGE_CONVERSATION_OVERVIEW_PROMPT = `Conversation overview (Chat and Bridge, per conversation):
- Once per conversation, use the actual model if known, otherwise the AI provider. Never infer from the client, tools, URL or user goal; do not ask the user or look it up. This names the conversation overview, not the task card.
- Generate one random UUID v4 per conversation; send it as overview_session_id on task updates. A shared MCP connection can serve distinct conversations. If no stable ID is available, omit it; never merge tasks by connection, owner or client.
- On the first update send overview_model if known, else overview_provider; otherwise omit both. Bridge identity is unverified self-report, never authorization proof.
- Same-ID cards inherit the first accepted overview title; no ID means no cross-task inheritance. The user's manual title wins; clearing it restores the suggestion/fallback. Local Chat uses its selected model and conversation hint.`;
