"""Shared exclude / quarantine tokens for title-slot descriptions.

Anything matching these must never appear in description_candidate.

Intentionally NOT excluded (Steve keep list): anniversary counts (60th, etc.),
BoxLunch, DEC / WDCS / TWDCS codes. DLR (Disneyland Resort) stays; bare LR drops.
Blind Box as a set name stays; Booster / Blind Bag / Wave not locked yet.
"""

from __future__ import annotations

import re

# Longer phrases first where order matters inside alternation.
_EXCLUDE_PARTS = [
    # Channel / cast
    r"Cast\s+Member\s+Exclusive",
    r"Cast\s+Exclusive",
    r"Limited\s+Release",
    r"Open\s+Edition",
    r"Artist\s+Proof",
    r"Pre-?production",
    # Logistics / condition
    r"Ready\s+to\s+ship",
    r"Free\s+shipping",
    r"Free\s+ship",
    r"Ships\s+free",
    r"New\s*/\s*box",
    r"In\s+Hands",
    r"no\s+box",
    r"Pick\s+one",
    r"You\s+choose",
    # Product generics
    r"Fantasy\s+Pin",
    r"Trading\s+Pin",
    r"Enamel\s+Pin",
    r"Disney\s+Pin",
    r"Single\s+Pin",
    # LE / year / codes
    r"\bLE\s*\d{2,5}\b",
    r"\b(?:19|20)\d{2}\b",
    r"#\s*\d{3,}\b",
    r"\bR-\d+\b",
    r"\bSKU\b",
    r"\b\d{5,6}\b",  # bare seller pin/SKU numbers (e.g. 130930); not 2-4 digit LE leftovers
    # Single tokens
    r"\bchaser\b",
    r"\bmystery\b",
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
    r"\bExclusive\b",  # bare Exclusive (Cast Exclusive already matched above)
    r"\bChooser\b",
    r"\bChoose\b",
    r"\bPick\b",
    r"\bNew\b",
    r"\bNIB\b",
    r"\bNWT\b",
    r"\bMint\b",
    r"\bSealed\b",
    r"\bHTF\b",
    r"\bRare\b",
    r"\bUnique\b",
    r"\bWow\b",
]

EXCLUDE_RE = re.compile(r"|".join(_EXCLUDE_PARTS), re.I)

WHOLE_EXCLUDE_RE = re.compile(
    r"(?i)^("
    r"AP|PP|CME|LR|OE|"
    r"Cast\s+Exclusive|Cast\s+Member\s+Exclusive|Cast\s+Member|"
    r"Limited\s+Release|Open\s+Edition|"
    r"Artist\s+Proof|Pre-?production|Sample|"
    r"Fantasy(\s+Pin)?|"
    r"Opened|loose|no\s+box|In\s+Hands|Ready\s+to\s+ship|"
    r"Free\s+shipping|Free\s+ship|Ships\s+free|"
    r"Prototype|Error|Scrapper|Dupe|Employee|"
    r"Authentic|Genuine|Retired|Exclusive|"
    r"Trading\s+Pin|Enamel\s+Pin|Disney\s+Pin|Single\s+Pin|"
    r"You\s+choose|Pick\s+one|Chooser|Choose|Pick|"
    r"New|NIB|NWT|Mint|Sealed|HTF|Rare|Unique|Wow|"
    r"SKU|R-\d+|#?\d{5,6}"
    r")$"
)

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
            r"Free\s+shipping",
            r"Free\s+ship",
            r"Ships\s+free",
            r"New\s*/\s*box",
            r"Pick\s+one",
            r"You\s+choose",
            r"Fantasy\s+Pin",
            r"Trading\s+Pin",
            r"Enamel\s+Pin",
            r"Disney\s+Pin",
            r"Single\s+Pin",
            r"In\s+Hands",
            r"no\s+box",
            r"#\s*\d{3,}\b",
            r"\bR-\d+\b",
            r"\b\d{5,6}\b",
            r"\bCast\s+Member\b",
            r"\b(?:AP|PP|CME|LR|OE|Sample|Fantasy|Opened|loose|"
            r"Prototype|Error|Scrapper|Dupe|Employee|"
            r"Authentic|Genuine|Retired|Exclusive|"
            r"Chooser|Choose|Pick|New|NIB|NWT|Mint|Sealed|"
            r"HTF|Rare|Unique|Wow|SKU)\b",
        ]
    ),
    re.I,
)
