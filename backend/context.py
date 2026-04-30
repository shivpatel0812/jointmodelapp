"""
Context / memory helpers for prompt assembly.

Design note
-----------
Firestore data lives client-side (the frontend uses the Firebase web SDK). Rather
than pulling in firebase-admin + a service-account key on the server, the frontend
*retrieves* recent messages + summaries from Firestore and forwards them as a
``ContextBlock`` in each API request. This module owns the *formatting* layer so
every endpoint (compare / synthesize / pipeline / summarize) injects context
identically.

When/if we migrate to server-side Firestore reads, ``build_context_for_prompt``
below is the single seam to swap in. Today it's a pure function over an already-
fetched ``ContextBlock``; tomorrow it can do its own fetch.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Hard caps so the context block never blows past a model's input window or
# starts dominating the user's actual prompt.
_MAX_RECENT_MESSAGES = 12
_MAX_MESSAGE_CHARS = 1_200
_MAX_SUMMARY_CHARS = 1_400
_MAX_DECISIONS = 8
_MAX_OPEN_QUESTIONS = 6
_MAX_PREFERENCES_CHARS = 600

# Branch-context caps. Pipeline trace summary can be moderately long because
# it already comes pre-summarized from the client.
_MAX_BRANCH_FIELD_CHARS = 6_000
_MAX_BRANCH_SIBLING_CHARS = 1_500
_MAX_BRANCH_SIBLINGS = 5
_MAX_BRANCH_PIPELINE_CHARS = 1_800


class ContextMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=20_000)
    model_id: str | None = Field(default=None, max_length=256)


class BranchSiblingResponse(BaseModel):
    # Disable Pydantic's "model_" protected namespace so we can keep the wire
    # field names symmetric with the frontend (model_label / model_id).
    model_config = ConfigDict(protected_namespaces=())

    model_label: str = Field(..., max_length=240)
    response: str = Field(..., max_length=20_000)


class BranchContextBlock(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    """Compact slice describing the parent run a branch chat was forked from.

    Sent only when the active chat is a branch chat. Backend formats it into a
    BRANCH CONTEXT section in front of the regular prompt prefix so models can
    see what response is being continued.
    """

    source_model_label: str = Field(..., max_length=240)
    source_model_id: str = Field(..., max_length=240)
    source_chat_id: str = Field(..., max_length=240)
    parent_chat_summary: str | None = Field(default=None, max_length=8_000)
    original_prompt: str = Field(..., max_length=20_000)
    selected_response: str = Field(..., max_length=20_000)
    sibling_responses: list[BranchSiblingResponse] | None = Field(
        default=None, max_length=12
    )
    judge_summary: str | None = Field(default=None, max_length=8_000)
    final_synthesis: str | None = Field(default=None, max_length=20_000)
    pipeline_trace_summary: str | None = Field(default=None, max_length=8_000)


class ContextBlock(BaseModel):
    """Compact, already-truncated memory snapshot the frontend forwards per request."""

    project_title: str | None = Field(default=None, max_length=240)
    project_summary: str | None = Field(default=None, max_length=8_000)
    chat_summary: str | None = Field(default=None, max_length=8_000)
    recent_messages: list[ContextMessage] = Field(default_factory=list, max_length=24)
    project_decisions: list[str] = Field(default_factory=list, max_length=24)
    open_questions: list[str] = Field(default_factory=list, max_length=24)
    user_preferences: str | None = Field(default=None, max_length=2_000)
    branch_context: BranchContextBlock | None = Field(default=None)


def _truncate(text: str | None, limit: int) -> str | None:
    if not text:
        return None
    t = text.strip()
    if len(t) <= limit:
        return t
    return t[:limit].rstrip() + "…"


def _truncate_list(items: list[str], max_items: int, per_item: int = 220) -> list[str]:
    out: list[str] = []
    for raw in items[:max_items]:
        s = raw.strip()
        if not s:
            continue
        if len(s) > per_item:
            s = s[:per_item].rstrip() + "…"
        out.append(s)
    return out


def _format_role(role: str, model_id: str | None) -> str:
    if role == "user":
        return "USER"
    if role == "assistant":
        return f"ASSISTANT ({model_id})" if model_id else "ASSISTANT"
    return role.upper()


def format_context_block(ctx: ContextBlock | None) -> str:
    """Render a ContextBlock into a compact text section for prompts.

    Returns an empty string if the block has nothing useful — callers can
    safely concatenate this in front of any prompt.
    """
    if ctx is None:
        return ""

    sections: list[str] = []

    branch = _format_branch_context(ctx.branch_context)
    if branch:
        sections.append(branch)

    project_summary = _truncate(ctx.project_summary, _MAX_SUMMARY_CHARS)
    if project_summary or ctx.project_title:
        head = f"PROJECT CONTEXT{f' — {ctx.project_title.strip()}' if ctx.project_title else ''}:"
        sections.append(head + "\n" + (project_summary or "(no summary yet)"))

    decisions = _truncate_list(ctx.project_decisions, _MAX_DECISIONS)
    if decisions:
        sections.append("KEY DECISIONS:\n" + "\n".join(f"- {d}" for d in decisions))

    open_qs = _truncate_list(ctx.open_questions, _MAX_OPEN_QUESTIONS)
    if open_qs:
        sections.append("OPEN QUESTIONS:\n" + "\n".join(f"- {q}" for q in open_qs))

    chat_summary = _truncate(ctx.chat_summary, _MAX_SUMMARY_CHARS)
    if chat_summary:
        sections.append("CHAT SUMMARY:\n" + chat_summary)

    if ctx.recent_messages:
        msg_lines: list[str] = []
        for m in ctx.recent_messages[-_MAX_RECENT_MESSAGES:]:
            body = _truncate(m.content, _MAX_MESSAGE_CHARS) or ""
            msg_lines.append(f"{_format_role(m.role, m.model_id)}:\n{body}")
        sections.append("RECENT MESSAGES:\n" + "\n\n".join(msg_lines))

    prefs = _truncate(ctx.user_preferences, _MAX_PREFERENCES_CHARS)
    if prefs:
        sections.append("USER PREFERENCES:\n" + prefs)

    return "\n\n".join(sections)


def _format_branch_context(branch: BranchContextBlock | None) -> str:
    """Render the branch slice. Comes first so models read it before normal context."""
    if branch is None:
        return ""

    parts: list[str] = []
    parts.append(
        "BRANCH CONTEXT:\n"
        f"This chat continues from {branch.source_model_label} "
        f"(model_id={branch.source_model_id}) in source chat {branch.source_chat_id}."
    )

    parent_summary = _truncate(branch.parent_chat_summary, _MAX_SUMMARY_CHARS)
    if parent_summary:
        parts.append("PARENT CHAT SUMMARY:\n" + parent_summary)

    original_prompt = _truncate(branch.original_prompt, _MAX_BRANCH_FIELD_CHARS) or ""
    parts.append("ORIGINAL PROMPT:\n" + original_prompt)

    selected = _truncate(branch.selected_response, _MAX_BRANCH_FIELD_CHARS) or ""
    parts.append(
        f"SELECTED RESPONSE ({branch.source_model_label}):\n" + selected
    )

    if branch.sibling_responses:
        sib_lines: list[str] = []
        for sib in branch.sibling_responses[:_MAX_BRANCH_SIBLINGS]:
            body = _truncate(sib.response, _MAX_BRANCH_SIBLING_CHARS) or ""
            sib_lines.append(f"--- {sib.model_label} ---\n{body}")
        parts.append("OTHER SUCCESSFUL MODEL RESPONSES:\n" + "\n\n".join(sib_lines))

    judge = _truncate(branch.judge_summary, _MAX_SUMMARY_CHARS)
    if judge:
        parts.append("JUDGE SUMMARY:\n" + judge)

    final = _truncate(branch.final_synthesis, _MAX_BRANCH_FIELD_CHARS)
    if final:
        parts.append("FINAL SYNTHESIS:\n" + final)

    pipeline = _truncate(branch.pipeline_trace_summary, _MAX_BRANCH_PIPELINE_CHARS)
    if pipeline:
        parts.append("PIPELINE TRACE SUMMARY:\n" + pipeline)

    return "\n\n".join(parts)


def build_context_for_prompt(
    ctx: ContextBlock | None,
    current_prompt: str,
    *,
    role_instructions: str | None = None,
) -> str:
    """Assemble the final user-facing prompt: context block + current prompt.

    Parameters
    ----------
    ctx
        Already-fetched memory snapshot from the frontend.
    current_prompt
        The user's new prompt (always required, never elided).
    role_instructions
        Optional step- or mode-specific instructions appended after context but
        before the user prompt (e.g. pipeline draft / critique / improve / verify
        / final wrappers, or judge synthesis instructions).

    TODO(memory): when we migrate to server-side Firestore reads, replace the
    ``ctx`` arg with ``(user_id, project_id, chat_id)`` and fetch here using
    firebase-admin. Today the frontend already holds the auth+SDK so it does
    the read.
    TODO(retrieval): add embeddings-based retrieval of older messages once we
    have a vector store. For now this is purely recency-based.
    """
    parts: list[str] = []
    formatted = format_context_block(ctx)
    if formatted:
        parts.append(formatted)
    if role_instructions:
        parts.append(role_instructions.strip())
    parts.append(f"CURRENT USER PROMPT:\n{current_prompt.strip()}")
    return "\n\n".join(parts)
