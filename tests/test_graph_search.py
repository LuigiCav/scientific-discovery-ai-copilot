import unittest

from backend.search import HybridSearchEngine


class GraphSearchTests(unittest.TestCase):
    def make_engine(self, records):
        engine = HybridSearchEngine.__new__(HybridSearchEngine)
        engine.graph_available = True
        engine.graph_chain = None
        engine._run_cypher = lambda _query, _params=None: records

        def unexpected_llm_classification(_query):
            raise AssertionError("A clear structural query must not call the LLM classifier")

        engine.classify_intent = unexpected_llm_classification
        return engine

    def test_collaboration_query_is_deterministic_and_cited(self):
        engine = self.make_engine([
            {
                "collaborator": "Acikgoz, Fulya",
                "paper": "Artificial intelligence in humanitarian aid",
                "doi": "10.1016/example",
            },
            {
                "collaborator": "Yassine, Noura M.",
                "paper": "Artificial intelligence in humanitarian aid",
                "doi": "10.1016/example",
            },
        ])

        result = engine.graph_search("Who collaborated with Lythreatis?")

        self.assertTrue(result["success"])
        self.assertEqual(result["answer_mode"], "exact_graph_lookup")
        self.assertEqual(result["intent"], "COLLABORATIONS")
        self.assertEqual(result["dois"], ["10.1016/example"])
        self.assertIn("Acikgoz, Fulya", result["result"])
        self.assertIn("Yassine, Noura M.", result["result"])
        self.assertIn("[1]", result["result"])

    def test_rule_based_intents_cover_common_graph_questions(self):
        engine = HybridSearchEngine.__new__(HybridSearchEngine)
        cases = {
            "papers by Smith": "PAPERS_BY_AUTHOR",
            "who collaborated with Smith?": "COLLABORATIONS",
            "list all authors": "LIST_AUTHORS",
            "what topics are covered?": "LIST_TOPICS",
            "papers about artificial intelligence": "PAPERS_BY_TOPIC",
        }

        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(engine._rule_based_intent(query), expected)

    def test_topics_by_author_returns_papers_for_rag_without_keywords(self):
        engine = self.make_engine([
            {
                "author": "Acikgoz, Fulya",
                "title": "Artificial intelligence in humanitarian aid",
                "doi": "10.1016/example",
                "keywords": [],
            }
        ])

        result = engine.graph_search("Topics by Acikgoz")

        self.assertTrue(result["success"])
        self.assertEqual(result["intent"], "TOPICS_BY_AUTHOR")
        self.assertEqual(result["dois"], ["10.1016/example"])
        self.assertIn("co-authored", result["result"])
        self.assertNotIn("Scopus", result["result"])


if __name__ == "__main__":
    unittest.main()
