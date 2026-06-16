import re
import math
import logging
from collections import Counter

logger = logging.getLogger(__name__)

# Sample documents to seed the RAG knowledge base.
KNOWLEDGE_BASE_DOCS = [
    {
        "id": "doc_sla_fedex",
        "title": "FedEx Logistics SLA Terms",
        "content": "FedEx SLA: Cargo transit delays due to severe weather are exempt from standard late delivery penalties, provided notification is given within 4 hours of delay onset. Late delivery penalties: $100 per hour delayed beyond deadline. Breakdown recovery: FedEx will supply a backup vehicle within 8 hours of breakdown reporting."
    },
    {
        "id": "doc_sla_ecofreight",
        "title": "EcoFreight Solutions SLA Terms",
        "content": "EcoFreight SLA: Guaranteed 95% on-time delivery. Late delivery penalty: $200 per hour. EcoFreight uses 100% electric/hybrid fleet. Climate-related route changes do not incur penalties. In the event of a truck breakdown, a replacement driver and truck will be dispatched within 6 hours."
    },
    {
        "id": "doc_sla_swift",
        "title": "Swift Carriers SLA Terms",
        "content": "Swift SLA: Low cost, no-frills shipping. Late delivery penalties: $50 per hour. Truck breakdown recovery is the responsibility of the shipper, or Swift will resolve it within 12 hours. Cancellations can be made by the carrier up to 6 hours before departure without penalty."
    },
    {
        "id": "doc_sop_warehouse_west",
        "title": "Warehouse West SOP",
        "content": "Warehouse West loading operating hours are 06:00 to 22:00 UTC. Shipments scheduled outside this window will experience loading delays of up to 8 hours."
    },
    {
        "id": "doc_reg_hazmat",
        "title": "Hazmat Cargo Routing Regulations",
        "content": "Hazmat materials (Class 3 flammable liquids) are prohibited on routes traversing the Pennsylvania Turnpike. All routing must bypass this corridor, adding 120 miles to standard routes."
    }
]

class LocalRAGEngine:
    """A lightweight, self-contained RAG engine using TF-IDF and Cosine Similarity."""
    def __init__(self):
        self.docs = KNOWLEDGE_BASE_DOCS
        self.vocab = set()
        self.doc_vectors = []
        self.df = Counter()
        self.num_docs = len(self.docs)
        self._build_index()

    def _tokenize(self, text):
        """Standard clean tokenization."""
        text = text.lower()
        words = re.findall(r'\b[a-z0-9\-]+\b', text)
        return words

    def _build_index(self):
        """Computes TF-IDF vectors for all documents in the knowledge base."""
        tokenized_docs = []
        for doc in self.docs:
            tokens = self._tokenize(doc['content'])
            tokenized_docs.append(tokens)
            unique_tokens = set(tokens)
            self.vocab.update(unique_tokens)
            for token in unique_tokens:
                self.df[token] += 1

        self.vocab = sorted(list(self.vocab))
        
        for tokens in tokenized_docs:
            tf = Counter(tokens)
            vector = []
            for word in self.vocab:
                # TF-IDF calculation
                tf_val = tf[word]
                idf_val = math.log((1 + self.num_docs) / (1 + self.df[word])) + 1
                vector.append(tf_val * idf_val)
            self.doc_vectors.append(vector)

    def _cosine_similarity(self, vec1, vec2):
        """Calculates cosine similarity between two vectors."""
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        magnitude_vec1 = math.sqrt(sum(a * a for a in vec1))
        magnitude_vec2 = math.sqrt(sum(b * b for b in vec2))
        
        if magnitude_vec1 == 0 or magnitude_vec2 == 0:
            return 0.0
        return dot_product / (magnitude_vec1 * magnitude_vec2)

    def search(self, query, top_k=2):
        """Searches the knowledge base and returns top K matching chunks."""
        query_tokens = self._tokenize(query)
        query_tf = Counter(query_tokens)
        
        query_vector = []
        for word in self.vocab:
            tf_val = query_tf[word]
            idf_val = math.log((1 + self.num_docs) / (1 + self.df[word])) + 1
            query_vector.append(tf_val * idf_val)

        scores = []
        for idx, doc_vector in enumerate(self.doc_vectors):
            sim = self._cosine_similarity(query_vector, doc_vector)
            scores.append((sim, self.docs[idx]))

        # Sort by similarity score descending
        scores.sort(key=lambda x: x[0], reverse=True)
        return [{"score": round(score, 4), "doc": doc} for score, doc in scores[:top_k]]

# Singleton instance for quick access
rag_engine = LocalRAGEngine()
