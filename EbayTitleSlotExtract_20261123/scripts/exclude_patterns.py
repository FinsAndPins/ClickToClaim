"""Shared exclude / quarantine tokens for title-slot descriptions.

Anything matching these must never appear in description_candidate.

Intentionally NOT excluded (Steve keep list): anniversary counts (60th, etc.),
BoxLunch, DEC / WDCS / TWDCS codes. DLR (Disneyland Resort) stays; bare LR drops.
"""

from __future__ import annotations

import re

# Phrases and tokens stripped from keep fields and flagged as description leaks.
# Longer phrases first where order matters inside alternation.
_EXCLUDE_PARTS = [
    r"Cast\s+Member\s+Exclusive",
    r"Cast\s+Exclusive",
    r"Limited\s+Release",
    r"Open\s+Edition",
    r"Artist\s+Proof",
    r"Pre-?production",
    r"Ready\s+to\s+ship",
    r"Fantasy\s+Pin",
    r"Trading\s+Pin",
    r"Enamel\s+Pin",
    r"Disney\s+Pin",
    r"Single\s+Pin",
    r"In\s+Hands",
    r"no\s+box",
    r"\bLE\s*\d{2,5}\b",
    r"\bchaser\b",
    r"\bmystery\b",
    r"\b(?:19|20)\d{2}\b",
    r"\bAP\b",
    r"\bPP\b",
    r"\bCME\b",
    r"\bLR\b",
    r"\bOE\b",
    r"\bSample\b",
    r"\bFantasy\b",
    r"\bOpened\b",
    r"\bloose\b",
    r"\bPrototype\b",
    r"\bError\b",
    r"\bScrapper\b",
    r"\bDupe\b",
    r"\bEmployee\b",
    r"\bCast\s+Member\b",
    r"\bAuthentic\b",
    r"\bGenuine\b",
    r"\bRetired\b",
]

EXCLUDE_RE = re.compile(r"|".join(_EXCLUDE_PARTS), re.I)

# Whole keep-field values that are only an exclude token (never keep as maker/park/set).
WHOLE_EXCLUDE_RE = re.compile(
    r"(?i)^("
    r"AP|PP|CME|LR|OE|"
    r"Cast\s+Exclusive|Cast\s+Member\s+Exclusive|Cast\s+Member|"
    r"Limited\s+Release|Open\s+Edition|"
    r"Artist\s+Proof|Pre-?production|Sample|"
    r"Fantasy(\s+Pin)?|"
    r"Opened|loose|no\s+box|In\s+Hands|Ready\s+to\s+ship|"
    r"Prototype|Error|Scrapper|Dupe|Employee|"
    r"Authentic|Genuine|Retired|"
    r"Trading\s+Pin|Enamel\s+Pin|Disney\s+Pin|Single\s+Pin"
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
            r"Ready\s+to\s+ship",
            r"Fantasy\s+Pin",
            r"Trading\s+Pin",
            r"Enamel\s+Pin",
            r"Disney\s+Pin",
            r"Single\s+Pin",
            r"In\s+Hands",
            r"no\s+box",
            r"\bCast\s+Member\b",
            r"\b(?:AP|PP|CME|LR|OE|Sample|Fantasy|Opened|loose|"
            r"Prototype|Error|Scrapper|Dupe|Employee|"
            r"Authentic|Genuine|Retired)\b",
        ]
    ),
    re.I,
)
