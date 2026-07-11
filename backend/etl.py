# backend/etl.py
import os
import math
import re
import hashlib
from typing import Optional, List, Tuple, Dict
import pandas as pd


# ------------------------------------------------------------
# Column normalization (robust against Excel quirks + quotes)
# ------------------------------------------------------------
def normalize_col(col: str) -> str:
    """
    Normalize column names to avoid hidden Excel characters:
    - BOM (\ufeff)
    - Non-breaking spaces (\xa0)
    - Leading/trailing/multiple whitespaces
    - Wrapping quotes: '"title"' -> 'title'
    """
    s = str(col)
    s = s.replace("\ufeff", "")
    s = s.replace("\xa0", " ")
    s = s.strip()
    s = " ".join(s.split())

    # Remove wrapping quotes repeatedly (handles "'title'" and '"title"')
    while len(s) >= 2 and (
            (s[0] == '"' and s[-1] == '"') or
            (s[0] == "'" and s[-1] == "'")
    ):
        s = s[1:-1].strip()

    # Remove any remaining edge quotes (defensive)
    s = s.strip('"').strip("'").strip()
    return s


# ------------------------------------------------------------
# Fixed schema (standardized export from legacy project)
# IMPORTANT: Input column is "abdcRanking" (we must accept it)
# ------------------------------------------------------------
REQUIRED_COLUMNS = [
    "title",
    "authors",
    "abstract",
    "date",
    "journal_name",
    "doi",
]

# Columns that will be added with defaults if missing
COLUMNS_WITH_DEFAULTS = {
    "source": "WoS",           # Default source
    "vhbRanking": "N/A",       # Default ranking
    "abdcRanking": "N/A",      # Default ranking
}

OPTIONAL_COLUMNS = {
    "sources",          # often used as keywords / subject areas (if present)
    "source_count",
    "issn",
    "eissn",
    "url",
    "citations",
    "journal_quartile",
    "author_keywords",  # Author-provided keywords
    "keywords_plus",    # System/index keywords (WoS: Keywords Plus, Scopus: Index Keywords)
}

# Column aliases for raw WoS/Scopus exports (lowercase keys for case-insensitive matching)
COLUMN_ALIASES = {
    # WoS format
    'article title': 'title',
    'author full names': 'authors',
    'authors': 'authors',
    'abstract': 'abstract',
    'publication year': 'date',
    'source title': 'journal_name',
    'doi': 'doi',
    'doi link': 'url',
    'times cited, wos core': 'citations',
    'times cited, all databases': 'citations',
    'author keywords': 'author_keywords',
    'keywords plus': 'keywords_plus',
    'issn': 'issn',
    'eissn': 'eissn',
    # Scopus format
    'title': 'title',
    'year': 'date',
    'index keywords': 'keywords_plus',
    'cited by': 'citations',
    'link': 'url',
}


# ------------------------------------------------------------
# Safe conversion (NaN / None → "")
# ------------------------------------------------------------
def safe_str(x):
    if x is None:
        return ""
    if isinstance(x, float) and math.isnan(x):
        return ""
    return str(x)


# ------------------------------------------------------------
# Ask user for file path (CLI helper)
# ------------------------------------------------------------
def get_user_file_path() -> Optional[str]:
    print("\n[INPUT] Enter CSV/XLS/XLSX file path:")
    fp = input("File path: ").strip().strip('"').strip("'")
    if not os.path.exists(fp):
        print("[ERROR] File not found.")
        return None
    return fp


# ------------------------------------------------------------
# Load + Parse standardized dataset (ETL Stage 1)
# ------------------------------------------------------------
def load_and_parse_standard_data(file_path: str) -> pd.DataFrame:
    print(f"\n[LOAD] Loading standardized file: {file_path}")

    # Load file
    if file_path.lower().endswith(".csv"):
        df = pd.read_csv(file_path, encoding="utf-8", on_bad_lines="skip")
    else:
        df = pd.read_excel(file_path)

    # Normalize headers
    df.columns = [normalize_col(c) for c in df.columns]

    # Apply column aliases (for raw WoS/Scopus exports) - case insensitive
    rename_map = {}
    for c in df.columns:
        c_lower = c.lower()
        if c_lower in COLUMN_ALIASES:
            rename_map[c] = COLUMN_ALIASES[c_lower]
    df.rename(columns=rename_map, inplace=True)

    # Handle duplicate columns (keep first occurrence)
    df = df.loc[:, ~df.columns.duplicated()]

    # Debug: show exact representations
    print("[COLUMNS] Normalized columns:", [repr(c) for c in df.columns])

    # Validate required columns
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"[ERROR] Missing required columns: {missing}\n"
            f"Found columns: {list(df.columns)}"
        )

    # Add default values for missing columns
    for col, default_val in COLUMNS_WITH_DEFAULTS.items():
        if col not in df.columns:
            df[col] = default_val
            print(f"[DEFAULT] Added default column '{col}' = '{default_val}'")

    # Keep only known columns (stable order)
    all_known_columns = REQUIRED_COLUMNS + list(COLUMNS_WITH_DEFAULTS.keys())
    selected_columns = all_known_columns + [c for c in OPTIONAL_COLUMNS if c in df.columns]
    # Only select columns that exist
    selected_columns = [c for c in selected_columns if c in df.columns]
    df = df[selected_columns]

    # Clean values
    for col in df.columns:
        df[col] = df[col].apply(safe_str)

    # Hard quality filter (recommended for graph + embeddings)
    before = len(df)
    df = df[
        (df["title"].str.strip() != "") &
        (df["abstract"].str.strip() != "") &
        (df["doi"].str.strip() != "")
    ]
    after = len(df)

    print(f"[OK] Rows before filter: {before}")
    print(f"[OK] Rows after filter:  {after}")

    # Apply journal rankings lookup
    df = apply_journal_rankings(df)

    return df


def apply_journal_rankings(df: pd.DataFrame) -> pd.DataFrame:
    """
    Look up VHB and ABDC rankings for each paper based on ISSN/eISSN/journal name.
    Only updates rankings that are currently 'N/A'.
    """
    from backend.ranking_service import get_ranking_service

    try:
        ranking_service = get_ranking_service()
    except Exception as e:
        print(f"[WARN] Could not load ranking service: {e}")
        return df

    print("\n[RANKING] Looking up journal rankings...")
    vhb_found = 0
    abdc_found = 0

    for idx, row in df.iterrows():
        journal = safe_str(row.get("journal_name", ""))
        issn = safe_str(row.get("issn", ""))
        eissn = safe_str(row.get("eissn", ""))

        # Only look up if current value is N/A or empty
        current_vhb = safe_str(row.get("vhbRanking", "")).strip()
        if not current_vhb or current_vhb == "N/A":
            vhb = ranking_service.get_vhb_ranking(journal, issn, eissn)
            if vhb != "N/A":
                df.at[idx, "vhbRanking"] = vhb
                vhb_found += 1

        current_abdc = safe_str(row.get("abdcRanking", "")).strip()
        if not current_abdc or current_abdc == "N/A":
            abdc = ranking_service.get_abdc_ranking(journal, issn, eissn)
            if abdc != "N/A":
                df.at[idx, "abdcRanking"] = abdc
                abdc_found += 1

    print(f"   Found VHB rankings: {vhb_found}/{len(df)}")
    print(f"   Found ABDC rankings: {abdc_found}/{len(df)}")

    return df


# ============================================================
# Neo4j CSV Export (Stage 1)
# ============================================================

def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def make_stable_id(prefix: str, value: str) -> str:
    """
    Deterministic ID generator (platform-level, no semantics).
    Example: AUTHOR_<sha1(name)>
    """
    v = safe_str(value).strip()
    return f"{prefix}_{_sha1(v.lower())}"


def split_authors(authors_raw: str) -> List[str]:
    """
    Based on your Scopus Example screenshots:
    - Authors are separated by semicolon ';'
    - Commas belong to names (e.g., 'Smith, John') and MUST NOT be split.
    """
    s = safe_str(authors_raw)
    if not s.strip():
        return []
    parts = [p.strip() for p in s.split(";")]
    return [p for p in parts if p]


def split_keywords(raw: str) -> List[str]:
    """
    Optional helper:
    If 'sources' exists and contains multiple values, we try to split robustly.
    This stays TECHNICAL (no interpretation).
    We split on ';' first; if not present, we try '|' then ',' as a fallback.
    """
    s = safe_str(raw).strip()
    if not s:
        return []

    if ";" in s:
        parts = [p.strip() for p in s.split(";")]
    elif "|" in s:
        parts = [p.strip() for p in s.split("|")]
    else:
        # Fallback: comma-separated keywords (only as a last resort)
        parts = [p.strip() for p in s.split(",")]

    # remove empties + de-duplicate while preserving order
    seen = set()
    out = []
    for p in parts:
        if p and p.lower() not in seen:
            out.append(p)
            seen.add(p.lower())
    return out


def parse_keyword_field(raw: str) -> List[str]:
    """
    Parse a keyword field (semicolon-separated) into a list of keywords.
    Used for author_keywords and keywords_plus columns.
    """
    s = safe_str(raw).strip()
    if not s:
        return []
    # Split on semicolon (standard separator in WoS/Scopus exports)
    parts = [p.strip() for p in s.split(";") if p.strip()]
    return parts


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def extract_year(date_str: str) -> str:
    """
    Extract year from date string.
    Handles formats like: '2021-03-15', '2021', '15.03.2021', etc.
    """
    s = safe_str(date_str).strip()
    if not s:
        return ""
    # Try to find 4-digit year
    match = re.search(r'(19|20)\d{2}', s)
    if match:
        return match.group(0)
    return ""


def export_neo4j_csvs(
    df: pd.DataFrame,
    out_dir: str = "./neo4j/import",
    export_keywords: bool = True,
) -> Dict[str, str]:
    """
    Writes Neo4j-friendly CSVs based on Knowledge Architect schema.

    Nodes:
    - documents.csv            (:Document)
    - authors.csv              (:Author)
    - journals.csv             (:Journal)
    - ranking_bodies.csv       (:RankingBody)
    - rankings.csv             (:Ranking)
    - years.csv                (:Year)

    Relationships:
    - has_author.csv           (:Document)-[:HAS_AUTHOR]->(:Author)
    - published_in.csv         (:Document)-[:PUBLISHED_IN]->(:Journal)
    - has_rating.csv           (:Journal)-[:HAS_RATING]->(:Ranking)
    - issued_by.csv            (:Ranking)-[:ISSUED_BY]->(:RankingBody)
    - collaborated_with.csv    (:Author)-[:COLLABORATED_WITH]->(:Author)
    - same_year_as.csv         (:Document)-[:SAME_YEAR_AS]->(:Document)
    - is_valid_in_year.csv     (:Ranking)-[:IS_VALID_IN_YEAR]->(:Year)

    IDs:
    - Document ID = doi
    - Author ID = AUTHOR_<sha1(author_name)>
    - Journal ID = JOURNAL_<sha1(journal_name)>
    - RankingBody ID = VHB or ABDC
    - Ranking ID = RANKING_<body>_<value>
    - Year ID = YEAR_<yyyy>
    """
    ensure_dir(out_dir)
    written = {}

    # =========================================================
    # NODES
    # =========================================================

    # -------------------------
    # Documents (formerly Papers)
    # -------------------------
    documents = df.copy()
    documents["document_id"] = documents["doi"].apply(lambda x: safe_str(x).strip())

    # Select only Document properties according to schema
    doc_cols = ["document_id", "title", "abstract", "doi", "url"]
    doc_cols = [c for c in doc_cols if c in documents.columns or c == "document_id"]
    documents_export = documents[["document_id", "title", "abstract", "doi"]].copy()
    if "url" in documents.columns:
        documents_export["url"] = documents["url"]

    documents_path = os.path.join(out_dir, "documents.csv")
    documents_export.to_csv(documents_path, index=False, encoding="utf-8")
    written["documents"] = documents_path

    # -------------------------
    # Authors
    # -------------------------
    author_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        for author_name in split_authors(row.get("authors", "")):
            author_id = make_stable_id("AUTHOR", author_name)
            author_rows.append({
                "author_id": author_id,
                "name": author_name,
            })

    authors_df = pd.DataFrame(author_rows).drop_duplicates(subset=["author_id"])
    authors_path = os.path.join(out_dir, "authors.csv")
    authors_df.to_csv(authors_path, index=False, encoding="utf-8")
    written["authors"] = authors_path

    # -------------------------
    # Journals
    # -------------------------
    journal_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        journal_name = safe_str(row.get("journal_name", "")).strip()
        if not journal_name:
            continue

        journal_id = make_stable_id("JOURNAL", journal_name)
        journal_rows.append({
            "journal_id": journal_id,
            "name": journal_name,
            "issn": safe_str(row.get("issn", "")),
            "eissn": safe_str(row.get("eissn", "")),
        })

    journals_df = pd.DataFrame(journal_rows).drop_duplicates(subset=["journal_id"])
    journals_path = os.path.join(out_dir, "journals.csv")
    journals_df.to_csv(journals_path, index=False, encoding="utf-8")
    written["journals"] = journals_path

    # -------------------------
    # RankingBodies (VHB and ABDC - manually created)
    # -------------------------
    ranking_bodies = [
        {"ranking_body_id": "VHB", "name": "VHB"},
        {"ranking_body_id": "ABDC", "name": "ABDC"},
    ]
    ranking_bodies_df = pd.DataFrame(ranking_bodies)
    ranking_bodies_path = os.path.join(out_dir, "ranking_bodies.csv")
    ranking_bodies_df.to_csv(ranking_bodies_path, index=False, encoding="utf-8")
    written["ranking_bodies"] = ranking_bodies_path

    # -------------------------
    # Rankings
    # -------------------------
    ranking_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        # VHB Ranking
        vhb_value = safe_str(row.get("vhbRanking", "")).strip()
        if vhb_value:
            ranking_id = f"RANKING_VHB_{vhb_value}"
            ranking_rows.append({
                "ranking_id": ranking_id,
                "value": vhb_value,
                "body": "VHB",
            })

        # ABDC Ranking
        abdc_value = safe_str(row.get("abdcRanking", "")).strip()
        if abdc_value:
            ranking_id = f"RANKING_ABDC_{abdc_value}"
            ranking_rows.append({
                "ranking_id": ranking_id,
                "value": abdc_value,
                "body": "ABDC",
            })

    rankings_df = pd.DataFrame(ranking_rows).drop_duplicates(subset=["ranking_id"])
    rankings_path = os.path.join(out_dir, "rankings.csv")
    rankings_df.to_csv(rankings_path, index=False, encoding="utf-8")
    written["rankings"] = rankings_path

    # -------------------------
    # Years
    # -------------------------
    year_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        year = extract_year(row.get("date", ""))
        if year:
            year_rows.append({
                "year_id": f"YEAR_{year}",
                "year": year,
            })

    years_df = pd.DataFrame(year_rows).drop_duplicates(subset=["year_id"])
    years_path = os.path.join(out_dir, "years.csv")
    years_df.to_csv(years_path, index=False, encoding="utf-8")
    written["years"] = years_path

    # =========================================================
    # RELATIONSHIPS
    # =========================================================

    # -------------------------
    # HAS_AUTHOR (Document -> Author)
    # -------------------------
    has_author_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        doi = safe_str(row.get("doi", "")).strip()
        if not doi:
            continue

        for author_name in split_authors(row.get("authors", "")):
            author_id = make_stable_id("AUTHOR", author_name)
            has_author_rows.append({
                "document_id": doi,
                "author_id": author_id,
            })

    has_author_df = pd.DataFrame(has_author_rows).drop_duplicates()
    has_author_path = os.path.join(out_dir, "has_author.csv")
    has_author_df.to_csv(has_author_path, index=False, encoding="utf-8")
    written["has_author"] = has_author_path

    # -------------------------
    # PUBLISHED_IN (Document -> Journal)
    # -------------------------
    published_in_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        doi = safe_str(row.get("doi", "")).strip()
        journal_name = safe_str(row.get("journal_name", "")).strip()
        if not doi or not journal_name:
            continue

        journal_id = make_stable_id("JOURNAL", journal_name)
        published_in_rows.append({
            "document_id": doi,
            "journal_id": journal_id,
        })

    published_in_df = pd.DataFrame(published_in_rows).drop_duplicates()
    published_in_path = os.path.join(out_dir, "published_in.csv")
    published_in_df.to_csv(published_in_path, index=False, encoding="utf-8")
    written["published_in"] = published_in_path

    # -------------------------
    # HAS_RATING (Journal -> Ranking)
    # -------------------------
    has_rating_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        journal_name = safe_str(row.get("journal_name", "")).strip()
        if not journal_name:
            continue

        journal_id = make_stable_id("JOURNAL", journal_name)

        # VHB Rating
        vhb_value = safe_str(row.get("vhbRanking", "")).strip()
        if vhb_value:
            has_rating_rows.append({
                "journal_id": journal_id,
                "ranking_id": f"RANKING_VHB_{vhb_value}",
            })

        # ABDC Rating
        abdc_value = safe_str(row.get("abdcRanking", "")).strip()
        if abdc_value:
            has_rating_rows.append({
                "journal_id": journal_id,
                "ranking_id": f"RANKING_ABDC_{abdc_value}",
            })

    has_rating_df = pd.DataFrame(has_rating_rows).drop_duplicates()
    has_rating_path = os.path.join(out_dir, "has_rating.csv")
    has_rating_df.to_csv(has_rating_path, index=False, encoding="utf-8")
    written["has_rating"] = has_rating_path

    # -------------------------
    # ISSUED_BY (Ranking -> RankingBody)
    # -------------------------
    issued_by_rows: List[Dict[str, str]] = []

    for _, row in rankings_df.iterrows():
        ranking_id = row["ranking_id"]
        body = row["body"]
        issued_by_rows.append({
            "ranking_id": ranking_id,
            "ranking_body_id": body,
        })

    issued_by_df = pd.DataFrame(issued_by_rows).drop_duplicates()
    issued_by_path = os.path.join(out_dir, "issued_by.csv")
    issued_by_df.to_csv(issued_by_path, index=False, encoding="utf-8")
    written["issued_by"] = issued_by_path

    # -------------------------
    # COLLABORATED_WITH (Author -> Author)
    # Co-authors on the same document
    # -------------------------
    collaborated_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        authors = split_authors(row.get("authors", ""))
        if len(authors) < 2:
            continue

        # Create pairs of co-authors
        for i, author1 in enumerate(authors):
            for author2 in authors[i+1:]:
                id1 = make_stable_id("AUTHOR", author1)
                id2 = make_stable_id("AUTHOR", author2)
                # Store in consistent order to avoid duplicates
                if id1 < id2:
                    collaborated_rows.append({
                        "author_id_1": id1,
                        "author_id_2": id2,
                    })
                else:
                    collaborated_rows.append({
                        "author_id_1": id2,
                        "author_id_2": id1,
                    })

    collaborated_df = pd.DataFrame(collaborated_rows).drop_duplicates()
    collaborated_path = os.path.join(out_dir, "collaborated_with.csv")
    collaborated_df.to_csv(collaborated_path, index=False, encoding="utf-8")
    written["collaborated_with"] = collaborated_path

    # -------------------------
    # SAME_YEAR_AS (Document -> Document)
    # Documents published in the same year
    # -------------------------
    # Group documents by year
    docs_by_year: Dict[str, List[str]] = {}
    for _, row in df.iterrows():
        doi = safe_str(row.get("doi", "")).strip()
        year = extract_year(row.get("date", ""))
        if doi and year:
            if year not in docs_by_year:
                docs_by_year[year] = []
            docs_by_year[year].append(doi)

    same_year_rows: List[Dict[str, str]] = []
    for year, docs in docs_by_year.items():
        if len(docs) < 2:
            continue
        for i, doc1 in enumerate(docs):
            for doc2 in docs[i+1:]:
                # Store in consistent order
                if doc1 < doc2:
                    same_year_rows.append({
                        "document_id_1": doc1,
                        "document_id_2": doc2,
                    })
                else:
                    same_year_rows.append({
                        "document_id_1": doc2,
                        "document_id_2": doc1,
                    })

    same_year_df = pd.DataFrame(same_year_rows).drop_duplicates()
    same_year_path = os.path.join(out_dir, "same_year_as.csv")
    same_year_df.to_csv(same_year_path, index=False, encoding="utf-8")
    written["same_year_as"] = same_year_path

    # -------------------------
    # IS_VALID_IN_YEAR (Ranking -> Year)
    # Link rankings to the years of documents that have them
    # -------------------------
    valid_in_year_rows: List[Dict[str, str]] = []

    for _, row in df.iterrows():
        year = extract_year(row.get("date", ""))
        if not year:
            continue

        year_id = f"YEAR_{year}"

        vhb_value = safe_str(row.get("vhbRanking", "")).strip()
        if vhb_value:
            valid_in_year_rows.append({
                "ranking_id": f"RANKING_VHB_{vhb_value}",
                "year_id": year_id,
            })

        abdc_value = safe_str(row.get("abdcRanking", "")).strip()
        if abdc_value:
            valid_in_year_rows.append({
                "ranking_id": f"RANKING_ABDC_{abdc_value}",
                "year_id": year_id,
            })

    valid_in_year_df = pd.DataFrame(valid_in_year_rows).drop_duplicates()
    valid_in_year_path = os.path.join(out_dir, "is_valid_in_year.csv")
    valid_in_year_df.to_csv(valid_in_year_path, index=False, encoding="utf-8")
    written["is_valid_in_year"] = valid_in_year_path

    # =========================================================
    # PRINT SUMMARY
    # =========================================================
    print("\n[EXPORT] Neo4j CSV Export complete:")
    print("\n  Nodes:")
    print(f"   - documents:      {len(documents_export)}")
    print(f"   - authors:        {len(authors_df)}")
    print(f"   - journals:       {len(journals_df)}")
    print(f"   - ranking_bodies: {len(ranking_bodies_df)}")
    print(f"   - rankings:       {len(rankings_df)}")
    print(f"   - years:          {len(years_df)}")
    print("\n  Relationships:")
    print(f"   - has_author:         {len(has_author_df)}")
    print(f"   - published_in:       {len(published_in_df)}")
    print(f"   - has_rating:         {len(has_rating_df)}")
    print(f"   - issued_by:          {len(issued_by_df)}")
    print(f"   - collaborated_with:  {len(collaborated_df)}")
    print(f"   - same_year_as:       {len(same_year_df)}")
    print(f"   - is_valid_in_year:   {len(valid_in_year_df)}")

    print(f"\n[DIR] Output dir: {os.path.abspath(out_dir)}")
    return written


def write_neo4j_import_cypher(out_dir: str = "./neo4j/import") -> str:
    """
    Writes an import.cypher that you can run in Neo4j Browser.
    Based on Knowledge Architect schema with all Nodes and Relationships.

    Assumes you mounted Neo4j /import to this directory.
    In Neo4j Browser you can run:
      :source import.cypher
    """
    ensure_dir(out_dir)
    cypher_path = os.path.join(out_dir, "import.cypher")

    # Note: file:/// paths refer to Neo4j's import directory inside the container.
    # If you use docker-compose from earlier, ./neo4j/import -> /var/lib/neo4j/import.
    cypher = """
// ==============================================================
// Neo4j Import Script - Knowledge Architect Schema
// ==============================================================

// ------------------------------
// Constraints / Indexes
// ------------------------------
CREATE CONSTRAINT document_id_unique IF NOT EXISTS
FOR (d:Document) REQUIRE d.document_id IS UNIQUE;

CREATE CONSTRAINT author_id_unique IF NOT EXISTS
FOR (a:Author) REQUIRE a.author_id IS UNIQUE;

CREATE CONSTRAINT journal_id_unique IF NOT EXISTS
FOR (j:Journal) REQUIRE j.journal_id IS UNIQUE;

CREATE CONSTRAINT ranking_body_id_unique IF NOT EXISTS
FOR (rb:RankingBody) REQUIRE rb.ranking_body_id IS UNIQUE;

CREATE CONSTRAINT ranking_id_unique IF NOT EXISTS
FOR (r:Ranking) REQUIRE r.ranking_id IS UNIQUE;

CREATE CONSTRAINT year_id_unique IF NOT EXISTS
FOR (y:Year) REQUIRE y.year_id IS UNIQUE;

// ------------------------------
// NODES
// ------------------------------

// Documents
LOAD CSV WITH HEADERS FROM 'file:///documents.csv' AS row
MERGE (d:Document {document_id: row.document_id})
SET
  d.title = row.title,
  d.abstract = row.abstract,
  d.doi = row.doi,
  d.url = row.url;

// Authors
LOAD CSV WITH HEADERS FROM 'file:///authors.csv' AS row
MERGE (a:Author {author_id: row.author_id})
SET a.name = row.name;

// Journals
LOAD CSV WITH HEADERS FROM 'file:///journals.csv' AS row
MERGE (j:Journal {journal_id: row.journal_id})
SET
  j.name = row.name,
  j.issn = row.issn,
  j.eissn = row.eissn;

// RankingBodies
LOAD CSV WITH HEADERS FROM 'file:///ranking_bodies.csv' AS row
MERGE (rb:RankingBody {ranking_body_id: row.ranking_body_id})
SET rb.name = row.name;

// Rankings
LOAD CSV WITH HEADERS FROM 'file:///rankings.csv' AS row
MERGE (r:Ranking {ranking_id: row.ranking_id})
SET
  r.value = row.value,
  r.body = row.body;

// Years
LOAD CSV WITH HEADERS FROM 'file:///years.csv' AS row
MERGE (y:Year {year_id: row.year_id})
SET y.year = row.year;

// ------------------------------
// RELATIONSHIPS
// ------------------------------

// HAS_AUTHOR (Document -> Author)
LOAD CSV WITH HEADERS FROM 'file:///has_author.csv' AS row
MATCH (d:Document {document_id: row.document_id})
MATCH (a:Author {author_id: row.author_id})
MERGE (d)-[:HAS_AUTHOR]->(a);

// PUBLISHED_IN (Document -> Journal)
LOAD CSV WITH HEADERS FROM 'file:///published_in.csv' AS row
MATCH (d:Document {document_id: row.document_id})
MATCH (j:Journal {journal_id: row.journal_id})
MERGE (d)-[:PUBLISHED_IN]->(j);

// HAS_RATING (Journal -> Ranking)
LOAD CSV WITH HEADERS FROM 'file:///has_rating.csv' AS row
MATCH (j:Journal {journal_id: row.journal_id})
MATCH (r:Ranking {ranking_id: row.ranking_id})
MERGE (j)-[:HAS_RATING]->(r);

// ISSUED_BY (Ranking -> RankingBody)
LOAD CSV WITH HEADERS FROM 'file:///issued_by.csv' AS row
MATCH (r:Ranking {ranking_id: row.ranking_id})
MATCH (rb:RankingBody {ranking_body_id: row.ranking_body_id})
MERGE (r)-[:ISSUED_BY]->(rb);

// COLLABORATED_WITH (Author -> Author)
LOAD CSV WITH HEADERS FROM 'file:///collaborated_with.csv' AS row
MATCH (a1:Author {author_id: row.author_id_1})
MATCH (a2:Author {author_id: row.author_id_2})
MERGE (a1)-[:COLLABORATED_WITH]->(a2);

// SAME_YEAR_AS (Document -> Document)
LOAD CSV WITH HEADERS FROM 'file:///same_year_as.csv' AS row
MATCH (d1:Document {document_id: row.document_id_1})
MATCH (d2:Document {document_id: row.document_id_2})
MERGE (d1)-[:SAME_YEAR_AS]->(d2);

// IS_VALID_IN_YEAR (Ranking -> Year)
LOAD CSV WITH HEADERS FROM 'file:///is_valid_in_year.csv' AS row
MATCH (r:Ranking {ranking_id: row.ranking_id})
MATCH (y:Year {year_id: row.year_id})
MERGE (r)-[:IS_VALID_IN_YEAR]->(y);
""".strip()

    with open(cypher_path, "w", encoding="utf-8") as f:
        f.write(cypher + "\n")

    print(f"\n[CYPHER] Wrote Cypher import script: {os.path.abspath(cypher_path)}")
    return cypher_path


if __name__ == "__main__":
    # 1. Get the file path from the user
    path = get_user_file_path()

    if path:
        try:
            # 2. Process the data (Clean and Filter)
            df_cleaned = load_and_parse_standard_data(path)

            # 3. Generate Neo4j-ready CSV files
            # These will be saved in ./neo4j/import by default
            export_neo4j_csvs(df_cleaned)

            # 4. Generate the Cypher script to automate the database import
            write_neo4j_import_cypher()

            print("\n[OK] ETL Pipeline finished successfully!")
            print("Next step: Copy the CSVs and .cypher file to your Neo4j 'import' folder.")

        except Exception as e:
            print(f"\n[ERROR] An error occurred during processing: {e}")