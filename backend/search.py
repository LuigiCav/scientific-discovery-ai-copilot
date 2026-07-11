
# backend/search.py
"""
Hybrid Search Engine: Combines Vector Search (ChromaDB) + Knowledge Graph (Neo4j)
"""

import os
import shutil
from sentence_transformers import SentenceTransformer
from chromadb import PersistentClient
from langchain_ollama import OllamaLLM
from langchain_community.graphs import Neo4jGraph
from langchain_community.chains.graph_qa.cypher import GraphCypherQAChain
from langchain_core.prompts import PromptTemplate
from neo4j import GraphDatabase  # Plain driver for direct Cypher (no APOC needed)
from backend.etl import safe_str


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

    model = SentenceTransformer("all-MiniLM-L6-v2")
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
            temperature=0.7,
            num_predict=512,  # Limit response length for speed
            timeout=120  # 2 minutes timeout
        )
        print(f"[OK] LLM loaded ({llm_model})")

        # Vector store
        self.vector_model = SentenceTransformer("all-MiniLM-L6-v2")
        self.collection = PersistentClient(path=db_path).get_collection(collection_name)
        print("[OK] Vector store connected")

        # Knowledge graph - use plain neo4j driver for direct Cypher (no APOC needed)
        self.graph_chain = None
        self.neo4j_driver = None
        try:
            # Use plain neo4j driver - doesn't require APOC
            self.neo4j_driver = GraphDatabase.driver(neo4j_url, auth=(neo4j_user, neo4j_pass))

            # Test connection with a simple query
            with self.neo4j_driver.session() as session:
                result = session.run("RETURN 1 as test")
                result.single()

            self.graph_available = True
            print("[OK] Knowledge graph connected (direct Cypher)")

            # Optionally try LangChain QA chain (needs APOC - usually unavailable)
            try:
                self.graph = Neo4jGraph(url=neo4j_url, username=neo4j_user, password=neo4j_pass)
                cypher_prompt = PromptTemplate(
                    input_variables=["schema", "question"],
                    template="""You are a Neo4j expert. Write a Cypher query for this question.

Schema: {schema}
Question: {question}

Rules:
- Use MATCH to find patterns
- Use WHERE for filtering
- LIMIT results to 10
- Return only the Cypher query

Cypher Query:"""
                )

                self.graph_chain = GraphCypherQAChain.from_llm(
                    llm=self.llm,
                    graph=self.graph,
                    cypher_prompt=cypher_prompt,
                    verbose=True,
                    return_intermediate_steps=True
                )
                print("[OK] LangChain QA Chain available (APOC found)")
            except Exception as chain_error:
                # APOC not available - that's OK, we can still use direct Cypher
                print(f"[INFO] LangChain QA Chain unavailable (APOC plugin not installed)")

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

    def semantic_search(self, query: str, max_results: int = 10, threshold: float = 0.35):
        """
        Semantic search via embeddings.
        Returns all papers with similarity >= threshold, up to max_results.
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

    def graph_search(self, query: str):
        """Query knowledge graph with direct queries for common patterns"""
        if not self.graph_available:
            return {"success": False, "error": "Graph unavailable"}

        try:
            query_lower = query.lower()

            # Use LLM to classify intent
            print("   [Intent] Classifying query...")
            intent_result = self.classify_intent(query)
            intent = intent_result["intent"]

            # Extract author name more intelligently
            def extract_author_name(text):
                """Extract author name from query - case insensitive"""
                import re

                # Common words that are NOT names
                common_words = {'which', 'who', 'what', 'paper', 'papers', 'author', 'authors',
                               'written', 'wrote', 'write', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
                               'find', 'show', 'list', 'all', 'about', 'on', 'in', 'by', 'from', 'with',
                               'topics', 'topic', 'does', 'did', 'do', 'research', 'collaborate',
                               'collaborated', 'work', 'worked', 'keywords', 'keyword'}

                # Pattern 1: "by/from/of/with [Name]" - name after preposition
                match = re.search(r'\b(?:by|from|of|with)\s+([A-Z][a-zA-ZäöüßÄÖÜ]*)', text)
                if match:
                    name = match.group(1).strip("?,.")
                    if name.lower() not in common_words:
                        return name

                # Pattern 2: "[Name] write/research/collaborate" - name before verb
                match = re.search(r'does\s+([A-Z][a-zA-ZäöüßÄÖÜ]*)\s+(?:write|research|work|study)', text)
                if match:
                    name = match.group(1).strip("?,.")
                    if name.lower() not in common_words:
                        return name

                # Pattern 3: Find capitalized word that's not a common word
                words = text.split()
                for word in words:
                    clean_word = word.strip("?,.")
                    # Must start with uppercase and not be a common word
                    if clean_word and len(clean_word) > 1 and clean_word[0].isupper():
                        if clean_word.lower() not in common_words:
                            return clean_word

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
                    cypher = f"""
                    MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                    WHERE toLower(a.name) CONTAINS '{search_name}'
                    RETURN a.name as author, p.title as title, p.doi as doi
                    LIMIT 10
                    """
                    results = self._run_cypher(cypher)

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
                        cypher = f"""
                        MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                        WHERE toLower(a.name) CONTAINS '{last_name}'
                        RETURN a.name as author, p.title as title, p.doi as doi
                        LIMIT 10
                        """
                        results = self._run_cypher(cypher)

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
                    for i, author in enumerate(authors):
                        match_clauses.append(f"(a{i}:Author)-[:AUTHORED]->(p)")
                        # Use CONTAINS for flexible matching (handles "Last, First" format)
                        author_lower = author.lower()
                        # Try matching by last name (first part before comma) for better accuracy
                        last_name = author.split(',')[0].strip().lower() if ',' in author else author.lower()
                        where_clauses.append(f"toLower(a{i}.name) CONTAINS '{last_name}'")

                    cypher = f"""
                    MATCH (p:Paper)
                    MATCH {', '.join(match_clauses)}
                    WHERE {' AND '.join(where_clauses)}
                    RETURN p.title as title, p.doi as doi, [{', '.join([f'a{i}.name' for i in range(len(authors))])}] as authors
                    LIMIT 10
                    """
                    print(f"   [DEBUG] Multi-author Cypher: {cypher}")
                    results = self._run_cypher(cypher)

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
                        cypher = f"""
                        MATCH (a1:Author)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(a2:Author)
                        WHERE toLower(a1.name) CONTAINS '{last_name}'
                        AND a1 <> a2
                        RETURN DISTINCT a2.name as collaborator, p.title as paper, p.doi as doi
                        LIMIT 10
                        """
                        results = self._run_cypher(cypher)

                        if results:
                            result_text = f"Authors who collaborated with {author_name}:\n"
                            collaborators = set()
                            dois = []
                            for r in results:
                                collaborators.add(r['collaborator'])
                                if r.get('doi'):
                                    dois.append(r['doi'])
                            for collab in collaborators:
                                result_text += f"\n• {collab}"
                            return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}

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
                    cypher = f"""
                    MATCH (a:Author)-[:AUTHORED]->(p:Paper)-[:HAS_KEYWORD]->(k:Keyword)
                    WHERE toLower(a.name) CONTAINS '{search_name}'
                    WITH a.name as author, k.name as keyword, k.type as type, count(p) as paper_count, collect(DISTINCT p.title) as papers
                    RETURN author, keyword, type, paper_count, papers
                    ORDER BY paper_count DESC
                    LIMIT 20
                    """
                    results = self._run_cypher(cypher)

                    if results:
                        # Group by author
                        authors = {}
                        dois = []
                        for r in results:
                            auth = r['author']
                            if auth not in authors:
                                authors[auth] = []
                            type_label = f" [{r['type']}]" if r.get('type') else ""
                            authors[auth].append(f"{r['keyword']}{type_label}")

                        result_text = f"Topics/keywords in papers by authors matching '{author_name}':\n"
                        for auth, keywords in authors.items():
                            result_text += f"\n**{auth}:**\n"
                            for kw in keywords[:10]:  # Limit keywords per author
                                result_text += f"  • {kw}\n"

                        # Also get DOIs for sources
                        doi_cypher = f"""
                        MATCH (a:Author)-[:AUTHORED]->(p:Paper)
                        WHERE toLower(a.name) CONTAINS '{search_name}'
                        RETURN p.doi as doi
                        LIMIT 10
                        """
                        doi_results = self._run_cypher(doi_cypher)
                        dois = [r['doi'] for r in doi_results if r.get('doi')]

                        return {"success": True, "cypher": cypher, "result": result_text, "dois": dois}

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
                    "result": "No matching pattern found. Try queries like:\n• 'Papers written by [Author Name]'\n• 'Who collaborated with [Author Name]'\n• 'Papers about [topic]'\n• 'List all authors'\n• 'What topics are covered?'"
                }

        except Exception as e:
            return {"success": False, "error": str(e), "result": f"Error: {e}"}

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

        # Always check if graph search could be useful
        use_graph = self.should_use_graph(query)
        print(f"\n[CHECK] Graph search needed: {use_graph}")

        # ALWAYS run both searches for comprehensive results
        # Step 1: Semantic search
        print("\n[SEARCH] Running semantic search...")
        step_start = time_module.time()
        vector_results, similarities, best_score = self.semantic_search(query)
        transparency["timing"]["semantic_search"] = round(time_module.time() - step_start, 2)
        transparency["methods_used"].append("Semantic Search (ChromaDB + Embeddings)")
        transparency["steps"].append({
            "name": "Semantic Search",
            "description": f"Searched {self.collection.count()} documents using sentence embeddings",
            "result": f"Found {len(similarities) if similarities else 0} relevant papers (best match: {best_score:.1%})" if similarities else "No semantic matches found"
        })

        # Step 2: ALWAYS run graph search when graph is available (for better accuracy)
        graph_response = None
        graph_dois = []
        if self.graph_available:
            print("\n[GRAPH] Running knowledge graph search...")
            step_start = time_module.time()
            graph_response = self.graph_search(query)
            transparency["timing"]["graph_search"] = round(time_module.time() - step_start, 2)

            if graph_response.get("success"):
                transparency["methods_used"].append("Knowledge Graph (Neo4j)")
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Queried Neo4j knowledge graph for structured relationships",
                    "result": "Found results via graph query",
                    "cypher": graph_response.get("cypher")
                })
                graph_dois = graph_response.get("dois", [])
                print(f"[OK] Graph search found {len(graph_dois)} matching DOIs")
            else:
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Queried Neo4j knowledge graph",
                    "result": graph_response.get("error", "No graph results found")
                })
                print(f"[INFO] Graph search: {graph_response.get('result', 'No results')[:100]}")

        # Step 3: Combine results - prioritize graph results for author/collaboration queries
        # If graph found specific papers, use those; otherwise fall back to semantic
        if graph_dois:
            print(f"[COMBINE] Using graph results as primary source ({len(graph_dois)} papers)")
            try:
                # Get metadata from vector store for graph DOIs
                # Handle potential duplicates
                unique_dois = list(dict.fromkeys(graph_dois))
                graph_metadata = self.collection.get(
                    ids=unique_dois,
                    include=["metadatas"]
                )
                if graph_metadata and graph_metadata.get("metadatas"):
                    # Graph found specific papers - use these as primary results
                    sources = graph_metadata["metadatas"]
                    similarities = [1.0] * len(sources)  # Graph matches are exact
                    best_score = 1.0

                    transparency["timing"]["total"] = round(time_module.time() - total_start, 2)

                    return {
                        "answer": graph_response["result"],
                        "sources": sources,
                        "similarities": similarities,
                        "best_score": best_score,
                        "graph_used": True,
                        "cypher_query": graph_response.get("cypher"),
                        "transparency": transparency
                    }
            except Exception as e:
                print(f"   [WARN] Could not fetch graph metadata: {e}")

        # If no graph results with DOIs but graph had a text answer, still use it
        if graph_response and graph_response.get("success") and graph_response.get("result"):
            graph_text = graph_response.get("result", "")
            # Check if graph found meaningful results (not just "no results" messages)
            if graph_text and "No publications found" not in graph_text and "No results" not in graph_text:
                # Graph has useful info but no DOIs - return graph answer
                transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
                return {
                    "answer": graph_text,
                    "sources": [],
                    "similarities": [],
                    "best_score": 0,
                    "graph_used": True,
                    "cypher_query": graph_response.get("cypher"),
                    "transparency": transparency
                }

        # Fall back to semantic results if no graph results
        if vector_results is None:
            # No results from either search
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

        print(f"[OK] Found {len(vector_results['documents'][0])} papers (score: {best_score:.3f})")

        # Extract context with numbered citations
        docs = vector_results["documents"][0]
        metas = vector_results["metadatas"][0]
        semantic_context = "\n\n".join([
            f"[{i+1}] {metas[i].get('title', 'Unknown')} ({metas[i].get('authors', 'Unknown').split(';')[0].split(',')[0]}, {metas[i].get('date', '')[:4]}): {doc}"
            for i, doc in enumerate(docs)
        ])

        graph_context = ""
        cypher_query = None
        graph_sources = []  # Sources from graph search
        graph_similarities = []

        if use_graph:
            print("\n[GRAPH] Running graph query...")
            step_start = time_module.time()
            graph_response = self.graph_search(query)
            transparency["timing"]["graph_search"] = round(time_module.time() - step_start, 2)

            print(f"   Graph response success: {graph_response.get('success')}")  # DEBUG

            if graph_response["success"]:
                graph_context = graph_response["result"]
                cypher_query = graph_response["cypher"]
                transparency["methods_used"].append("Knowledge Graph (Neo4j)")
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Queried Neo4j knowledge graph for structured relationships",
                    "result": f"Found graph data using Cypher query",
                    "cypher": cypher_query
                })
                print(f"[OK] Graph query successful")
                print(f"   Result preview: {graph_context[:100]}...")  # DEBUG

                # Fetch metadata for papers found by graph search
                graph_dois = graph_response.get("dois", [])
                if graph_dois:
                    try:
                        # Check if query has both author AND topic (e.g., "papers about AI by Smith")
                        import re
                        topic_match = re.search(r'(?:about|on|regarding)\s+([^by]+?)(?:\s+by|\s*$)', query, re.IGNORECASE)
                        has_topic = topic_match is not None

                        if has_topic and len(graph_dois) > 1:
                            # Hybrid: Graph found author's papers, now rank by topic relevance
                            topic = topic_match.group(1).strip()
                            print(f"   Hybrid query detected: ranking by topic '{topic}'")

                            # Get embeddings for the topic and graph papers
                            topic_emb = self.vector_model.encode(topic, normalize_embeddings=True)

                            graph_results = self.collection.get(
                                ids=graph_dois,
                                include=["metadatas", "embeddings"]
                            )

                            if graph_results and graph_results.get("metadatas"):
                                # Calculate similarity to topic for each paper
                                import numpy as np
                                embeddings = graph_results.get("embeddings", [])
                                scored_papers = []

                                for i, meta in enumerate(graph_results["metadatas"]):
                                    if embeddings and i < len(embeddings):
                                        sim = float(np.dot(topic_emb, embeddings[i]))
                                    else:
                                        sim = 0.5  # Default if no embedding
                                    scored_papers.append((meta, sim))

                                # Sort by topic relevance
                                scored_papers.sort(key=lambda x: x[1], reverse=True)
                                graph_sources = [p[0] for p in scored_papers]
                                graph_similarities = [p[1] for p in scored_papers]
                                print(f"   Ranked {len(graph_sources)} papers by topic relevance")
                        else:
                            # Pure author query - just get metadata
                            graph_results = self.collection.get(
                                ids=graph_dois,
                                include=["metadatas"]
                            )
                            if graph_results and graph_results.get("metadatas"):
                                graph_sources = graph_results["metadatas"]
                                graph_similarities = [1.0] * len(graph_sources)
                                print(f"   Retrieved {len(graph_sources)} source(s) from graph DOIs")
                    except Exception as e:
                        print(f"   Could not fetch graph DOIs: {e}")
            else:
                transparency["steps"].append({
                    "name": "Graph Search",
                    "description": "Attempted graph query but no results found",
                    "result": graph_response.get('error', 'No matching pattern')
                })
                print(f"[WARN] Graph query failed: {graph_response.get('error')}")
        else:
            transparency["steps"].append({
                "name": "Graph Search",
                "description": "Skipped - query doesn't require graph patterns",
                "result": "Not needed for this query type"
            })
            print("\n[SEMANTIC] Semantic only (no graph needed)")

        # Generate answer
        print("\n[LLM] Generating answer (this may take 10-30 seconds)...")
        step_start = time_module.time()

        # Build context from the right sources
        if graph_sources:
            # Use graph sources for the prompt
            source_context = "\n\n".join([
                f"[{i+1}] {meta.get('title', 'Unknown')} ({meta.get('authors', 'Unknown').split(';')[0].split(',')[0]}, {meta.get('year', meta.get('date', '')[:4])}): {meta.get('abstract', meta.get('abstract_snippet', 'No abstract'))}"
                for i, meta in enumerate(graph_sources)
            ])
            print(f"   Using {len(graph_sources)} graph source(s) for LLM prompt")
        else:
            source_context = semantic_context

        if use_graph and graph_context and "No results found" not in graph_context:
            prompt = f"""You are a research assistant. Your task is to answer questions ONLY using the provided sources.

QUESTION: {query}

SOURCES:
{source_context}

GRAPH CONTEXT:
{graph_context}

CRITICAL RULES:
1. FIRST, check if ANY of the sources above actually discuss the topic in the QUESTION.
2. If NONE of the sources are relevant to the question, you MUST respond EXACTLY with:
   "I cannot answer this question based on the available research papers. The uploaded documents do not contain relevant information about this topic. Please try a different question related to the papers in your dataset."
3. Do NOT answer questions about topics not covered in the sources.
4. Do NOT use your general knowledge - ONLY use information from the sources.
5. If you answer, use [1], [2], [3] citations and write 2-3 paragraphs maximum.

Before answering, ask yourself: "Do these sources actually talk about {query.split()[0:5]}...?" If NO, decline to answer.

ANSWER:"""
        else:
            prompt = f"""You are a research assistant. Your task is to answer questions ONLY using the provided sources.

QUESTION: {query}

SOURCES:
{semantic_context}

CRITICAL RULES:
1. FIRST, check if ANY of the sources above actually discuss the topic in the QUESTION.
2. If NONE of the sources are relevant to the question, you MUST respond EXACTLY with:
   "I cannot answer this question based on the available research papers. The uploaded documents do not contain relevant information about this topic. Please try a different question related to the papers in your dataset."
3. Do NOT answer questions about topics not covered in the sources.
4. Do NOT use your general knowledge - ONLY use information from the sources.
5. If you answer, use [1], [2], [3] citations and write 2-3 paragraphs maximum.

Before answering, ask yourself: "Do these sources actually talk about {query.split()[0:5]}...?" If NO, decline to answer.

ANSWER:"""

        try:
            answer = self.llm.invoke(prompt)
            transparency["timing"]["llm_generation"] = round(time_module.time() - step_start, 2)
            transparency["methods_used"].append(f"LLM Answer Generation (Ollama)")
            transparency["steps"].append({
                "name": "LLM Generation",
                "description": f"Generated answer using local LLM model",
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

        # Total timing
        transparency["timing"]["total"] = round(time_module.time() - total_start, 2)
        transparency["prompt"] = prompt  # Include the actual prompt for full transparency

        # Determine which sources to return
        # For author/graph queries, prioritize graph sources; otherwise combine
        graph_used = use_graph and graph_context and "No results found" not in graph_context
        if graph_sources:
            # Graph found specific papers - use those as primary sources
            final_sources = graph_sources
            final_similarities = graph_similarities
            final_score = 1.0  # Graph matches are exact
        else:
            # Use semantic sources
            final_sources = vector_results["metadatas"][0]
            final_similarities = similarities
            final_score = best_score

        return {
            "answer": answer,
            "sources": final_sources,
            "similarities": final_similarities,
            "best_score": final_score,
            "graph_used": graph_used,
            "cypher_query": cypher_query,
            "transparency": transparency
        }