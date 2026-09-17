# backend/tools/resume_parser.py
# ============================================================
# Autonomous Resume Extractor
# ============================================================
# Extracts raw text from PDF resumes using pypdf and uses
# Groq LLM (with regex fallbacks) to pull:
# - Full Name
# - Email
# - GitHub Handle (e.g. "simonw" from "github.com/simonw")
# - LinkedIn URL
# - Phone Number
# - Skills Summary
# ============================================================

import io
import re
import json
import logging
from typing import Dict, Any
from pypdf import PdfReader
from groq import AsyncGroq
from core.config import settings

logger = logging.getLogger(__name__)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from uploaded PDF bytes."""
    reader = PdfReader(io.BytesIO(file_bytes))
    full_text = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text.append(text)
    return "\n".join(full_text).strip()


def regex_fallback_extractor(text: str) -> Dict[str, Any]:
    """Fallback regex extractor for email, github, and phone."""
    # Email
    email_match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", text)
    email = email_match.group(0) if email_match else "unknown@example.com"

    # GitHub handle
    github_match = re.search(r"(?:https?://)?(?:www\.)?github\.com/([a-zA-Z0-9_-]+)", text, re.IGNORECASE)
    github_handle = github_match.group(1) if github_match else None

    # LinkedIn URL
    linkedin_match = re.search(r"(?:https?://)?(?:www\.)?linkedin\.com/in/([a-zA-Z0-9_-]+)", text, re.IGNORECASE)
    linkedin_url = linkedin_match.group(0) if linkedin_match else None

    # Phone number (flexible international)
    phone_match = re.search(r"(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", text)
    phone_number = phone_match.group(0) if phone_match else None

    # Heuristic first line as Name
    first_lines = [l.strip() for l in text.split("\n") if l.strip()]
    name = first_lines[0] if first_lines else "Candidate"
    # Clean up name if it contains email or digits
    if "@" in name or len(name) > 40:
        name = "Candidate"

    return {
        "name": name,
        "email": email,
        "github_handle": github_handle,
        "linkedin_url": linkedin_url,
        "phone_number": phone_number,
        "skills_summary": text[:500],
    }


async def parse_resume(file_bytes: bytes) -> Dict[str, Any]:
    """
    Parses a PDF resume into structured candidate data.
    Uses Groq LLM for intelligent extraction with regex fallback.
    """
    raw_text = extract_text_from_pdf(file_bytes)
    if not raw_text:
        raise ValueError("Could not extract readable text from PDF. The file may be an image scan.")

    # Try Groq LLM for deep entity recognition
    if settings.GROQ_API_KEY:
        try:
            client = AsyncGroq(api_key=settings.GROQ_API_KEY)
            # Use fast 8b or current model for instant parsing
            model_to_use = "llama-3.1-8b-instant" if "8b" in settings.GROQ_MODEL else settings.GROQ_MODEL

            prompt = f"""
You are an expert technical recruiting resume parser.
Analyze this resume text and extract the candidate's core identity and links in valid JSON format.

RESUME TEXT:
\"\"\"
{raw_text[:4000]}
\"\"\"

Return ONLY valid JSON with this exact schema:
{{
  "name": "Full Name",
  "email": "candidate@example.com",
  "github_handle": "username only (without https://github.com/ or @)",
  "linkedin_url": "Full linkedin URL or null",
  "phone_number": "Phone number with country code if available or null",
  "skills": ["Skill1", "Skill2", "Skill3"],
  "summary": "2-3 sentence executive summary of background"
}}
Do not return any markdown codeblocks or preamble, only valid JSON.
"""
            response = await client.chat.completions.create(
                model=model_to_use,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            data = json.loads(response.choices[0].message.content)
            
            # Clean up github_handle in case LLM included URL
            gh = data.get("github_handle")
            if gh:
                gh = gh.replace("https://github.com/", "").replace("http://github.com/", "").replace("github.com/", "").replace("@", "").strip("/ ")
                data["github_handle"] = gh

            data["resume_text"] = raw_text[:3000]
            logger.info(f"Successfully parsed resume via LLM for: {data.get('name')} (GH: {data.get('github_handle')})")
            return data

        except Exception as e:
            logger.warning(f"Groq resume parsing failed: {e}. Falling back to regex extraction.")

    # Fallback if Groq call failed or key is missing
    fallback = regex_fallback_extractor(raw_text)
    fallback["resume_text"] = raw_text[:3000]
    return fallback
