"""Shared exclude / quarantine tokens for title-slot descriptions.

Anything matching these must never appear in description_candidate.
"""

from __future__ import annotations

import re

# Phrases and tokens stripped from keep fields and flagged as description leaks.
EXCLUDE_RE = re.compile(
    r"|".join(
        [
            r"\bLE\s*\d{2,5}\b",
            r"\bchaser\b",
            r"\bmystery\b",
            r"\b(?:19|20)\d{2}\b",
            r"\bAP\b",
            r"\bPP\b",
            r"\bCME\b",
            r"\bLR\b",
            r"\bOE\b",
            r"Cast\s+Member\s+Exclusive",
            r"Cast\s+Exclusive",
            r"Limited\s+Release",
            r"Open\s+Edition",
            r"Artist\s+Proof",
            r"Pre-?production",
            r"\bSample\b",
            r"Fantasy\s+Pin",
            r"\bFantasy\b",
            r"\bOpened\b",
            r"\bloose\b",
            r"no\s+box",
            r"In\s+Hands",
        ]
    ),
    re.I,
)

# Whole keep-field values that are only an exclude token (never keep as maker/park/set).
WHOLE_EXCLUDE_RE = re.compile(
    r"(?i)^("
    r"AP|PP|CME|LR|OE|"
    r"Cast\s+Exclusive|Cast\s+Member\s+Exclusive|"
    r"Limited\s+Release|Open\s+Edition|"
    r"Artist\s+Proof|Pre-?production|Sample|"
    r"Fantasy(\s+Pin)?|"
    r"Opened|loose|no\s+box|In\s+Hands"
    r")$"
)

# For scanning titles into drop_tokens.
TITLE_DROP_FIND_RE = re.compile(
    r"|".join(
        [
            r"Cast\s+Member\s+Exclusive",
            r"Cast\s+Exclusive",
            r"Limited\s+Release",
            r"Open\s+Edition",
            r"Artist\s+Proof",
            r"Pre-?production",
            r"Fantasy\s+Pin",
            r"In\s+Hands",
            r"no\s+box",
            r"\b(?:AP|PP|CME|LR|OE|Sample|Fantasy|Opened|loose)\b",
        ]
    ),
    re.I,
)
