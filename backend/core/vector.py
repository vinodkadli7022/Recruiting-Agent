import logging

logger = logging.getLogger(__name__)

# Initialize the model as None so it only loads into memory the first time it's called
_model = None

def get_embedding(text: str) -> list[float]:
    """
    Takes plain text and converts it to a 384-dimensional vector embedding.
    Uses HuggingFace's sentence-transformers library.
    """
    global _model
    if _model is None:
        logger.info("Loading SentenceTransformer model into memory for the first time...")
        try:
            from sentence_transformers import SentenceTransformer
            # This is a very lightweight, fast model for semantic search
            _model = SentenceTransformer('all-MiniLM-L6-v2')
        except ImportError:
            logger.error("Failed to load sentence-transformers. Ensure it is installed.")
            # Return a zero vector fallback so the pipeline doesn't crash during demo
            return [0.0] * 384
            
    return _model.encode(text).tolist()
