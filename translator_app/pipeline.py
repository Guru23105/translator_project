import re
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
import language_tool_python
from deep_translator import GoogleTranslator

import os
import json
from functools import lru_cache

# Initialize LanguageTool only once
# language_tool_python will download the java binary on first use, which might be slow.
grammar_tool = None

# Load the slang dictionary from the external JSON file
SLANG_DICT = {}
dict_path = os.path.join(os.path.dirname(__file__), 'slang_dict.json')
try:
    with open(dict_path, 'r', encoding='utf-8') as f:
        SLANG_DICT = json.load(f)
except Exception as e:
    print(f"Error loading slang dictionary: {e}")

# Create a reverse lookup for Tanglish to English (only English translations)
TANGLISH_TO_ENGLISH = {}
for key, value in SLANG_DICT.items():
    # Only add entries where the value is English (ASCII only)
    if value and all(ord(c) < 128 for c in value):
        TANGLISH_TO_ENGLISH[key.lower()] = value.lower()

# Map django language codes to Indic Transliteration scheme constants
SCRIPT_MAP = {
    "ta": sanscript.TAMIL,
    "te": sanscript.TELUGU,
    "ml": sanscript.MALAYALAM,
    "kn": sanscript.KANNADA,
    "hi": sanscript.DEVANAGARI,
}

def get_grammar_tool():
    global grammar_tool
    if grammar_tool is None:
        try:
            grammar_tool = language_tool_python.LanguageTool('en-US')
        except Exception as e:
            pass # Silenced LanguageTool missing java error
    return grammar_tool


def normalize_text(text):
    """
    1. Fix repeated characters (e.g., 'ennnnnaaaa' -> 'enna')
    2. Replace slangs from SLANG_DICT
    """
    if not text:
        return text
    
    # 1. Reduce repeating characters (more than 2 to just 1)
    # e.g., ennnnnaaaa -> enna
    text = re.sub(r'(.)\1{2,}', r'\1', text)

    # 2. Slang Replacement
    words = text.split()
    normalized_words = []
    for w in words:
        lower_w = w.lower()
        if lower_w in SLANG_DICT:
            # Preserve original case roughly
            if w.istitle():
                normalized_words.append(SLANG_DICT[lower_w].title())
            elif w.isupper():
                normalized_words.append(SLANG_DICT[lower_w].upper())
            else:
                normalized_words.append(SLANG_DICT[lower_w])
        else:
            normalized_words.append(w)
    
    return " ".join(normalized_words)

def is_mostly_roman_script(text, threshold=0.7):
    """
    Efficiently check if text is mostly in Roman/Latin script.
    Returns True if more than threshold proportion of alphabetic chars are ASCII.
    """
    if not text:
        return False
    
    # Fast path: if text is empty or only whitespace
    text = text.strip()
    if not text:
        return False
    
    # Count ASCII alphabetic characters
    roman_count = 0
    total_alpha = 0
    
    for char in text:
        if char.isalpha():
            total_alpha += 1
            if ord(char) < 128:  # ASCII check is faster than isascii()
                roman_count += 1
    
    if total_alpha == 0:
        return False
    
    return (roman_count / total_alpha) > threshold


# Load comprehensive transliteration dictionary
COMMON_TRANS_DICT = {}
common_dict_path = os.path.join(os.path.dirname(__file__), 'common_transliteration_dict.json')
try:
    with open(common_dict_path, 'r', encoding='utf-8') as f:
        COMMON_TRANS_DICT = json.load(f)
except Exception as e:
    print(f"Error loading common transliteration dictionary: {e}")

# Cache for common word transliterations to avoid repeated API calls
WORD_TRANSLITERATION_CACHE = {}

@lru_cache(maxsize=512)
def cached_transliterate_word(word, source_lang):
    """
    Cache individual word transliterations for better performance.
    Uses LRU cache for frequently used words.
    """
    if source_lang not in SCRIPT_MAP:
        return word
    
    target_script = SCRIPT_MAP[source_lang]
    try:
        return transliterate(word, sanscript.ITRANS, target_script)
    except Exception:
        return word


def lookup_common_transliteration(word, source_lang):
    """
    Look up word in the comprehensive common transliteration dictionary.
    This is much faster than algorithmic transliteration for common words.
    """
    if source_lang not in COMMON_TRANS_DICT:
        return None
    
    lang_dict = COMMON_TRANS_DICT[source_lang]
    word_lower = word.lower().strip()
    
    # Direct lookup
    if word_lower in lang_dict:
        return lang_dict[word_lower]
    
    # Try with common variations
    # Remove question marks, periods, etc.
    cleaned_word = re.sub(r'[?.!,;:]+$', '', word_lower)
    if cleaned_word in lang_dict:
        return lang_dict[cleaned_word]
    
    return None


def translate_tanglish_to_english(text):
    """
    Translate Tanglish (Tamil-English mixed) text to English using dictionary lookup.
    This handles multi-word phrases and preserves English words.
    """
    if not text:
        return text
    
    # First, try to match multi-word phrases (longer phrases first)
    # Sort keys by length (descending) to match longest phrases first
    sorted_phrases = sorted(TANGLISH_TO_ENGLISH.keys(), key=len, reverse=True)
    
    result = text.lower()
    
    # Replace multi-word phrases first
    for phrase in sorted_phrases:
        if ' ' in phrase and phrase in result:
            result = re.sub(r'\b' + re.escape(phrase) + r'\b', TANGLISH_TO_ENGLISH[phrase], result, flags=re.IGNORECASE)
    
    # Then replace single words
    words = result.split()
    translated_words = []
    
    for word in words:
        # Remove punctuation for lookup
        clean_word = re.sub(r'[?.!,;:\']+', '', word.lower())
        punctuation = re.findall(r'[?.!,;:\']+', word)
        
        if clean_word in TANGLISH_TO_ENGLISH:
            translation = TANGLISH_TO_ENGLISH[clean_word]
            # Preserve some capitalization
            if word.istitle():
                translation = translation.title()
            elif word.isupper():
                translation = translation.upper()
            translated_words.append(translation + ''.join(punctuation))
        else:
            translated_words.append(word)
    
    return ' '.join(translated_words)


def smart_transliterate(text, source_lang):
    """
    Transliterate text from Roman script to native Indic script with intelligent detection.
    
    Improvements:
    1. Better detection of Romanized text
    2. Word-by-word transliteration for mixed scripts
    3. LRU caching for common patterns
    4. Comprehensive dictionary lookup for common words
    5. Better error handling
    6. Optimized for performance
    """
    if not text or source_lang not in SCRIPT_MAP:
        return text
    
    # Quick check: if text is already in native script, return as-is
    if not is_mostly_roman_script(text):
        return text
    
    target_script = SCRIPT_MAP[source_lang]
    
    try:
        # For short texts or pure Roman text, transliterate directly
        if len(text) < 50 or is_mostly_roman_script(text, 0.9):
            # Check if we have this exact text cached
            cache_key = (text, source_lang)
            if cache_key in WORD_TRANSLITERATION_CACHE:
                return WORD_TRANSLITERATION_CACHE[cache_key]
            
            # Try dictionary lookup first for the whole phrase
            dict_result = lookup_common_transliteration(text, source_lang)
            if dict_result:
                WORD_TRANSLITERATION_CACHE[cache_key] = dict_result
                return dict_result
            
            result = transliterate(text, sanscript.ITRANS, target_script)
            # Cache the result for future use
            WORD_TRANSLITERATION_CACHE[cache_key] = result
            return result
        
        # For longer or mixed texts, process word by word with caching
        words = text.split()
        transliterated_words = []
        
        for word in words:
            # Preserve punctuation and numbers
            if not any(c.isalpha() for c in word):
                transliterated_words.append(word)
                continue
            
            # Check if this specific word is Romanized
            if is_mostly_roman_script(word, 0.6):
                # First try dictionary lookup (fastest)
                dict_result = lookup_common_transliteration(word, source_lang)
                if dict_result:
                    transliterated_words.append(dict_result)
                    continue
                
                # Then try cached transliteration
                transliterated_word = cached_transliterate_word(word, source_lang)
                transliterated_words.append(transliterated_word)
            else:
                # Keep native script words as-is
                transliterated_words.append(word)
        
        result = ' '.join(transliterated_words)
        return result
        
    except Exception as e:
        print(f"Transliteration error: {e}")
        return text


def transliterate_to_native(text, source_lang):
    """
    If the source language is an Indic language, and the text contains mostly Roman characters,
    we transliterate it from ITRANS to the native script.
    
    This function now uses smart_transliterate for better accuracy and efficiency.
    """
    return smart_transliterate(text, source_lang)

def fix_english_grammar(text):
    """
    Use LanguageTool to fix grammatical errors in translated English text.
    """
    tool = get_grammar_tool()
    if tool:
        try:
            return tool.correct(text)
        except Exception as e:
            print(f"Grammar correction error: {e}")
            return text
    return text

def is_romanized_indic(text, source_lang, threshold=0.5):
    """
    Check if text is a romanized version of an Indic language.
    Returns True if the text is mostly Roman script and the source is an Indic language.
    """
    if source_lang not in SCRIPT_MAP:
        return False
    return is_mostly_roman_script(text, threshold)


def process_translation_pipeline(text, source_lang, target_lang):
    """
    Orchestrates the NLP pipeline steps.
    Returns a dict with intermediate and final results.
    
    Enhanced for mixed language translations (Tanglish, Hinglish, Manglish, etc.):
    - For romanized Indic languages to English: Uses dictionary lookup first (if available), 
      transliterate remaining to native script, then Google Translate
    - For other translations: Uses transliteration approach
    """
    # 1. Normalization (fix repeated characters)
    normalized = normalize_text(text)
    
    # 2. Check if this is a romanized Indic language translation (Tanglish, Hinglish, Manglish, etc.)
    is_romanized_indic_text = is_romanized_indic(normalized, source_lang, 0.5)
    is_target_english = target_lang == "en"
    
    if is_romanized_indic_text and is_target_english:
        # Use mixed-language translation approach
        # For Tamil, we have a comprehensive slang dictionary
        if source_lang == "ta":
            # First, translate known Tanglish words/phrases to English
            dictionary_translated = translate_tanglish_to_english(normalized)
        else:
            # For other languages, just use the normalized text
            dictionary_translated = normalized
        
        # Check if there are still non-English words that need translation
        if is_mostly_roman_script(dictionary_translated, 0.8):
            # Most text is now English, use as-is with grammar fix
            translated = dictionary_translated
        else:
            # Still has non-English text - transliterate to native script first, then translate
            # Google Translate needs native script, not romanized
            try:
                transliterated = transliterate_to_native(dictionary_translated, source_lang)
                translated = GoogleTranslator(source=source_lang, target=target_lang).translate(transliterated)
            except Exception as e:
                print(f"Translation error for {source_lang}->{target_lang}: {e}")
                translated = dictionary_translated
        
        # 3. Grammar Fix
        final_output = fix_english_grammar(translated)
        
        return {
            "original": text,
            "normalized": normalized,
            "dictionary_translated": dictionary_translated,
            "translated_text": final_output,
            "corrected_text": final_output
        }
    else:
        # Original pipeline for non-Tanglish translations
        # 3. Transliteration (Roman to Native Script)
        # Only useful if we are translating FROM an Indic language
        transliterated = transliterate_to_native(normalized, source_lang)

        # 4. Translation Engine
        # If source and target are same, no translation
        if source_lang == target_lang:
            translated = transliterated
        else:
            try:
                translated = GoogleTranslator(source=source_lang, target=target_lang).translate(transliterated)
            except Exception as e:
                # Fallback if API fails
                print(f"Translation error: {e}")
                translated = transliterated

        # 5. Grammar Fix
        # Only fix grammar if target is English
        final_output = translated
        if target_lang == "en":
            final_output = fix_english_grammar(translated)

        return {
            "original": text,
            "normalized": normalized,
            "transliterated": transliterated,
            "translated_text": final_output,
            "corrected_text": final_output if target_lang == 'en' else transliterated
        }