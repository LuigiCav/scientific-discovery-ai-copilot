
# backend/search.py
"""
Hybrid Search Engine: Combines Vector Search (ChromaDB) + Knowledge Graph (Neo4j)
"""

import os
import shutil
from sentence_transformers import SentenceTransformer
from chromadb import PersistentClient
from langchain_ollama import OllamaLLM
from neo4j import GraphDatabase  # Plain driver for direct Cypher (no APOC needed)
from backend.etl import safe_str


EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_LOCAL_ONLY = os.getenv("EMBEDDING_LOCAL_FILES_ONLY", "true").lower() in (
    "1", "true", "yes"
)


def load_embedding_model():
    """Load the cached embedding model without unnecessary hub requests."""
    try:
        return SentenceTransformer(
            EMBEDDING_MODEL, local_files_only=EMBEDDING_LOCAL_ONLY
        )
    except OSError as exc:
        if EMBEDDING_LOCAL_ONLY:
            raise RuntimeError(
                f"Embedding model '{EMBEDDING_MODEL}' is not available locally. "
                "Set EMBEDDING_LOCAL_FILES_ONLY=false once to download it."
            ) from exc
        raise


def create_documents_and_metadata(df):
    """Prepare documents for embedding"""
    contents, metadatas, ids = [], [], []

    for _, row in df.iterrows():
        doi = safe_str(row.get("doi", "")).strip()
        if not doi:
            continue

        title = row["title"]
        abstract = row["abstract"]
        url = row.get("url", "")
        link = url if url else f"https://doi.org/{doi}"

        # Document for embedding
        content = f"""
Title: {title}
Abstract: {abstract}
Authors: {row["authors"]}
Journal: {row["journal_name"]}
Year: {row["date"]}
""".strip()

        # Metadata - include all fields for search results
        snippet = abstract[:200].strip() + ("..." if len(abstract) > 200 else "")

        contents.append(content)
        metadatas.append({
            "title": title,
            "authors": row["authors"],
            "journal": row["journal_name"],
            "year": row["date"],
            "doi": doi,
            "url": link,
            "abstract_snippet": snippet,
            "abstract": abstract,  # Full abstract
            "access_link": link,
            "vhbRanking": safe_str(row.get("vhbRanking", "")),
            "abdcRanking": safe_str(row.get("abdcRanking", "")),
            "citations": safe_str(row.get("citations", ""))
        })
        ids.append(doi)

    return contents, metadatas, ids


def create_vector_store(contents, metadatas, ids, db_path, collection_name):
    """Create ChromaDB vector store with better lock handling"""
    import shutil
    import time

    print("\n[EMBED] Generating embeddings...")

    model = load_embedding_model()
    embeddings = model.encode(contents, normalize_embeddings=True).tolist()

    # Force close any existing connections
    if os.path.exists(db_path):
        print("[CLEANUP] Cleaning up old database...")
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                shutil.rmtree(db_path)
                print("[OK] Old database removed")
                break
            except PermissionError:
                if attempt < max_attempts - 1:
                    print(f"[WARN] Database locked, retrying ({attempt + 1}/{max_attempts})...")
                    time.sleep(2)
                else:
                    # Use a new path if still locked
                    db_path = f"{db_path}_{int(time.time())}"
                    print(f"[WARN] Using new path: {db_path}")

    client = PersistentClient(path=db_path)
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"}
    )

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=contents,
        metadatas=metadatas
    )

    print(f"[OK] Indexed {len(ids)} documents")


class HybridSearchEngine:
    """Combines semantic search + knowledge graph"""

    def __init__(self, db_path, collection_name, neo4j_url, neo4j_user, neo4j_pass, llm_model="llama3.2"):
        print("\n[INIT] Initializing Hybrid Search Engine...")

        # LLM - Using faster model by default
        self.llm = OllamaLLM(
            model=llm_model,
            temperature=0.2,
            num_predict=int(os.getenv("LLM_NUM_PREDICT", "256")),
            keep_alive=os.getenv("OLLAMA_KEEP_ALIVE", "10m"),
            timeout=120
        )
        print(f"[OK] LLM loaded ({llm_model})")

        # Vector store
        self.vector_model = load_embedding_model()
        self.collection = PersistentClient(path=db_path).get_collection(collection_name)
        print("[OK] Vector store connected")

        # Knowledge graph - plain neo4j driver for direct Cypher (no APOC).
        # The LangChain Neo4jGraph/GraphCypherQAChain path is intentionally not used:
        # it runs a schema refresh on every init and the app relies on the direct-Cypher
        # patterns in graph_search() instead.
        self.graph_chain = None
        self.graph = None
        self.neo4j_driver = None
        try:
            self.neo4j_driver = GraphDatabase.driver(neo4j_url, auth=(neo4j_user, neo4j_pass))
            with self.neo4j_driver.session() as session:
                session.run("RETURN 1 as test").single()
            self.graph_available = True
            print("[OK] Knowledge graph connected (direct Cypher)")
        except Exception as e:
            print(f"[WARN] Neo4j connection failed: {e}")
            self.graph_available = False

    def _run_cypher(self, cypher: str, params: dict = None) -> list:
        """Run Cypher query using plain neo4j driver"""
        if not self.neo4j_driver:
            return []
        with self.neo4j_driver.session() as session:
            result = session.run(cypher, params or {})
            return [dict(record) for record in result]

    def should_use_graph(self, query: str) -> bool:
        """Check if query needs graph data"""
        if not self.graph_available:
            print("   [DEBUG] Graph not available")
            return False

        query_lower = query.lower()

        # Check for author-related patterns
        author_patterns = ["written", "wrote", "author", "papers by", "paper by", "works by",
                          "collaborated", "collaborate", "co-author", "coauthor", "co-authored",
                          "topics by", "write about", "research by", "what does", "publication",
                          "did", "together", "joint"]
        for pattern in author_patterns:
            if pattern in query_lower:
                print(f"   [DEBUG] Found '{pattern}' in query")
                return True

        # Check for quoted author names (strong signal for graph query)
        import re
        if re.search(r"['\"][^'\"]+['\"]", query):
            print(f"   [DEBUG] Found quoted names in query - using graph search")
            return True

        # Check for keyword-related queries
        if any(kw in query_lower for kw in ["keyword", "topic", "about", "related to", "papers on", "paper on", "research on"]):
            print(f"   [DEBUG] Found keyword/topic pattern in query")
            return True

        print(f"   [DEBUG] No graph patterns matched in: {query_lower}")
        return False

    def semantic_search(self, query: str, max_results: int = 10, threshold: float = 0.25):
        """
        Semantic search via embeddings.
        Returns all papers with similarity >= threshold, up to max_results.

        Note: with the all-MiniLM-L6-v2 model, cosine similarities between a
        short query and full title+abstract documents typically fall in the
        0.2-0.4 range even for relevant matches, so the threshold is kept low
        and the LLM prompt acts as the final relevance gate. Tune if needed.
        """
        q_emb = self.vector_model.encode(query, normalize_embeddings=True).tolist()

        # Fetch more results initially, then filter by threshold
        results = self.collection.query(
            query_embeddings=[q_emb],
            n_results=max_results,
            include=["metadatas", "distances", "documents"]
        )

        distances = results["distances"][0]
        similarities = [1 - d for d in distances]

        # Filter results by threshold
        filtered_indices = [i for i, sim in enumerate(similarities) if sim >= threshold]

        if not filtered_indices:
            return None, None, 0

        # Build filtered results
        filtered_results = {
            "ids": [[results["ids"][0][i] for i in filtered_indices]],
            "documents": [[results["documents"][0][i] for i in filtered_indices]],
            "metadatas": [[results["metadatas"][0][i] for i in filtered_indices]],
            "distances": [[results["distances"][0][i] for i in filtered_indices]]
        }
        filtered_similarities = [similarities[i] for i in filtered_indices]

        return filtered_results, filtered_similarities, filtered_similarities[0]

    def classify_intent(self, query: str) -> dict:
        """Use LLM to classify the query intent"""
        prompt = f"""Classify this research query into ONE category. Reply with ONLY the category name.

Categories:
- PAPERS_BY_AUTHOR: Find papers written by a specific author (e.g., "papers by Smith", "what did Allen write?")
- TOPICS_BY_AUTHOR: Find research topics/keywords of an author (e.g., "what topics does Smith research?", "what does Allen write about?")
- COLLABORATIONS: Find who collaborated with an author (e.g., "who worked with Kim?", "collaborators of Smith")
- PAPERS_BY_TOPIC: Find papers about a topic (e.g., "papers about AI", "research on machine learning")
- LIST_AUTHORS: List all authors (e.g., "show all authors", "list authors")
- LIST_TOPICS: List all topics/keywords (e.g., "what topics are covered?", "list keywords")
- CONCEPT_QUESTION: General question about a concept (e.g., "what is machine learning?", "explain AI")
- OTHER: Doesn't fit any category

Query: "{query}"

Category:"""

        try:
            response = self.llm.invoke(prompt).strip().upper()
            # Extract just the category name
            for cat in ["PAPERS_BY_AUTHOR", "TOPICS_BY_AUTHOR", "COLLABORATIONS",
                       "PAPERS_BY_TOPIC", "LIST_AUTHORS", "LIST_TOPICS", "CONCEPT_QUESTION"]:
                if cat in response:
                    print(f"   [Intent] LLM classified as: {cat}")
                    return {"intent": cat, "confidence": "high"}
            print(f"   [Intent] LLM response unclear: {response[:50]}, defaulting to OTHER")
            return {"intent": "OTHER", "confidence": "low"}
        except Exception as e:
            print(f"   [Intent] Classification failed: {e}")
            return {"intent": "OTHER", "confidence": "error"}

    def _rule_based_intent(self, q: str):
        """
        Deterministic intent detection for clear query patterns, preferred over the
        LLM classifier (which is unreliable on terse/lowercase queries). q is the
        lower-cased query. Returns an intent string or None.
        """
        import re
        quoted = re.findall(r"['\"][^'\"]+['\"]", q)
        if re.search(r'collaborat|co-?author|worked?\s+with|\btogether\b|\bjoint\b', q) or len(quoted) >= 2:
            return "COLLABORATIONS"
        if re.search(r'(topics?|keywords?)\s+(by|of|from)\b|what\s+does\s+\w+\s+(write|research|study)', q):
            return "TOPICS_BY_AUTHOR"
        if re.search(r'papers?\s+by\b|written\s+by\b|wrote\s+by\b|authored\s+by\b|works?\s+by\b', q):
            return "PAPERS_BY_AUTHOR"
        if re.search(r'\b(list|show)\b.*\bauthors?\b|\ball\s+authors\b', q):
            return "LIST_AUTHORS"
        if re.search(r'\b(list|show|all|which|what)\b.*\b(topics?|keywords?)\b', q):
            return "LIST_TOPICS"
        if re.search(r'papers?\s+(about|on)\b|research\s+on\b|related\s+to\b', q):
            return "PAPERS_BY_TOPIC"
        return None

    def graph_search(self, query: str):
        """Query knowledge graph with direct queries for common patterns"""
        if not self.graph_available:
            return {"success": False, "error": "Graph unavailable"}

        try:
            query_lower = query.lower()

            # Resolve clear structural questions without calling the LLM. This
            # is both more reliable and much faster for exact graph lookups.
            rule_intent = self._rule_based_intent(query_lower)
            if rule_intent:
                intent = rule_intent
                print(f"   [Intent] Rule-based classification: {rule_intent}")
            else:
                print("   [Intent] No deterministic match; classifying with LLM...")
                intent_result = self.classify_intent(query)
                intent = intent_result["intent"]

            # Extract author name more intelligently
            def extract_author_name(text):
                """Extract an author name from the query (case-insensitive)."""
                import re

                # Common words that are NOT names
                common_words = {'which', 'who', 'what', 'paper', 'papers', 'author', 'authors',
                               'written', 'wrote', 'write', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
                               'find', 'show', 'list', 'all', 'about', 'on', 'in', 'by', 'from', 'with',
                               'topics', 'topic', 'does', 'did', 'do', 'research', 'collaborate',
                               'collaborated', 'work', 'worked', 'keywords', 'keyword', 'me', 'and'}

                # Pattern 1: "by/from/of/with [Name]" - name after a preposition (any case)
                match = re.search(r'\b(?:by|from|of|with)\s+([A-Za-zäöüßÄÖÜ][\w\-]*)', text, re.IGNORECASE)
                if match:
                    name = match.group(1).strip("?,.")
                    if name.lower() not in common_words:
                        return name

                # Pattern 2: "does [Name] write/research/..." (any case)
                match = re.search(r'does\s+([A-Za-zäöüßÄÖÜ][\w\-]*)\s+(?:write|research|work|study)', text, re.IGNORECASE)
                if match:
                    name = match.group(1).strip("?,.")
                    if name.lower() not in common_words:
                        return name

                # Pattern 3: first meaningful token - prefer a capitalized word, else any word
                words = [w.strip("?,.") for w in text.split()]
                for word in words:
                    if len(word) > 1 and word[0].isupper() and word.lower() not in common_words:
                        return word
                for word in words:
                    if len(word) > 1 and word.isalpha() and word.lower() not in common_words:
                        return word

                return None

            def extract_multiple_authors(text):
                """Extract multiple author names from query, especially quoted names"""
                import re
                authors = []

                # Pattern 1: Names in single or double quotes like 'Ahmadi, Leila' or "Bilal, Muhammad"
                quoted_names = re.findall(r"['\"]([^'\"]+)['\"]", text)
                for name in quoted_names:
                    name = name.strip()
                    if name and len(name) > 2:
                        authors.append(name)

                # Pattern 2: Names in format "Last, First" without quotes
                if not authors:
                    name_pattern = re.findall(r'\b([A-Z][a-zA-Z]+,\s*[A-Z][a-zA-Z]+)\b', text)
                    authors.extend(name_pattern)

                return authors

            # Route based on LLM intent classification
            # Pattern 1: Papers by author
            if intent == "PAPERS_BY_AUTHOR":
                author_name = extract_author_name(query)

                if author_name:
                    # Case-insensitive search using toLower()
                    search_name = author_name.lower()
                    cypher = """
                    MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                    WHERE toLower(a.name) CONTAINS $name
                    RETURN a.name as author, p.title as title, p.doi as doi
                    LIMIT 10
                    """
                    results = self._run_cypher(cypher, {"name": search_name})

                    if results:
                        result_text = f"Found {len(results)} paper(s) by authors matching '{author_name}':\n"
                        dois = []
                        for r in results:
                            result_text += f"\n• '{r['title']}' by {r['author']}"
                            if r.get('doi'):
                                dois.append(r['doi'])
                        return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}
                    else:
                        # Try last name only
                        last_name = author_name.split()[-1].lower()
                        cypher = """
                        MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                        WHERE toLower(a.name) CONTAINS $name
                        RETURN a.name as author, p.title as title, p.doi as doi
                        LIMIT 10
                        """
                        results = self._run_cypher(cypher, {"name": last_name})

                        if results:
                            result_text = f"Found {len(results)} paper(s) by authors with last name '{last_name}':\n"
                            dois = []
                            for r in results:
                                result_text += f"\n• '{r['title']}' by {r['author']}"
                                if r.get('doi'):
                                    dois.append(r['doi'])
                            return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}

            # Pattern 2: Collaboration queries (single or multiple authors)
            if intent == "COLLABORATIONS":
                # First try to extract multiple authors from quotes
                authors = extract_multiple_authors(query)
                print(f"   [DEBUG] Extracted authors: {authors}")

                if len(authors) >= 2:
                    # Multiple authors specified - find papers they co-authored together
                    # Build dynamic Cypher query for N authors
                    match_clauses = []
                    where_clauses = []
                    params = {}
                    for i, author in enumerate(authors):
                        match_clauses.append(f"(a{i}:Author)-[:AUTHORED]->(p)")
                        # Match by last name (first part before comma) for better accuracy
                        last_name = author.split(',')[0].strip().lower() if ',' in author else author.lower()
                        where_clauses.append(f"toLower(a{i}.name) CONTAINS $a{i}")
                        params[f"a{i}"] = last_name

                    cypher = f"""
                    MATCH (p:Paper)
                    MATCH {', '.join(match_clauses)}
                    WHERE {' AND '.join(where_clauses)}
                    RETURN p.title as title, p.doi as doi, [{', '.join([f'a{i}.name' for i in range(len(authors))])}] as authors
                    LIMIT 10
                    """
                    print(f"   [DEBUG] Multi-author Cypher: {cypher}")
                    results = self._run_cypher(cypher, params)

                    if results:
                        result_text = f"Found {len(results)} publication(s) co-authored by {' and '.join(authors)}:\n"
                        dois = []
                        for r in results:
                            result_text += f"\n• '{r['title']}'"
                            if r.get('authors'):
                                result_text += f"\n  Authors: {', '.join(r['authors'])}"
                            if r.get('doi'):
                                dois.append(r['doi'])
                        return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}
                    else:
                        # No results - provide helpful message
                        result_text = f"No publications found where {' and '.join(authors)} collaborated together.\n"
                        result_text += "This could mean:\n• The authors haven't co-authored papers in this dataset\n• The author names may be spelled differently in the database"
                        return {"success": True, "cypher": cypher, "result": result_text, "dois": []}

                else:
                    # Single author - find all their collaborators
                    author_name = extract_author_name(query) or (authors[0] if authors else None)

                    if author_name:
                        search_name = author_name.lower()
                        last_name = search_name.split(',')[0].strip() if ',' in search_name else search_name
                        cypher = """
                        MATCH (a1:Author)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(a2:Author)
                        WHERE toLower(a1.name) CONTAINS $name
                        AND a1 <> a2
                        RETURN DISTINCT a2.name as collaborator, p.title as paper, p.doi as doi
                        LIMIT 10
                        """
                        results = self._run_cypher(cypher, {"name": last_name})

                        if results:
                            papers = {}
                            for r in results:
                                key = r.get('doi') or r.get('paper')
                                paper = papers.setdefault(key, {
                                    "title": r.get('paper'), "doi": r.get('doi'),
                                    "collaborators": []
                                })
                                if r.get('collaborator') not in paper["collaborators"]:
                                    paper["collaborators"].append(r.get('collaborator'))

                            dois = [p["doi"] for p in papers.values() if p.get("doi")]
                            sentences = []
                            for index, paper in enumerate(papers.values(), start=1):
                                names = paper["collaborators"]
                                collaborators = (names[0] if len(names) == 1
                                                 else f"{', '.join(names[:-1])} and {names[-1]}")
                                sentences.append(
                                    f"{author_name} collaborated with {collaborators} on "
                                    f"\"{paper['title']}\" [{index}]."
                                )
                            return {
                                "success": True, "cypher": cypher,
                                "result": " ".join(sentences), "dois": dois,
                                "answer_mode": "exact_graph_lookup", "intent": intent
                            }

            # Pattern 3: "papers by same author" or "authors with multiple papers"
            if "same author" in query_lower or "multiple papers" in query_lower:
                cypher = """
                MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                WITH a, count(p) as paper_count, collect(p.title) as papers
                WHERE paper_count > 1
                RETURN a.name as author, paper_count, papers
                ORDER BY paper_count DESC
                """
                results = self._run_cypher(cypher)

                if results:
                    result_text = "Authors with multiple papers:\n"
                    for r in results:
                        result_text += f"\n• {r['author']} ({r['paper_count']} papers):"
                        for paper in r['papers']:
                            result_text += f"\n  - {paper}"
                    return {"success": True, "cypher": cypher, "result": result_text}

            # Pattern 4: List all authors
            if intent == "LIST_AUTHORS":
                cypher = """
                MATCH (a:Author)
                RETURN a.name as author
                ORDER BY a.name
                """
                results = self._run_cypher(cypher)

                if results:
                    result_text = f"All authors in database ({len(results)} total):\n"
                    for r in results:
                        result_text += f"\n• {r['author']}"
                    return {"success": True, "cypher": cypher, "result": result_text}

            # Pattern 5: Papers by keyword/topic
            if intent == "PAPERS_BY_TOPIC":
                # Extract the topic/keyword from query
                import re
                topic_match = re.search(r'(?:about|on|topic|keyword)[:\s]+["\']?([^"\'?,]+)["\']?', query_lower)
                if topic_match:
                    topic = topic_match.group(1).strip()
                else:
                    # Try to extract any quoted term or the last significant word
                    words = query_lower.replace("?", "").split()
                    topic = words[-1] if words else None

                if topic:
                    cypher = f"""
                    MATCH (p:Paper)-[:HAS_KEYWORD]->(k:Keyword)
                    WHERE toLower(k.name) CONTAINS toLower($topic)
                    RETURN DISTINCT p.title as title, p.doi as doi, collect(k.name) as keywords
                    LIMIT 10
                    """
                    results = self._run_cypher(cypher, {"topic": topic})

                    if results:
                        result_text = f"Found {len(results)} paper(s) related to '{topic}':\n"
                        dois = []
                        for r in results:
                            keywords_str = ", ".join(r['keywords'][:3]) if r['keywords'] else ""
                            result_text += f"\n• '{r['title']}' (keywords: {keywords_str})"
                            if r.get('doi'):
                                dois.append(r['doi'])
                        return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}

            # Pattern 6: Topics/keywords by specific author
            if intent == "TOPICS_BY_AUTHOR":
                author_name = extract_author_name(query)
                if author_name:
                    search_name = author_name.lower()
                    cypher = """
                    MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                    WHERE toLower(a.name) CONTAINS $name
                    OPTIONAL MATCH (p)-[:HAS_KEYWORD]->(k:Keyword)
                    RETURN a.name as author, p.title as title, p.doi as doi,
                           collect(DISTINCT k.name) as keywords
                    LIMIT 20
                    """
                    results = self._run_cypher(cypher, {"name": search_name})

                    if results:
                        dois = list(dict.fromkeys(r['doi'] for r in results if r.get('doi')))
                        publications = []
                        for r in results:
                            keyword_text = ", ".join(k for k in r.get('keywords', []) if k)
                            suffix = f"; indexed keywords: {keyword_text}" if keyword_text else ""
                            publications.append(f"- {r['author']} co-authored '{r['title']}'{suffix}")
                        result_text = (
                            f"Publications associated with author '{author_name}':\n"
                            + "\n".join(publications)
                        )
                        return {
                            "success": True, "cypher": cypher,
                            "result": result_text, "dois": dois,
                            "intent": intent
                        }

            # Pattern 7: List all keywords/topics
            if intent == "LIST_TOPICS":
                cypher = """
                MATCH (k:Keyword)<-[:HAS_KEYWORD]-(p:Paper)
                WITH k.name as keyword, k.type as type, count(p) as paper_count
                RETURN keyword, type, paper_count
                ORDER BY paper_count DESC
                LIMIT 30
                """
                results = self._run_cypher(cypher)

                if results:
                    result_text = f"Top keywords/topics ({len(results)} shown):\n"
                    for r in results:
                        type_label = f" [{r['type']}]" if r.get('type') else ""
                        result_text += f"\n• {r['keyword']}{type_label} ({r['paper_count']} papers)"
                    return {"success": True, "cypher": cypher, "result": result_text}

            # Fallback: Use LLM to generate Cypher (if available) or suggest alternatives
            if self.graph_chain:
                response = self.graph_chain.invoke({"query": query})

                cypher = "N/A"
                if "intermediate_steps" in response and response["intermediate_steps"]:
                    cypher = response["intermediate_steps"][0].get("query", "N/A")

                result_text = response.get("result", "No results")

                # If LLM result is empty, provide helpful message
                if not result_text or "don't know" in result_text.lower():
                    result_text = "No results found. Try queries like:\n• 'Which papers were written by Klaus?'\n• 'Who collaborated with Maklan?'\n• 'Show me authors with multiple papers'"

                return {
                    "success": True,
                    "cypher": cypher,
                    "result": result_text
                }
            else:
                # No LangChain QA chain available, provide helpful message
                return {
                    "success": False,
                    "cypher": None,
                    "result": "No results found - the author or topic may not be in the uploaded dataset. Try:\n• 'Papers written by [Author Name]'\n• 'Who collaborated with [Author Name]'\n• 'Papers about [topic]'\n• 'List all authors'\n• 'What topics are covered?'"
                }

        except Exception as e:
            return {"success": False, "error": str(e), "result": f"Error: {e}"}

    def _fetch_graph_sources(self, query: str, graph_dois: list):
        """
        Fetch metadata for papers found through the knowledge graph.
        When the query names a topic (e.g. "... about service quality"), re-rank
        those papers by semantic relevance to that topic. Returns (sources,
        similarities) as two aligned lists.
        """
        import re

        unique_dois = list(dict.fromkeys(graph_dois))
        if not unique_dois:
            return [], []

        try:
            topic_match = re.search(
                r'(?:about|on|regarding)\s+([^?]+?)(?:\s+by\s+|\s*\??$)',
                query, re.IGNORECASE
            )
            topic = topic_match.group(1).strip() if topic_match else None

            # Hybrid: author's papers ranked by relevance to the requested topic
            if topic and len(unique_dois) > 1:
                data = self.collection.get(ids=unique_dois, include=["metadatas", "embeddings"])
                metas = data.get("metadatas") or []
                embs = data.get("embeddings")
                if metas and embs is not None and len(embs):
                    import numpy as np
                    topic_emb = self.vector_model.encode(topic, normalize_embeddings=True)
                    scored = []
                    for i, meta in enumerate(metas):
                        sim = float(np.dot(topic_emb, embs[i])) if i < len(embs) else 0.5
                        scored.append((meta, sim))
                    scored.sort(key=lambda x: x[1], reverse=True)
                    print(f"   [GRAPH] Ranked {len(scored)} graph papers by topic '{topic}'")
                    return [m for m, _ in scored], [s for _, s in scored]

            # Plain graph matches are structurally exact, but that must not be
            # represented as 100% semantic similarity. Calculate an independent
            # query-to-document score for hybrid/generative uses of these papers.
            data = self.collection.get(ids=unique_dois, include=["metadatas", "embeddings"])
            metas = data.get("metadatas") or []
            embs = data.get("embeddings")
            if metas and embs is not None and len(embs):
                import numpy as np
                query_emb = self.vector_model.encode(query, normalize_embeddings=True)
                similarities = [float(np.dot(query_emb, emb)) for emb in embs]
                return metas, similarities
            return metas, [0.0] * len(metas)
        except Exception as e:
            print(f"   [WARN] Could not fetch graph metadata: {e}")
            return [], []

    def _format_source(self, index: int, meta: dict) -> str:
        """Format a single source paper for the LLM prompt with a [n] citation tag."""
        title = safe_str(meta.get("title", "")) or "Unknown"
        authors = safe_str(meta.get("authors", ""))
        first_author = authors.split(";")[0].split(",")[0].strip() if authors else "Unknown"
        year = safe_str(meta.get("year", "")) or safe_str(meta.get("date", ""))
        abstract = (safe_str(meta.get("abstract", ""))
                    or safe_str(meta.get("abstract_snippet", ""))
                    or "No abstract available")
        return f"[{index + 1}] {title} ({first_author}, {year[:4]}): {abstract}"

    def _diverse_corpus_sources(self, limit: int = 6) -> list:
        """Select representative papers spanning the embedding space."""
        import numpy as np

        data = self.collection.get(include=["metadatas", "embeddings"])
        metas = data.get("metadatas") or []
        embeddings = data.get("embeddings")
        if not metas or embeddings is None or not len(embeddings):
            return metas[:limit]

        matrix = np.asarray(embeddings, dtype=float)
        centroid = matrix.mean(axis=0)
        first = int(np.argmax(matrix @ centroid))
        selected = [first]
        while len(selected) < min(limit, len(metas)):
            similarities = matrix @ matrix[selected].T
            nearest_selected = similarities.max(axis=1)
            nearest_selected[selected] = np.inf
            selected.append(int(np.argmin(nearest_selected)))
        return [metas[i] for i in selected]

    def _build_answer_prompt(self, query: str, source_context: str,
                             graph_context: str = "", graph_backed: bool = False,
                             query_intent: str = None) -> str:
        """
        Build the grounded-answer prompt for the LLM.

        graph_backed=True means the sources were retrieved through a definitive
        knowledge-graph match (author / collaboration / topic), so they are
        relevant by construction and the model should NOT decline.
        """
        graph_block = ""
        if graph_context:
            graph_block = (
                "\nGRAPH CONTEXT (relationships found in the knowledge graph):\n"
                f"{graph_context}\n"
            )

        if query_intent == "PAPERS_BY_TOPIC":
            return f"""You are a research-paper discovery assistant. The user wants papers related to a topic, not papers exclusively devoted to that topic.

QUESTION: {query}

RETRIEVED SOURCES:
{source_context}

RULES:
1. Treat every retrieved source as a candidate paper related to the requested topic.
2. Do not reject a paper merely because it studies the topic in a specific application domain.
3. For each source, write exactly one line of at most 18 words explaining how it addresses the topic.
4. Start each line with [1], [2], [3]. Do not repeat paper titles; they are already visible in the UI.
5. The first character of the answer must be "[". Add no introduction, heading, conclusion, or bullet symbol.
6. Use only title and abstract evidence. If a source is genuinely unrelated, omit it silently.

ANSWER:"""

        if query_intent == "LIST_TOPICS":
            return f"""You are summarizing the thematic coverage of a research-paper corpus. The sources below are a diverse representative sample selected from the full corpus using embeddings.

QUESTION: {query}

REPRESENTATIVE SOURCES:
{source_context}

RULES:
1. Identify exactly 4 broad research themes covered across the representative papers.
2. Write one line of at most 16 words per theme, starting with a short theme name in bold.
3. Support every theme with one or more source citations such as [1] or [2][4].
4. Use only the supplied titles and abstracts. Do not claim that one paper represents the entire corpus.
5. Start directly with the themes; no introduction or conclusion.

ANSWER:"""

        if graph_backed:
            return f"""You are a research assistant. The papers below were retrieved from a knowledge graph because they match what the QUESTION asks about (an author, a collaboration, or a topic). Use them together with the GRAPH CONTEXT to answer.

QUESTION: {query}

SOURCES:
{source_context}
{graph_block}
RULES:
1. These sources were selected because they match the QUESTION, so treat them as relevant - do NOT reply that you cannot answer.
2. Use ONLY the information in the sources and graph context; do not add outside knowledge.
3. Explain what the paper(s) are and how they relate to the question, citing them as [1], [2], [3].
4. For topic questions, synthesize themes directly from each source's title and abstract. A graph author-paper relationship means the author co-authored that source.
5. Never describe the bibliographic database name (such as Scopus or WoS) as a research topic.
6. Keep it concise: at most 2 short paragraphs.

ANSWER:"""

        return f"""You are a research assistant. Answer the QUESTION using ONLY the provided sources.

QUESTION: {query}

SOURCES:
{source_context}
{graph_block}
RULES:
1. Use ONLY information from the sources; do not use outside knowledge.
2. Decline ONLY if the sources are clearly about entirely different subjects than the QUESTION. In that case respond EXACTLY with:
   "I cannot answer this question based on the available research papers. The uploaded documents do not contain relevant information about this topic. Please try a different question related to the papers in your dataset."
3. Otherwise answer using the relevant sources, citing them as [1], [2], [3], in 2-3 paragraphs.

ANSWER:"""

    def hybrid_answer(self, query: str):
        """Main hybrid search method"""
        import time as time_module

        print(f"\n{'=' * 60}")
        print(f"[QUERY] {query}")
        print(f"{'=' * 60}")

        # Transparency tracking
        transparency = {
            "steps": [],
            "timing": {},
            "methods_used": []
        }
        total_start = time_module.time()

        # Decide whether the query needs the knowledge graph
        use_graph = self.should_use_graph(query)
        print(f"\n[CHECK] Graph search needed: {use_graph}")

        # Step 1: Semantic search (always runs)
        print("\n[SEARCH] Running semantic search...")
        step_start = time_module.time()
        vector_results, similarities, best_score = self.semantic_search(query)
        transparency["timing"]["semantic_search"] = round(time_module.time() - step_start, 2)
        transparency["methods_used"].append("Semantic Search (ChromaDB + Embeddings)")
        transparency["steps"].append({
            "name": "Semantic Search",
            "description": f"Searched {self.collection.count()} documents using sentence embeddings",
            "result": f"Found {len(similarities)} relevant papers (best match: {best_score:.1%})" if similarities else "No semantic matches found"
        })

        # Step 2: Knowledge-graph search (runs ONCE, only when the query needs it)
        graph_response = None
        graph_context = ""
        cypher_query = None
        graph_dois = []
        if self.graph_available and use_graph:
            print("\n[GRAPH] Running knowledge graph search...")
            step_start = time_module.time()
            graph_response = self.graph_search(query)
            transparency["timing"]["graph_search"] = round(time_module.time() - step_start, 2)

            if graph_response.get("success"):
                graph_context = graph_response.get("result", "") or ""
                cypher_query = graph_response.get("cypher")
                graph_dois = graph_response.get("dois", []) or []
                transparency["methods_used"].append("Knowledge Graph (Neo4j)")
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Queried Neo4j knowledge graph for structured relationships",
                    "result": f"Found {len(graph_dois)} matching paper(s)" if graph_dois else "Found graph results",
                    "cypher": cypher_query
                })
                print(f"[OK] Graph search found {len(graph_dois)} matching DOIs")
            else:
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Queried Neo4j knowledge graph",
                    "result": graph_response.get("error", "No graph results found")
                })
                print(f"[INFO] Graph search: {str(graph_response.get('result', 'No results'))[:100]}")
        else:
            transparency["steps"].append({
                "name": "Graph Search",
                "description": "Skipped - query doesn't need graph patterns" if self.graph_available else "Knowledge graph unavailable",
                "result": "Not needed for this query type" if self.graph_available else "Neo4j not connected"
            })

        # Step 3: Build the candidate source set.
        # Papers found through the graph take priority (with topic re-ranking when the
        # query names a topic); otherwise we fall back to the semantic matches.
        graph_sources, graph_similarities = [], []
        if graph_dois:
            print(f"[COMBINE] Using graph results as primary source ({len(graph_dois)} papers)")
            graph_sources, graph_similarities = self._fetch_graph_sources(query, graph_dois)

        # Neo4j already contains the complete answer for exact structural
        # lookups. Avoid a slow generative pass and do not present a categorical
        # graph match as a semantic confidence score.
        structural_intent = self._rule_based_intent(query.lower())
        exact_structural_intents = {
            # These intents can be answered completely from explicit graph
            # records. Topic questions still need RAG synthesis over abstracts.
            "PAPERS_BY_AUTHOR", "COLLABORATIONS", "LIST_AUTHORS", "LIST_TOPICS"
        }
        is_exact_graph_lookup = bool(
            graph_response and graph_response.get("success")
            and (graph_response.get("answer_mode") == "exact_graph_lookup"
                 or structural_intent in exact_structural_intents)
        )
        if is_exact_graph_lookup:
            transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
            transparency["methods_used"].append("Deterministic graph answer")
            transparency["steps"].append({
                "name": "Answer construction",
                "description": "Formatted exact Neo4j records without LLM generation",
                "result": "Exact structural answer with supporting citations"
            })
            return {
                "answer": graph_context,
                "sources": graph_sources,
                "similarities": [None] * len(graph_sources),
                "best_score": None,
                "graph_used": True,
                "match_type": "exact_graph_match",
                "answer_mode": "deterministic",
                "query_intent": graph_response.get("intent") or structural_intent,
                "cypher_query": cypher_query,
                "transparency": transparency,
            }

        # 3a) Graph produced a structured list answer (e.g. "list all authors") with no
        #     specific papers to cite -> return that list directly.
        graph_is_list_answer = bool(
            graph_context
            and not graph_sources
            and "No publications found" not in graph_context
            and "No results" not in graph_context
        )
        if graph_is_list_answer:
            transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
            return {
                "answer": graph_context,
                "sources": [],
                "similarities": [],
                "best_score": 0,
                "graph_used": True,
                "cypher_query": cypher_query,
                "transparency": transparency
            }

        # 3b) Nothing found by either method.
        if vector_results is None and not graph_sources:
            transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
            no_result_msg = "No relevant papers found in the database."
            if graph_response and graph_response.get("result"):
                no_result_msg = graph_response.get("result")
            return {
                "answer": no_result_msg,
                "sources": [],
                "similarities": [],
                "best_score": 0,
                "graph_used": bool(graph_response and graph_response.get("success")),
                "transparency": transparency
            }

        # Choose the primary sources for answer synthesis
        corpus_overview = bool(
            structural_intent == "LIST_TOPICS"
            and not (graph_response and graph_response.get("success"))
        )
        if corpus_overview:
            final_sources = self._diverse_corpus_sources(limit=6)
            final_similarities = [None] * len(final_sources)
            final_score = None
        elif graph_sources:
            final_sources = graph_sources
            final_similarities = graph_similarities
            final_score = max(graph_similarities) if graph_similarities else 1.0
        else:
            final_sources = vector_results["metadatas"][0]
            final_similarities = similarities
            final_score = best_score

        score_text = f"{final_score:.3f}" if final_score is not None else "n/a"
        print(f"[OK] Answering from {len(final_sources)} source(s) (score: {score_text})")

        # Step 4: Build the grounded context for the LLM from the chosen sources
        if corpus_overview:
            # Full abstracts from several diverse papers are expensive for a
            # CPU-only local LLM. Titles plus stored snippets retain enough
            # thematic signal for corpus mapping while keeping prompt latency sane.
            source_context = "\n".join(
                f"[{i + 1}] {safe_str(meta.get('title'))}: "
                f"{safe_str(meta.get('abstract_snippet'))[:200]}"
                for i, meta in enumerate(final_sources)
            )
        else:
            source_context = "\n\n".join(
                self._format_source(i, meta) for i, meta in enumerate(final_sources)
            )

        # Step 5: Synthesize the final answer with the local LLM
        print("\n[LLM] Generating answer (this may take 10-30 seconds)...")
        step_start = time_module.time()
        prompt = self._build_answer_prompt(
            query, source_context,
            graph_context if graph_dois else "",
            graph_backed=bool(graph_dois),
            query_intent=(graph_response or {}).get("intent") or structural_intent,
        )

        try:
            answer = self.llm.invoke(prompt)
            transparency["timing"]["llm_generation"] = round(time_module.time() - step_start, 2)
            transparency["methods_used"].append("LLM Answer Generation (Ollama)")
            transparency["steps"].append({
                "name": "LLM Generation",
                "description": "Generated answer using local LLM model",
                "result": f"Answer generated in {transparency['timing']['llm_generation']}s"
            })
            print("[OK] Answer generated")
        except Exception as e:
            print(f"[WARN] LLM timeout or error: {e}")
            answer = "Answer generation timed out. Please try a simpler question or use a faster model."
            transparency["steps"].append({
                "name": "LLM Generation",
                "description": "LLM answer generation failed",
                "result": str(e)
            })

        transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
        transparency["prompt"] = prompt  # Include the actual prompt for full transparency

        return {
            "answer": answer,
            "sources": final_sources,
            "similarities": final_similarities,
            "best_score": final_score,
            "graph_used": bool(graph_dois),
            "match_type": "corpus_overview" if corpus_overview else None,
            "answer_mode": "generative",
            "query_intent": (graph_response or {}).get("intent") or structural_intent,
            "cypher_query": cypher_query,
            "transparency": transparency
        }
