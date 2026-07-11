"""
Main entry point for the AI Knowledge Platform.

Run:
  python main.py
  python main.py path/to/ScopusExample.xlsx
"""

import sys
import os
from dotenv import load_dotenv
from backend.etl import (
    load_and_parse_standard_data,
    get_user_file_path,
    export_neo4j_csvs,
    write_neo4j_import_cypher
)
from backend.search import (
    create_documents_and_metadata,
    create_vector_store,
    HybridSearchEngine
)

# Load environment variables
load_dotenv()

# Configuration
DB_PATH = os.getenv('DB_PATH', './research_index_db')
COLLECTION_NAME = os.getenv('COLLECTION_NAME', 'papers_collection')
NEO4J_URL = os.getenv('NEO4J_URL', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASS = os.getenv('NEO4J_PASS')

if not NEO4J_PASS:
    raise ValueError("NEO4J_PASS environment variable is required. Set it in .env file.")


def run_complete_pipeline(file_path: str):
    """Complete pipeline: ETL -> Vector DB -> Graph DB -> Search"""

    # Step 1: ETL
    print("\n" + "=" * 60)
    print("STEP 1: ETL - Loading and Cleaning Data")
    print("=" * 60)

    df = load_and_parse_standard_data(file_path)
    if df.empty:
        print("❌ No valid papers. Aborting.")
        return

    # Step 2: Vector DB
    print("\n" + "=" * 60)
    print("STEP 2: Creating Vector Database")
    print("=" * 60)

    contents, metadatas, ids = create_documents_and_metadata(df)
    create_vector_store(contents, metadatas, ids, DB_PATH, COLLECTION_NAME)

    # Step 3: Graph Export
    print("\n" + "=" * 60)
    print("STEP 3: Exporting Knowledge Graph Data")
    print("=" * 60)

    export_neo4j_csvs(df, out_dir="./neo4j/import", export_keywords=True)
    write_neo4j_import_cypher(out_dir="./neo4j/import")

    print("\n⚠️ MANUAL STEP - Import Data to Neo4j:")
    print("\n   FOR NEO4J DESKTOP:")
    print("   1. In Neo4j Desktop, click on your database")
    print("   2. Click '...' → Open Folder → Import")
    print("   3. Copy all CSV files from ./neo4j/import to this folder")
    print("   4. Open Neo4j Browser (http://localhost:7474)")
    print("   5. Copy/paste the contents of ./neo4j/import/import.cypher")
    print("   6. Run the script in Neo4j Browser")
    print("\n   FOR DOCKER:")
    print("   1. Start Neo4j: docker-compose up -d")
    print("   2. CSVs are auto-mounted from ./neo4j/import")
    print("   3. Open Neo4j Browser: http://localhost:7474")
    print("   4. Run: :source /var/lib/neo4j/import/import.cypher")

    input("\n⏸️ Press Enter after Neo4j import is complete...")

    # Step 4: Hybrid Search
    print("\n" + "=" * 60)
    print("STEP 4: Starting Hybrid Search")
    print("=" * 60)

    run_search_loop()


def run_search_loop():
    """Interactive search interface"""

    # Choose your LLM model:
    # - "llama3.2" (3B) - FASTEST, good quality (Recommended)
    # - "llama3.2:1b" - VERY FAST, lower quality
    # - "llama3" (8B) - Slower, better quality
    # - "phi3" - Fast alternative

    engine = HybridSearchEngine(
        db_path=DB_PATH,
        collection_name=COLLECTION_NAME,
        neo4j_url=NEO4J_URL,
        neo4j_user=NEO4J_USER,
        neo4j_pass=NEO4J_PASS,
        llm_model="llama3.2"  # Change this for different speed/quality
    )

    print("\n" + "=" * 60)
    print("🎯 HYBRID SEARCH READY")
    print("=" * 60)
    print("Example queries:")
    print("  - What are the main findings on neural networks?")
    print("  - Which authors collaborated on machine learning?")
    print("  - Show me papers by the same author")
    print("=" * 60)

    while True:
        query = input("\n🔎 Ask (or 'exit'): ").strip()

        if query.lower() in ['exit', 'quit', 'q']:
            print("\n👋 Goodbye!")
            break

        if not query:
            continue

        result = engine.hybrid_answer(query)

        # Display answer
        print("\n" + "=" * 60)
        print(f"📝 ANSWER (Confidence: {result['best_score']:.1%})")
        print("=" * 60)
        print(result["answer"])

        # Graph info
        if result["graph_used"] and result["cypher_query"]:
            print("\n🔗 Cypher Query:")
            print(f"```\n{result['cypher_query']}\n```")

        # Sources
        if result["sources"]:
            print("\n📚 SOURCES:")
            for i, meta in enumerate(result["sources"]):
                sim = result["similarities"][i]
                print(f"\n[{i + 1}] {sim:.1%} - {meta.get('title')}")
                print(f"    {meta.get('authors')} ({meta.get('year')})")
                print(f"    {meta.get('access_link')}")

        print("\n" + "=" * 60)

def main():
    # 1) Optional CLI argument: python main.py <file_path>
    file_path = sys.argv[1] if len(sys.argv) > 1 else None

    # 2) If not provided, ask interactively (same behavior as before)
    if not file_path:
        file_path = get_user_file_path()

    if not file_path:
        print("❌ No file selected. Exiting.")
        return

    run_complete_pipeline(file_path)


if __name__ == "__main__":
    main()
