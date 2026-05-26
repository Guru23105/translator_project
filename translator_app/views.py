from django.shortcuts import render
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.decorators import permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from textblob import TextBlob
from .pipeline import process_translation_pipeline


LANGUAGES = {
    "en": "english",
    "ta": "tamil",
    "hi": "hindi",
    "te": "telugu",
    "ml": "malayalam",
    "kn": "kannada",
    "fr": "french",
    "es": "spanish",
    "ja": "japanese",
}


def home(request):
    """Show the translator page."""
    return render(request, "index.html")


def login_page(request):
    """Show the JWT login page."""
    return render(request, "login.html")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def translate_text(request):
    """Translate text sent by the frontend and return a JSON response."""

    # 1. Read the values sent from script.js.
    text = str(request.data.get("text", "")).strip()
    source = request.data.get("source", "en")
    target = request.data.get("target", "ta")

    # 2. Stop early when the user did not type anything.
    if not text:
        return Response(
            {"error": "Please enter text to translate."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 3. Accept only the languages that the frontend dropdown supports.
    if source not in LANGUAGES or target not in LANGUAGES:
        return Response(
            {"error": "Unsupported language selected."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 4. Process text through the NLP pipeline
    try:
        print(f"Translating from {source} to {target}")
        result = process_translation_pipeline(text, source, target)
        print(f"Pipeline result: {result}")
        # Handle both old and new response structures
        intermediate = result.get("transliterated", result.get("dictionary_translated", result.get("tanglish_translated", "")))
        
        return Response({
            "input_text": text,
            "normalized": result["normalized"],
            "transliterated": intermediate,
            "translated_text": result["translated_text"],
            "language_detected": source,
            "corrected_text": result["corrected_text"],
            "intermediate_steps": {
                "normalized": result["normalized"],
                "transliterated": intermediate
            }
        })
    except Exception as e:
        # Log the actual error for debugging
        print(f"Translation pipeline error: {type(e).__name__}: {e}")
        return Response(
            {"error": f"Translation failed: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def suggest_text(request):
    """Return a spelling suggestion for text typed in the frontend."""

    text = str(request.data.get("text", "")).strip()
    source = request.data.get("source", "en")

    if not text:
        return Response({"suggestion": ""})

    if source not in LANGUAGES:
        return Response(
            {"error": "Unsupported language selected."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if source != "en":
        return Response({"suggestion": ""})

    corrected_text = str(TextBlob(text).correct())
    suggestion = corrected_text if corrected_text != text else ""

    return Response({"suggestion": suggestion})
