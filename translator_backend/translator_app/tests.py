from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse


class HomeViewTests(TestCase):
    def test_home_page_loads(self):
        """The browser should be able to open the main translator page."""

        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Translator")


class TranslateTextTests(TestCase):
    @patch("translator_app.views.TextBlob")
    @patch("translator_app.views.GoogleTranslator")
    def test_translate_text_uses_selected_languages(
        self,
        translator_mock,
        textblob_mock,
    ):
        """English text is corrected, then translated to the selected language."""

        textblob_mock.return_value.correct.return_value = "hello"
        translator_mock.return_value.translate.return_value = "vanakkam"

        response = self.client.post(
            reverse("translate"),
            {
                "text": "helo",
                "source": "en",
                "target": "ta",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translated_text"], "vanakkam")
        translator_mock.assert_called_once_with(source="en", target="ta")
        translator_mock.return_value.translate.assert_called_once_with("hello")

    def test_translate_text_rejects_empty_text(self):
        """Blank input should return a clear validation error."""

        response = self.client.post(
            reverse("translate"),
            {
                "text": "   ",
                "source": "en",
                "target": "ta",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_translate_text_rejects_unsupported_language(self):
        """Unknown language codes should not reach the translator service."""

        response = self.client.post(
            reverse("translate"),
            {
                "text": "hello",
                "source": "xx",
                "target": "ta",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    @patch("translator_app.views.GoogleTranslator")
    def test_same_language_returns_original_text(self, translator_mock):
        """When source and target match, the app returns the original text."""

        response = self.client.post(
            reverse("translate"),
            {
                "text": "hello",
                "source": "en",
                "target": "en",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translated_text"], "hello")
        translator_mock.assert_not_called()


class SuggestTextTests(TestCase):
    @patch("translator_app.views.TextBlob")
    def test_suggest_text_returns_english_correction(self, textblob_mock):
        """English input should return a suggestion when TextBlob changes it."""

        textblob_mock.return_value.correct.return_value = "hello"

        response = self.client.post(
            reverse("suggest"),
            {
                "text": "helo",
                "source": "en",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["suggestion"], "hello")

    @patch("translator_app.views.TextBlob")
    def test_suggest_text_hides_unchanged_text(self, textblob_mock):
        """No suggestion is needed when the corrected text matches the input."""

        textblob_mock.return_value.correct.return_value = "hello"

        response = self.client.post(
            reverse("suggest"),
            {
                "text": "hello",
                "source": "en",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["suggestion"], "")

    @patch("translator_app.views.TextBlob")
    def test_suggest_text_skips_non_english_input(self, textblob_mock):
        """Suggestions are only generated for English input."""

        response = self.client.post(
            reverse("suggest"),
            {
                "text": "vanakkam",
                "source": "ta",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["suggestion"], "")
        textblob_mock.assert_not_called()
