"""
Emoji & reaction sentiment layer.

Provides a lightweight adjustment to Claude's sentiment score when the message
contains clear emoji signals. Acts as a safety net — Claude is authoritative,
but if it says sentiment=+0.2 on a "😡😡😡 llevan 5 horas sin entregar" message,
this module pulls the score toward the correct direction.

Also maps WhatsApp reaction emojis to a direct sentiment value.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Emoji → sentiment direction maps
# ---------------------------------------------------------------------------

# Strong negative signals
NEGATIVE_HIGH: set[str] = {
    "😡", "🤬", "😤", "👊", "🖕", "💔", "😱", "😰", "🆘",
    "❌", "🚫", "⛔", "🔴", "💀", "☠️", "😭", "😩", "🤯",
}

NEGATIVE_MED: set[str] = {
    "😞", "😢", "😟", "😔", "😣", "😦", "😧", "🙁", "😕",
    "⚠️", "❗", "⏰", "⏱️", "🐢", "🤦", "🤷",
}

# Positive signals
POSITIVE_HIGH: set[str] = {
    "❤️", "🥰", "😍", "💖", "🤩", "🌟", "⭐", "🎊", "🥳",
    "💯", "🎉", "💪", "🙌", "👏",
}

POSITIVE_MED: set[str] = {
    "✅", "✔️", "👍", "👌", "🙏", "😊", "😄", "😁", "😀",
    "🔥", "💡", "🌈", "😃", "🎈",
}

# Urgency boosters (independently of sentiment)
URGENCY_ALTA_SIGNALS: set[str] = {"🚨", "🆘", "🔴", "⛔", "🚫", "❌", "💀"}

# ---------------------------------------------------------------------------
# Reaction emoji → direct sentiment
# ---------------------------------------------------------------------------
REACTION_SENTIMENT: dict[str, float] = {
    # Positive
    "👍": 0.5,
    "❤️": 0.7,
    "😂": 0.4,
    "🎉": 0.6,
    "😮": 0.1,
    "🔥": 0.5,
    "💯": 0.6,
    "✅": 0.6,
    "😊": 0.5,
    "🙏": 0.4,
    "💪": 0.5,
    "👏": 0.5,
    "🥰": 0.7,
    "😍": 0.7,
    "🌟": 0.6,
    "⭐": 0.5,
    # Negative
    "👎": -0.6,
    "❌": -0.6,
    "😡": -0.8,
    "😤": -0.6,
    "💔": -0.7,
    "😢": -0.5,
    "😭": -0.6,
    "🙁": -0.4,
    "😕": -0.3,
    "🤦": -0.4,
    # Neutral
    "👀": 0.0,
    "🤔": -0.1,
    "😑": -0.1,
    "🤷": -0.1,
}


def _extract_emojis(text: str) -> list[str]:
    """Extract all emoji characters from text."""
    import unicodedata
    result = []
    for char in text:
        try:
            name = unicodedata.name(char, "")
        except (TypeError, ValueError):
            name = ""
        if (
            "\U0001f000" <= char <= "\U0001ffff"  # Misc symbols, emoticons
            or "\U00002600" <= char <= "\U000027ff"  # Misc symbols
            or "\U0000fe00" <= char <= "\U0000fe0f"  # Variation selectors (skip)
            or char in "❤💔"
        ):
            result.append(char)
    return result


def emoji_sentiment_adjustment(
    content: str | None,
    media_type: str | None,
    claude_sentiment: float,
) -> tuple[float, str | None]:
    """
    Given Claude's sentiment score and the message content, returns an adjusted
    sentiment and an optional override urgency.

    Returns:
        (adjusted_sentiment: float, urgency_override: str | None)
        urgency_override is 'alta' if strong urgency emojis found, else None.
    """
    if not content:
        return claude_sentiment, None

    # Special case: media_type == 'reaction' → use reaction map directly
    if media_type == "reaction":
        direct = REACTION_SENTIMENT.get(content.strip())
        if direct is not None:
            return direct, None
        # Unknown reaction emoji — trust Claude
        return claude_sentiment, None

    emojis = _extract_emojis(content)
    if not emojis:
        return claude_sentiment, None

    emoji_set = set(emojis)

    # ── urgency override ─────────────────────────────────────────────────────
    urgency_override: str | None = None
    if emoji_set & URGENCY_ALTA_SIGNALS:
        urgency_override = "alta"

    # ── sentiment adjustment ─────────────────────────────────────────────────
    neg_high = len(emoji_set & NEGATIVE_HIGH)
    neg_med  = len(emoji_set & NEGATIVE_MED)
    pos_high = len(emoji_set & POSITIVE_HIGH)
    pos_med  = len(emoji_set & POSITIVE_MED)

    if neg_high == 0 and neg_med == 0 and pos_high == 0 and pos_med == 0:
        # No clear sentiment emojis
        return claude_sentiment, urgency_override

    # Compute an emoji-weighted target
    emoji_score = (
        neg_high * -0.75
        + neg_med  * -0.45
        + pos_high * +0.70
        + pos_med  * +0.45
    ) / max(neg_high + neg_med + pos_high + pos_med, 1)
    emoji_score = max(-1.0, min(1.0, emoji_score))

    # Pull Claude's score 40% toward the emoji signal
    # (Claude is still authoritative — emoji just nudges it)
    adjusted = claude_sentiment * 0.6 + emoji_score * 0.4
    adjusted = round(max(-1.0, min(1.0, adjusted)), 3)

    return adjusted, urgency_override


def reaction_to_sentiment(emoji: str | None) -> float | None:
    """Returns direct sentiment for a reaction emoji, or None if unknown."""
    if not emoji:
        return None
    return REACTION_SENTIMENT.get(emoji.strip())
