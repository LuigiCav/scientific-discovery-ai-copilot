# app.py - Flask Backend with Automated Neo4j Import
"""
Flask API that automatically:
1. Accepts file uploads
2. Processes data (ETL)
3. Creates vector embeddings
4. AUTOMATICALLY imports to Neo4j (no manual steps!)
5. Provides search API
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import tempfile
from neo4j import GraphDatabase
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import your existing modules
from backend.etl import (
    load_and_parse_standard_data,
    export_neo4j_csvs,
    safe_str,
    split_authors,
    split_keywords,
    parse_keyword_field,
    make_stable_id
)
from backend.search import (
    create_documents_and_metadata,
    create_vector_store,
    HybridSearchEngine
)

app = Flask(__name__)

# Configuration (use environment variables with fallbacks)
UPLOAD_FOLDER = os.getenv('UPLOAD_FOLDER', './uploads')
DB_PATH = os.getenv('DB_PATH', './research_index_db')
COLLECTION_NAME = os.getenv('COLLECTION_NAME', 'papers_collection')
NEO4J_URL = os.getenv('NEO4J_URL', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASS = os.getenv('NEO4J_PASS')
FLASK_PORT = int(os.getenv('FLASK_PORT', '5000'))

if not NEO4J_PASS:
    raise ValueError("NEO4J_PASS environment variable is required. Set it in .env file.")
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000')

# Enable CORS for frontend (restrict to specific origin in production)
CORS(app, origins=[FRONTEND_URL])

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

# Global search engine (initialized after upload)
search_engine = None
current_db_path = None  # Track current database path


def auto_import_to_neo4j(df):
    """
    Automatically import data to Neo4j using Python driver
    No manual CSV copying needed!
    """
    print("\n[CONNECT] Connecting to Neo4j...")

    driver = GraphDatabase.driver(NEO4J_URL, auth=(NEO4J_USER, NEO4J_PASS))

    try:
        with driver.session() as session:
            # Clear existing data
            print("[CLEAN] Clearing old data...")
            session.run("MATCH (n) DETACH DELETE n")

            # Create constraints
            print("[SCHEMA] Creating constraints...")
            session.run("""
                CREATE CONSTRAINT paper_id_unique IF NOT EXISTS 
                FOR (p:Paper) REQUIRE p.paper_id IS UNIQUE
            """)
            session.run("""
                CREATE CONSTRAINT author_id_unique IF NOT EXISTS 
                FOR (a:Author) REQUIRE a.author_id IS UNIQUE
            """)
            session.run("""
                CREATE CONSTRAINT keyword_id_unique IF NOT EXISTS 
                FOR (k:Keyword) REQUIRE k.keyword_id IS UNIQUE
            """)

            # Import Papers
            print("[PAPERS] Importing papers...")
            for _, row in df.iterrows():
                doi = safe_str(row.get("doi", "")).strip()
                if not doi:
                    continue

                session.run("""
                    MERGE (p:Paper {paper_id: $paper_id})
                    SET p.title = $title,
                        p.abstract = $abstract,
                        p.date = $date,
                        p.journal_name = $journal_name,
                        p.doi = $doi,
                        p.url = $url,
                        p.citations = $citations
                """, {
                    "paper_id": doi,
                    "title": row["title"],
                    "abstract": row["abstract"],
                    "date": row["date"],
                    "journal_name": row["journal_name"],
                    "doi": doi,
                    "url": row.get("url", ""),
                    "citations": row.get("citations", "")
                })

            # Import Authors and Relationships
            print("[AUTHORS] Importing authors...")
            for _, row in df.iterrows():
                doi = safe_str(row.get("doi", "")).strip()
                if not doi:
                    continue

                for author_name in split_authors(row.get("authors", "")):
                    author_id = make_stable_id("AUTHOR", author_name)

                    # Create author
                    session.run("""
                        MERGE (a:Author {author_id: $author_id})
                        SET a.name = $name
                    """, {"author_id": author_id, "name": author_name})

                    # Create relationship
                    session.run("""
                        MATCH (a:Author {author_id: $author_id})
                        MATCH (p:Paper {paper_id: $paper_id})
                        MERGE (a)-[:AUTHORED]->(p)
                    """, {"author_id": author_id, "paper_id": doi})

            # Import Keywords (author_keywords and keywords_plus)
            print("[KEYWORDS] Importing keywords...")
            for _, row in df.iterrows():
                doi = safe_str(row.get("doi", "")).strip()
                if not doi:
                    continue

                # Process author keywords
                author_kw_raw = row.get("author_keywords", "")
                if isinstance(author_kw_raw, str):
                    author_keywords = parse_keyword_field(author_kw_raw)
                elif isinstance(author_kw_raw, list):
                    author_keywords = author_kw_raw
                else:
                    author_keywords = []

                for kw in author_keywords:
                    kw_id = make_stable_id("KEYWORD", kw)
                    session.run("""
                        MERGE (k:Keyword {keyword_id: $keyword_id})
                        SET k.name = $name, k.type = 'author'
                    """, {"keyword_id": kw_id, "name": kw})
                    session.run("""
                        MATCH (p:Paper {paper_id: $paper_id})
                        MATCH (k:Keyword {keyword_id: $keyword_id})
                        MERGE (p)-[:HAS_KEYWORD {type: 'author'}]->(k)
                    """, {"paper_id": doi, "keyword_id": kw_id})

                # Process keywords plus / index keywords
                kw_plus_raw = row.get("keywords_plus", "")
                if isinstance(kw_plus_raw, str):
                    keywords_plus = parse_keyword_field(kw_plus_raw)
                elif isinstance(kw_plus_raw, list):
                    keywords_plus = kw_plus_raw
                else:
                    keywords_plus = []

                for kw in keywords_plus:
                    kw_id = make_stable_id("KEYWORD", kw)
                    session.run("""
                        MERGE (k:Keyword {keyword_id: $keyword_id})
                        SET k.name = $name, k.type = 'index'
                    """, {"keyword_id": kw_id, "name": kw})
                    session.run("""
                        MATCH (p:Paper {paper_id: $paper_id})
                        MATCH (k:Keyword {keyword_id: $keyword_id})
                        MERGE (p)-[:HAS_KEYWORD {type: 'index'}]->(k)
                    """, {"paper_id": doi, "keyword_id": kw_id})

                # Also process legacy 'sources' field if present (for backward compatibility)
                if "sources" in df.columns:
                    for kw in split_keywords(row.get("sources", "")):
                        kw_id = make_stable_id("KEYWORD", kw)
                        session.run("""
                            MERGE (k:Keyword {keyword_id: $keyword_id})
                            SET k.name = $name
                        """, {"keyword_id": kw_id, "name": kw})
                        session.run("""
                            MATCH (p:Paper {paper_id: $paper_id})
                            MATCH (k:Keyword {keyword_id: $keyword_id})
                            MERGE (p)-[:HAS_KEYWORD]->(k)
                        """, {"paper_id": doi, "keyword_id": kw_id})

            # Verify import
            result = session.run("MATCH (n) RETURN count(n) as count")
            count = result.single()["count"]
            print(f"[OK] Imported {count} nodes to Neo4j")

    finally:
        driver.close()


@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    Handle file upload and automatic processing
    """
    global search_engine

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        return jsonify({'error': 'Invalid file type. Use Excel or CSV'}), 400

    try:
        # Save uploaded file
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Step 1: ETL - Load and clean data
        print("\n[STEP 1] Processing data...")
        df = load_and_parse_standard_data(filepath)

        if df.empty:
            return jsonify({'error': 'No valid papers found in file'}), 400

        # Step 2: Create vector embeddings
        print("\n[STEP 2] Creating vector embeddings...")
        global current_db_path
        # Release old ChromaDB connection before creating new store
        if search_engine is not None:
            search_engine = None
            import gc
            gc.collect()
        # Use unique database path to avoid locking issues
        import time as time_module
        new_db_path = f"{DB_PATH}_{int(time_module.time())}"
        # Clean up old database if exists
        if current_db_path and os.path.exists(current_db_path):
            try:
                import shutil
                shutil.rmtree(current_db_path)
            except Exception:
                pass  # Ignore cleanup errors
        current_db_path = new_db_path
        contents, metadatas, ids = create_documents_and_metadata(df)
        create_vector_store(contents, metadatas, ids, current_db_path, COLLECTION_NAME)

        # Step 3: Auto-import to Neo4j
        print("\n[STEP 3] Importing to Neo4j...")
        auto_import_to_neo4j(df)

        # Step 4: Initialize search engine
        print("\n[STEP 4] Initializing search engine...")
        search_engine = HybridSearchEngine(
            db_path=current_db_path,
            collection_name=COLLECTION_NAME,
            neo4j_url=NEO4J_URL,
            neo4j_user=NEO4J_USER,
            neo4j_pass=NEO4J_PASS,
            llm_model="llama3.2"
        )

        # Convert DataFrame to list of dicts for frontend
        papers_data = df.to_dict('records')

        return jsonify({
            'success': True,
            'message': 'File processed successfully',
            'papers_count': len(df),
            'papers': papers_data,
            'status': 'ready'
        })

    except Exception as e:
        print(f"[ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/search', methods=['POST'])
def search():
    """
    Handle search queries
    """
    global search_engine

    if search_engine is None:
        return jsonify({'error': 'Please upload a file first'}), 400

    data = request.json
    query = data.get('query', '').strip()

    if not query:
        return jsonify({'error': 'Query cannot be empty'}), 400

    try:
        # Perform hybrid search
        result = search_engine.hybrid_answer(query)

        # Format response with all paper details
        response = {
            'answer': result['answer'],
            'confidence': result['best_score'],
            'sources': [
                {
                    'title': meta.get('title'),
                    'authors': meta.get('authors'),
                    'year': meta.get('year'),
                    'date': meta.get('year'),
                    'similarity': result['similarities'][i],
                    'link': meta.get('access_link'),
                    'doi': meta.get('doi'),
                    'url': meta.get('access_link'),
                    'abstract': meta.get('abstract', meta.get('abstract_snippet', '')),
                    'journal_name': meta.get('journal'),
                    'vhbRanking': meta.get('vhbRanking'),
                    'abdcRanking': meta.get('abdcRanking'),
                    'citations': meta.get('citations')
                }
                for i, meta in enumerate(result['sources'])
            ],
            'graphUsed': result.get('graph_used', False),
            'cypherQuery': result.get('cypher_query'),
            'transparency': result.get('transparency', {})
        }

        return jsonify(response)

    except Exception as e:
        print(f"[ERROR] Search error: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/status', methods=['GET'])
def status():
    """
    Check if system is ready
    """
    return jsonify({
        'ready': search_engine is not None,
        'neo4j_url': NEO4J_URL
    })


@app.route('/api/health', methods=['GET'])
def health():
    """
    Health check endpoint
    """
    return jsonify({'status': 'ok'})


@app.route('/api/semantic-similarities', methods=['POST'])
def get_semantic_similarities():
    """
    Calculate semantic similarities between papers using vector embeddings.
    Returns pairwise similarities above a threshold.
    """
    global search_engine

    if search_engine is None:
        return jsonify({'error': 'Please upload a file first'}), 400

    try:
        data = request.json or {}
        threshold = data.get('threshold', 0.5)  # Minimum similarity to return
        max_per_paper = data.get('max_per_paper', 3)  # Max connections per paper

        # Get all papers from the collection
        collection = search_engine.collection
        all_data = collection.get(include=["embeddings", "metadatas"])

        if not all_data or not all_data['ids']:
            return jsonify({'similarities': []})

        ids = all_data['ids']
        embeddings = all_data['embeddings']
        metadatas = all_data['metadatas']

        # Calculate pairwise cosine similarities
        import numpy as np
        embeddings_np = np.array(embeddings)

        similarities = []
        paper_counts = {}  # Track connections per paper

        # Calculate all similarities first
        all_pairs = []
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                # Cosine similarity (embeddings are already normalized)
                sim = float(np.dot(embeddings_np[i], embeddings_np[j]))
                if sim >= threshold:
                    all_pairs.append({
                        'source_doi': ids[i],
                        'target_doi': ids[j],
                        'similarity': sim,
                        'source_title': metadatas[i].get('title', ''),
                        'target_title': metadatas[j].get('title', '')
                    })

        # Sort by similarity (highest first)
        all_pairs.sort(key=lambda x: x['similarity'], reverse=True)

        # Filter to max_per_paper connections
        for pair in all_pairs:
            source_count = paper_counts.get(pair['source_doi'], 0)
            target_count = paper_counts.get(pair['target_doi'], 0)

            if source_count < max_per_paper and target_count < max_per_paper:
                similarities.append(pair)
                paper_counts[pair['source_doi']] = source_count + 1
                paper_counts[pair['target_doi']] = target_count + 1

        return jsonify({
            'similarities': similarities,
            'total_papers': len(ids)
        })

    except Exception as e:
        print(f"Error calculating similarities: {str(e)}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print(f"""
============================================================
         HYBRID RAG API SERVER
         Automatic Neo4j Import + Web Interface
============================================================

Starting server on http://localhost:{FLASK_PORT}
Neo4j: {NEO4J_URL}
Frontend: {FRONTEND_URL}
    """)

    app.run(debug=True, host='0.0.0.0', port=FLASK_PORT)