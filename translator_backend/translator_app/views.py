from django.shortcuts import render
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from deep_translator import GoogleTranslator
from textblob import TextBlob


LANGUAGES = {
    "en": "english",
    "ta": "tamil",
    "hi": "hindi",
    "te": "telugu",
    "ml": "malayalam",
    "kn": "kannada",
    "fr": "french",
    "es": "spanish",
}


def home(request):
    """Show the translator page."""
    return render(request, "index.html")


@api_view(["POST"])
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

    # 4. No external API call is needed when both languages are the same.
    if source == target:
        return Response(
            {
                "translated_text": text,
                "corrected_text": text,
            }
        )

    # 5. Correct spelling only for English input. Other languages are left as-is.
    corrected_text = str(TextBlob(text).correct()) if source == "en" else text

    try:
        # 6. Ask deep_translator to translate the corrected text.
        translated = GoogleTranslator(source=source, target=target).translate(
            corrected_text
        )
    except Exception:
        return Response(
            {"error": "Translation service is unavailable. Please try again."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return Response(
        {
            "translated_text": translated,
            "corrected_text": corrected_text,
        }
    )


@api_view(["POST"])
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
