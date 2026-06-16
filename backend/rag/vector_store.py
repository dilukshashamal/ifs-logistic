import re
import math
import logging
from collections import Counter

logger = logging.getLogger(__name__)

# Logistics Synonyms dictionary for Semantic Query Expansion
SYNONYMS = {
    "breakdown": ["disabled", "failure", "accident", "recovery", "towed", "crash", "stalled"],
    "weather": ["blizzard", "storm", "rain", "snow", "climate", "delay", "freeze", "hurricane"],
    "penalty": ["charge", "fine", "cost", "fee", "violation", "clause"],
    "route": ["corridor", "turnpike", "highway", "transit", "path", "bypass"],
    "warehouse": ["loading", "operating", "hours", "facility", "fulfillment"]
}

# Advanced Knowledge Base documents with metadata
KNOWLEDGE_BASE_DOCS = [
    {
        "id": "doc_sla_fedex",
        "title": "FedEx Logistics SLA Terms",
        "content": "FedEx SLA: Cargo transit delays due to severe weather are exempt from standard late delivery penalties, provided notification is given within 4 hours of delay onset. Late delivery penalties: $100 per hour delayed beyond deadline. Breakdown recovery: FedEx will supply a backup vehicle within 8 hours of breakdown reporting.",
        "metadata": {"carrier_id": "CARRIER_A", "category": "SLA"}
    },
    {
        "id": "doc_sla_ecofreight",
        "title": "EcoFreight Solutions SLA Terms",
        "content": "EcoFreight SLA: Guaranteed 95% on-time delivery. Late delivery penalty: $200 per hour. EcoFreight uses 100% electric/hybrid fleet. Climate-related route changes do not incur penalties. In the event of a truck breakdown, a replacement driver and truck will be dispatched within 6 hours.",
        "metadata": {"carrier_id": "CARRIER_B", "category": "SLA"}
    },
    {
        "id": "doc_sla_swift",
        "title": "Swift Carriers SLA Terms",
        "content": "Swift SLA: Low cost, no-frills shipping. Late delivery penalties: $50 per hour. Truck breakdown recovery is the responsibility of the shipper, or Swift will resolve it within 12 hours. Cancellations can be made by the carrier up to 6 hours before departure without penalty.",
        "metadata": {"carrier_id": "CARRIER_C", "category": "SLA"}
    },
    {
        "id": "doc_sop_warehouse_west",
        "title": "Warehouse West SOP",
        "content": "Warehouse West loading operating hours are 06:00 to 22:00 UTC. Shipments scheduled outside this window will experience loading delays of up to 8 hours.",
        "metadata": {"carrier_id": None, "category": "SOP"} # Global SOP
    },
    {
        "id": "doc_reg_hazmat",
        "title": "Hazmat Cargo Routing Regulations",
        "content": "Hazmat materials (Class 3 flammable liquids) are prohibited on routes traversing the Pennsylvania Turnpike. All routing must bypass this corridor, adding 120 miles to standard routes.",
        "metadata": {"carrier_id": None, "category": "REGULATION"} # Global Regulation
    }
]

class LocalRAGEngine:
    """An advanced RAG engine combining Metadata Pre-filtering, TF-IDF Sparse Search, Synonym-Expanded Semantic Search, and Reciprocal Rank Fusion (RRF)."""
    def __init__(self):
        self.docs = KNOWLEDGE_BASE_DOCS
        self.vocab = set()
        self.doc_vectors = []
        self.df = Counter()
        self.num_docs = len(self.docs)
        self._build_index()

    def _tokenize(self, text):
        text = text.lower()
        return re.findall(r'\b[a-z0-9\-]+\b', text)

    def _build_index(self):
        tokenized_docs = []
        for doc in self.docs:
            tokens = self._tokenize(doc['content'])
            tokenized_docs.append(tokens)
            self.vocab.update(tokens)
            for token in set(tokens):
                self.df[token] += 1

        self.vocab = sorted(list(self.vocab))
        for tokens in tokenized_docs:
            tf = Counter(tokens)
            vector = []
            for word in self.vocab:
                tf_val = tf[word]
                idf_val = math.log((1 + self.num_docs) / (1 + self.df[word])) + 1
                vector.append(tf_val * idf_val)
            self.doc_vectors.append(vector)

    def _cosine_similarity(self, vec1, vec2):
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        mag1 = math.sqrt(sum(a * a for a in vec1))
        mag2 = math.sqrt(sum(b * b for b in vec2))
        if mag1 == 0 or mag2 == 0:
            return 0.0
        return dot_product / (mag1 * mag2)

    def _sparse_search(self, query_tokens, candidate_indices):
        """Computes basic TF-IDF cosine similarity scores for candidate documents."""
        query_tf = Counter(query_tokens)
        query_vector = []
        for word in self.vocab:
            tf_val = query_tf[word]
            idf_val = math.log((1 + self.num_docs) / (1 + self.df[word])) + 1
            query_vector.append(tf_val * idf_val)

        scores = []
        for idx in candidate_indices:
            sim = self._cosine_similarity(query_vector, self.doc_vectors[idx])
            scores.append((idx, sim))
        
        # Sort by score descending to rank
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores

    def _semantic_search(self, query_tokens, candidate_indices):
        """Simulates dense search using Query Expansion with logistics synonyms."""
        expanded_tokens = list(query_tokens)
        for token in query_tokens:
            if token in SYNONYMS:
                expanded_tokens.extend(SYNONYMS[token])

        expanded_tf = Counter(expanded_tokens)
        query_vector = []
        for word in self.vocab:
            tf_val = expanded_tf[word]
            idf_val = math.log((1 + self.num_docs) / (1 + self.df[word])) + 1
            query_vector.append(tf_val * idf_val)

        scores = []
        for idx in candidate_indices:
            sim = self._cosine_similarity(query_vector, self.doc_vectors[idx])
            scores.append((idx, sim))
        
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores

    def search(self, query, carrier_id=None, top_k=2, threshold=0.15):
        """
        Retrieves matching documents using metadata pre-filtering, 
        hybrid search, and reciprocal rank fusion.
        """
        # --- 1. METADATA PRE-FILTERING ---
        candidate_indices = []
        for idx, doc in enumerate(self.docs):
            doc_carrier = doc.get("metadata", {}).get("carrier_id")
            
            # Match condition:
            # - If search restricts by carrier_id, only show matches for that carrier,
            #   OR show global docs (where carrier_id is None, e.g. general SOPs and regulations).
            if carrier_id is not None:
                if doc_carrier is not None and doc_carrier != carrier_id:
                    continue  # Filter out other carriers' SLAs
            
            candidate_indices.append(idx)

        if not candidate_indices:
            return []

        query_tokens = self._tokenize(query)
        if not query_tokens:
            return []

        # --- 2. MULTI-RUN HYBRID RETRIEVAL ---
        sparse_ranks = self._sparse_search(query_tokens, candidate_indices)
        semantic_ranks = self._semantic_search(query_tokens, candidate_indices)

        # --- 3. RECIPROCAL RANK FUSION (RRF) ---
        # Constant to scale ranks (standard is 60)
        K_RRF = 60
        rrf_scores = Counter()

        # Helper to index ranks
        for rank_idx, (doc_idx, score) in enumerate(sparse_ranks):
            if score > 0: # Only count if there is a match
                rrf_scores[doc_idx] += 1.0 / (K_RRF + (rank_idx + 1))

        for rank_idx, (doc_idx, score) in enumerate(semantic_ranks):
            if score > 0:
                rrf_scores[doc_idx] += 1.0 / (K_RRF + (rank_idx + 1))

        # --- 4. COMBINE & THRESHOLD ---
        results = []
        # Calculate raw normalized scores for display
        for doc_idx, rrf in rrf_scores.items():
            # Generate a normalized final score based on highest cosine similarity from either run
            max_sim = max(
                next((s for idx, s in sparse_ranks if idx == doc_idx), 0.0),
                next((s for idx, s in semantic_ranks if idx == doc_idx), 0.0)
            )
            
            # Relevance Filter guardrail
            if max_sim >= threshold:
                results.append({
                    "score": round(max_sim, 4),
                    "rrf_score": round(rrf, 6),
                    "doc": self.docs[doc_idx]
                })

        # Sort final results by RRF score descending
        results.sort(key=lambda x: x["rrf_score"], reverse=True)
        return results[:top_k]

# Singleton instance
rag_engine = LocalRAGEngine()
