"""
RankingService - Lookup VHB and ABDC journal rankings by ISSN or journal name
"""

import json
import re
from pathlib import Path
from typing import Dict, Optional

# Try to import rapidfuzz for fuzzy matching, fall back to no fuzzy matching
try:
    from rapidfuzz import process, fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

_DATA_DIR = Path(__file__).resolve().parent / "data"


class RankingService:
    """Provides VHB and ABDC journal rankings lookup."""

    def __init__(self):
        """Load ranking data from JSON files."""
        self._vhb_issn: Dict[str, str] = {}
        self._vhb_name: Dict[str, str] = {}
        self._abdc_issn: Dict[str, str] = {}
        self._abdc_name: Dict[str, str] = {}

        # Load VHB rankings
        vhb_path = _DATA_DIR / "vhb_ranking.json"
        if vhb_path.exists():
            with open(vhb_path, encoding="utf-8") as f:
                data = json.load(f)
                self._vhb_issn = {
                    self._clean_issn(k): v
                    for k, v in data.get("issn_to_rating", {}).items()
                }
                self._vhb_name = {
                    self._norm(k): v
                    for k, v in data.get("name_to_rating", {}).items()
                }

        # Load ABDC rankings
        abdc_path = _DATA_DIR / "abdc_ranking.json"
        if abdc_path.exists():
            with open(abdc_path, encoding="utf-8") as f:
                data = json.load(f)
                self._abdc_issn = {
                    self._clean_issn(k): v
                    for k, v in data.get("issn_to_rating", {}).items()
                }
                self._abdc_name = {
                    self._norm(k): v
                    for k, v in data.get("name_to_rating", {}).items()
                }

        print(f"   Loaded VHB rankings: {len(self._vhb_name)} journals")
        print(f"   Loaded ABDC rankings: {len(self._abdc_name)} journals")

    def get_vhb_ranking(self, journal_title: Optional[str] = None,
                        issn: Optional[str] = None,
                        eissn: Optional[str] = None) -> str:
        """Get VHB ranking for a journal."""
        return self._lookup(journal_title, issn, eissn,
                           self._vhb_issn, self._vhb_name)

    def get_abdc_ranking(self, journal_title: Optional[str] = None,
                         issn: Optional[str] = None,
                         eissn: Optional[str] = None) -> str:
        """Get ABDC ranking for a journal."""
        return self._lookup(journal_title, issn, eissn,
                           self._abdc_issn, self._abdc_name)

    def _lookup(self, journal_title: Optional[str],
                issn: Optional[str],
                eissn: Optional[str],
                issn_map: Dict[str, str],
                name_map: Dict[str, str]) -> str:
        """Lookup ranking by ISSN or journal name."""
        # 1) Try ISSN
        if issn:
            rating = issn_map.get(self._clean_issn(issn))
            if rating:
                return rating

        # 2) Try eISSN
        if eissn:
            rating = issn_map.get(self._clean_issn(eissn))
            if rating:
                return rating

        # 3) Try journal title (exact match)
        if journal_title:
            normed = self._norm(journal_title)
            rating = name_map.get(normed)
            if rating:
                return rating

            # 4) Try fuzzy match if rapidfuzz is available
            if HAS_RAPIDFUZZ and name_map:
                result = process.extractOne(normed, name_map.keys(), scorer=fuzz.ratio)
                if result is not None:
                    best_match, score, _ = result
                    if score > 90:
                        return name_map[best_match]

        return "N/A"

    @staticmethod
    def _norm(name: str) -> str:
        """Normalize journal name: lowercase + collapse whitespace."""
        return re.sub(r"\s+", " ", name).strip().lower()

    @staticmethod
    def _clean_issn(raw: str) -> str:
        """Clean ISSN: remove hyphens, uppercase."""
        return raw.replace("-", "").upper()


# Singleton instance
_ranking_service: Optional[RankingService] = None


def get_ranking_service() -> RankingService:
    """Get or create the ranking service singleton."""
    global _ranking_service
    if _ranking_service is None:
        _ranking_service = RankingService()
    return _ranking_service
