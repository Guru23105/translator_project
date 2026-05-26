// These language codes are sent to the Django API and then to GoogleTranslator.
const supportedLanguages = [
    { code: "en", label: "English" },
    { code: "ta", label: "Tamil" },
    { code: "hi", label: "Hindi" },
    { code: "te", label: "Telugu" },
    { code: "ml", label: "Malayalam" },
    { code: "kn", label: "Kannada" },
    { code: "fr", label: "French" },
    { code: "es", label: "Spanish" },
    { code: "ja", label: "Japanese" },
];

const speechLanguageCodes = {
    en: "en-US",
    ta: "ta-IN",
    hi: "hi-IN",
    te: "te-IN",
    ml: "ml-IN",
    kn: "kn-IN",
    fr: "fr-FR",
    es: "es-ES",
    ja: "ja-JP",
};

let availableVoices = [];
let activeSpeech = null;
let activeAudio = null;
let translatedTextForVoice = "";
let activeRecognition = null;
let isRecording = false;
let shouldTryNextRecorder = false;
let suggestionDebounceTimer = null;
let suggestionAbortController = null;
let translationDebounceTimer = null;
let translationAbortController = null;
const suggestionDelay = 500;
const translationDelay = 700;
const defaultTranslationMessage = "Your translation will appear here...";
const accessTokenKey = "access_token";
const refreshTokenKey = "refresh_token";

function getAccessToken(){
    return localStorage.getItem(accessTokenKey);
}

function getRefreshToken(){
    return localStorage.getItem(refreshTokenKey);
}

function clearStoredTokens(){
    localStorage.removeItem(accessTokenKey);
    localStorage.removeItem(refreshTokenKey);
}

function redirectToLogin(){
    clearStoredTokens();
    window.location.href = "/login/";
}

async function refreshAccessToken(){
    const refreshToken = getRefreshToken();

    if(!refreshToken){
        return null;
    }

    const response = await fetch("/api/token/refresh/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh: refreshToken }),
    });

    if(!response.ok){
        return null;
    }

    const data = await response.json();

    if(!data.access){
        return null;
    }

    localStorage.setItem(accessTokenKey, data.access);

    if(data.refresh){
        localStorage.setItem(refreshTokenKey, data.refresh);
    }

    return data.access;
}

async function authFetch(url, options = {}){
    const accessToken = getAccessToken();

    if(!accessToken){
        redirectToLogin();
        throw new Error("Authentication required.");
    }

    const requestOptions = {
        ...options,
        headers: {
            ...(options.headers || {}),
            "Authorization": `Bearer ${accessToken}`,
        },
    };

    let response = await fetch(url, requestOptions);

    if(response.status !== 401){
        return response;
    }

    const newAccessToken = await refreshAccessToken();

    if(!newAccessToken){
        redirectToLogin();
        throw new Error("Your session has expired. Please login again.");
    }

    response = await fetch(url, {
        ...requestOptions,
        headers: {
            ...(requestOptions.headers || {}),
            "Authorization": `Bearer ${newAccessToken}`,
        },
    });

    if(response.status === 401){
        redirectToLogin();
        throw new Error("Your session has expired. Please login again.");
    }

    return response;
}

function logout(){
    redirectToLogin();
}

function getTranslatorElements(){
    return {
        inputText: document.getElementById("inputText"),
        result: document.getElementById("result"),
        sourceLanguage: document.getElementById("sourceLang"),
        targetLanguage: document.getElementById("targetLang"),
        translateButton: document.getElementById("translateBtn"),
        recordButton: document.getElementById("recordBtn"),
        outputBox: document.getElementById("resultContainer"),
        suggestionBox: document.getElementById("suggestionBox"),
        suggestionText: document.getElementById("suggestionText"),
        charCount: document.getElementById("charCount"),
        toast: document.getElementById("toast"),
    };
}

// Toast notification function
function showToast(message, duration = 3000){
    const { toast } = getTranslatorElements();
    if(!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

// Update character count
function updateCharCount(){
    const { inputText, charCount } = getTranslatorElements();
    if(!inputText || !charCount) return;

    const count = inputText.value.length;
    const max = 5000;
    charCount.textContent = `${count} / ${max}`;

    // Change color when approaching limit
    if(count > max * 0.9){
        charCount.style.color = "#ea4335";
    } else {
        charCount.style.color = "";
    }
}

// Copy result to clipboard
function copyResult(){
    const { result } = getTranslatorElements();
    const textToCopy = translatedTextForVoice || result.textContent;

    if(!textToCopy || textToCopy === defaultTranslationMessage){
        showToast("Nothing to copy");
        return;
    }

    if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(textToCopy).then(() => {
            showToast("Copied to clipboard!");
            animateCopyButton();
        }).catch(() => {
            fallbackCopyToClipboard(textToCopy);
        });
    } else {
        fallbackCopyToClipboard(textToCopy);
    }
}

function fallbackCopyToClipboard(text){
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try{
        document.execCommand("copy");
        showToast("Copied to clipboard!");
        animateCopyButton();
    } catch(err){
        showToast("Failed to copy");
    }

    document.body.removeChild(textarea);
}

function animateCopyButton(){
    const copyBtn = document.querySelector(".copy-btn");
    if(!copyBtn) return;

    copyBtn.classList.add("copied");
    const originalSVG = copyBtn.innerHTML;
    copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    `;

    setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = originalSVG;
    }, 2000);
}

// speakResult is the new name for speakOutputText
function speakResult(){
    speakOutputText();
}

function loadVoices(){
    if(!("speechSynthesis" in window)){
        return;
    }

    availableVoices = window.speechSynthesis.getVoices();
}

function findVoice(languageCode){
    const speechLanguage = speechLanguageCodes[languageCode] || "en-US";
    const shortLanguage = speechLanguage.split("-")[0];

    return availableVoices.find((voice) => voice.lang === speechLanguage)
        || availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(shortLanguage))
        || null;
}

function getGoogleVoiceUrl(text, languageCode){
    const speechLanguage = speechLanguageCodes[languageCode] || "en-US";
    const shortLanguage = speechLanguage.split("-")[0];
    const textForVoice = text.slice(0, 200);

    return "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob"
        + "&tl=" + encodeURIComponent(shortLanguage)
        + "&q=" + encodeURIComponent(textForVoice);
}

function populateLanguages(){
    const { sourceLanguage, targetLanguage } = getTranslatorElements();

    supportedLanguages.forEach((language) => {
        sourceLanguage.add(new Option(language.label, language.code));
        targetLanguage.add(new Option(language.label, language.code));
    });

    sourceLanguage.value = "en";
    targetLanguage.value = "ta";

    // Build custom dropdowns
    buildCustomDropdown("customSourceOptions", "sourceLang", "customSourceLangTrigger", "en");
    buildCustomDropdown("customTargetOptions", "targetLang", "customTargetLangTrigger", "ta");
}

function buildCustomDropdown(optionsListId, nativeSelectId, triggerBtnId, defaultVal) {
    const listElement = document.getElementById(optionsListId);
    const nativeSelect = document.getElementById(nativeSelectId);
    const triggerBtn = document.getElementById(triggerBtnId);
    if (!listElement || !nativeSelect || !triggerBtn) return;

    listElement.innerHTML = "";
    
    supportedLanguages.forEach((lang) => {
        const li = document.createElement("li");
        li.className = "custom-option" + (lang.code === defaultVal ? " selected" : "");
        li.setAttribute("data-value", lang.code);
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", lang.code === defaultVal ? "true" : "false");
        
        li.innerHTML = `
            <span class="lang-badge">${lang.code.toUpperCase()}</span>
            <span class="option-text">${lang.label}</span>
            <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        `;
        
        li.addEventListener("click", () => {
            selectCustomOption(nativeSelectId, triggerBtnId, optionsListId, lang.code);
        });
        
        listElement.appendChild(li);
    });

    // Update trigger UI initially
    updateTriggerUI(triggerBtn, defaultVal);
}

function updateTriggerUI(triggerBtn, val) {
    const lang = supportedLanguages.find(l => l.code === val) || { code: val, label: val };
    const badge = triggerBtn.querySelector(".lang-badge");
    const valText = triggerBtn.querySelector(".selected-value");
    if (badge) badge.textContent = lang.code.toUpperCase();
    if (valText) valText.textContent = lang.label;
}

function selectCustomOption(nativeSelectId, triggerBtnId, optionsListId, val) {
    const nativeSelect = document.getElementById(nativeSelectId);
    const triggerBtn = document.getElementById(triggerBtnId);
    const listElement = document.getElementById(optionsListId);
    if (!nativeSelect || !triggerBtn || !listElement) return;

    // 1. Update native select
    nativeSelect.value = val;
    
    // 2. Dispatch change event to trigger existing listeners
    const event = new Event("change", { bubbles: true });
    nativeSelect.dispatchEvent(event);
    
    // 3. Update active/selected classes in dropdown list
    const options = listElement.querySelectorAll(".custom-option");
    options.forEach(opt => {
        const optVal = opt.getAttribute("data-value");
        if (optVal === val) {
            opt.classList.add("selected");
            opt.setAttribute("aria-selected", "true");
        } else {
            opt.classList.remove("selected");
            opt.setAttribute("aria-selected", "false");
        }
    });

    // 4. Update trigger button content
    updateTriggerUI(triggerBtn, val);

    // 5. Close the dropdown
    const wrapper = triggerBtn.closest(".custom-select");
    if (wrapper) {
        wrapper.classList.remove("active");
        triggerBtn.setAttribute("aria-expanded", "false");
    }
}

function syncCustomDropdowns() {
    const { sourceLanguage, targetLanguage } = getTranslatorElements();
    
    // Sync source
    const sourceTrigger = document.getElementById("customSourceLangTrigger");
    if (sourceTrigger) {
        updateTriggerUI(sourceTrigger, sourceLanguage.value);
        const list = document.getElementById("customSourceOptions");
        if (list) {
            list.querySelectorAll(".custom-option").forEach(opt => {
                const optVal = opt.getAttribute("data-value");
                if (optVal === sourceLanguage.value) {
                    opt.classList.add("selected");
                    opt.setAttribute("aria-selected", "true");
                } else {
                    opt.classList.remove("selected");
                    opt.setAttribute("aria-selected", "false");
                }
            });
        }
    }
    
    // Sync target
    const targetTrigger = document.getElementById("customTargetLangTrigger");
    if (targetTrigger) {
        updateTriggerUI(targetTrigger, targetLanguage.value);
        const list = document.getElementById("customTargetOptions");
        if (list) {
            list.querySelectorAll(".custom-option").forEach(opt => {
                const optVal = opt.getAttribute("data-value");
                if (optVal === targetLanguage.value) {
                    opt.classList.add("selected");
                    opt.setAttribute("aria-selected", "true");
                } else {
                    opt.classList.remove("selected");
                    opt.setAttribute("aria-selected", "false");
                }
            });
        }
    }
}

function removeOutputVoiceButton(){
    const outputVoiceButton = document.getElementById("outputVoiceBtn");
    if(outputVoiceButton){
        outputVoiceButton.style.display = "none";
    }
}

function createOutputVoiceButton(){
    const outputVoiceButton = document.getElementById("outputVoiceBtn");
    if(outputVoiceButton){
        outputVoiceButton.style.display = "flex";
    }
}

function getSpeechRecognitionEngines(){
    const recorders = [];

    if(window.webkitSpeechRecognition){
        recorders.push({
            engine: window.webkitSpeechRecognition,
            name: "Google speech recorder",
        });
    }

    if(window.SpeechRecognition && window.SpeechRecognition !== window.webkitSpeechRecognition){
        recorders.push({
            engine: window.SpeechRecognition,
            name: "Browser speech recorder",
        });
    }

    return recorders;
}

function isLocalPage(){
    const localHosts = ["localhost", "127.0.0.1", "::1"];

    return localHosts.includes(window.location.hostname);
}

function canUseSpeechRecognition(){
    if(getSpeechRecognitionEngines().length === 0){
        alert("Voice to text is not supported in this browser. Please use Chrome or Edge.");
        return false;
    }

    if(!window.isSecureContext && !isLocalPage()){
        alert("Voice to text needs HTTPS, localhost, or 127.0.0.1.");
        return false;
    }

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        alert("Microphone access is not available in this browser.");
        return false;
    }

    return true;
}

function getVoiceTypingErrorMessage(errorName){
    const messages = {
        "NotAllowedError": "Microphone permission is blocked. Click the site info icon in the address bar and allow Microphone.",
        "NotFoundError": "No microphone was found. Please connect or enable your microphone.",
        "NotReadableError": "Your microphone is already being used by another app.",
        "SecurityError": "Voice to text needs HTTPS, localhost, or 127.0.0.1.",
        "not-allowed": "Microphone permission is blocked. Click the site info icon in the address bar and allow Microphone.",
        "service-not-allowed": "The speech recognition service is blocked here. Try Chrome or Edge on http://127.0.0.1:8000.",
        "audio-capture": "No microphone was found. Please connect or enable your microphone.",
        "network": "Speech recognition needs internet access. Please check your connection and try again.",
        "no-speech": "No speech was detected. Please speak clearly and try again.",
        "aborted": "Voice typing was stopped.",
    };

    return messages[errorName] || "Voice to text could not start in this browser. Try Chrome or Edge.";
}

function setRecordingButtonState(recording){
    const { recordButton } = getTranslatorElements();

    isRecording = recording;

    if(!recordButton){
        return;
    }

    recordButton.classList.toggle("recording", recording);
    
    const voiceWave = document.getElementById("voiceWave");
    if (voiceWave) {
        if (recording) {
            voiceWave.classList.add("active");
        } else {
            voiceWave.classList.remove("active");
        }
    }

    if (recording) {
        recordButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            </svg>
        `;
    } else {
        recordButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
        `;
    }

    recordButton.setAttribute(
        "aria-label",
        recording ? "Stop voice to text" : "Record voice to text"
    );
}

function addRecognizedText(newText){
    const { inputText } = getTranslatorElements();
    const currentText = inputText.value.trim();

    inputText.value = currentText ? currentText + " " + newText : newText;
    inputText.focus();
    handleInputChange();
}

function clearSuggestion(){
    const { suggestionBox, suggestionText } = getTranslatorElements();

    if(suggestionDebounceTimer){
        clearTimeout(suggestionDebounceTimer);
        suggestionDebounceTimer = null;
    }

    if(suggestionAbortController){
        suggestionAbortController.abort();
        suggestionAbortController = null;
    }

    if(suggestionText){
        suggestionText.textContent = "";
    }

    if(suggestionBox){
        suggestionBox.classList.add("hidden");
    }
}

function showSuggestion(suggestion){
    const { suggestionBox, suggestionText } = getTranslatorElements();

    if(!suggestionBox || !suggestionText){
        return;
    }

    suggestionText.textContent = suggestion;
    suggestionBox.classList.remove("hidden");
}

async function fetchTextSuggestion(){
    const { inputText, sourceLanguage } = getTranslatorElements();
    const textForSuggestion = inputText.value.trim();

    if(textForSuggestion === "" || sourceLanguage.value !== "en"){
        clearSuggestion();
        return;
    }

    if(suggestionAbortController){
        suggestionAbortController.abort();
    }

    const currentSuggestionController = new AbortController();
    suggestionAbortController = currentSuggestionController;

    try{
        const response = await authFetch("/api/suggest/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: textForSuggestion,
                source: sourceLanguage.value
            }),
            signal: currentSuggestionController.signal
        });

        const data = await response.json();

        if(!response.ok){
            throw new Error(data.error || "Suggestion failed.");
        }

        if(inputText.value.trim() !== textForSuggestion){
            return;
        }

        if(data.suggestion){
            showSuggestion(data.suggestion);
        }else{
            clearSuggestion();
        }
    }catch(error){
        if(error.name !== "AbortError"){
            clearSuggestion();
        }
    }finally{
        if(suggestionAbortController === currentSuggestionController){
            suggestionAbortController = null;
        }
    }
}

function scheduleTextSuggestion(){
    if(suggestionDebounceTimer){
        clearTimeout(suggestionDebounceTimer);
    }

    suggestionDebounceTimer = setTimeout(() => {
        suggestionDebounceTimer = null;
        fetchTextSuggestion();
    }, suggestionDelay);
}

function applySuggestion(){
    const { inputText, suggestionText } = getTranslatorElements();
    const suggestion = suggestionText.textContent.trim();

    if(!suggestion){
        return;
    }

    inputText.value = suggestion;
    inputText.focus();
    clearSuggestion();
    translateText({ auto: true });
}

async function requestMicrophoneAccess(){
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    stream.getTracks().forEach((track) => {
        track.stop();
    });
}

async function startVoiceTyping(recorderIndex = 0){
    const recorders = getSpeechRecognitionEngines();
    const recorder = recorders[recorderIndex];
    const { sourceLanguage } = getTranslatorElements();

    if(!recorder){
        alert("Voice to text could not start in this browser. Try Chrome or Edge.");

        return;
    }

    try{
        await requestMicrophoneAccess();
    }catch(error){
        alert(getVoiceTypingErrorMessage(error.name));
        return;
    }

    shouldTryNextRecorder = false;
    activeRecognition = new recorder.engine();
    activeRecognition.lang = speechLanguageCodes[sourceLanguage.value] || "en-US";
    activeRecognition.continuous = false;
    activeRecognition.interimResults = false;
    activeRecognition.maxAlternatives = 1;

    activeRecognition.onstart = () => {
        setRecordingButtonState(true);
    };

    activeRecognition.onresult = (event) => {
        const spokenText = event.results[0][0].transcript.trim();

        if(spokenText){
            addRecognizedText(spokenText);
        }
    };

    activeRecognition.onerror = (event) => {
        const fallbackErrors = ["network", "audio-capture", "no-speech"];

        if(fallbackErrors.includes(event.error) && recorderIndex + 1 < recorders.length){
            shouldTryNextRecorder = true;
            return;
        }

        alert(getVoiceTypingErrorMessage(event.error));
    };

    activeRecognition.onend = () => {
        activeRecognition = null;
        setRecordingButtonState(false);

        if(shouldTryNextRecorder){
            shouldTryNextRecorder = false;
            startVoiceTyping(recorderIndex + 1);
        }
    };

    try{
        activeRecognition.start();
    }catch(error){
        activeRecognition = null;
        setRecordingButtonState(false);

        if(recorderIndex + 1 < recorders.length){
            startVoiceTyping(recorderIndex + 1);
        }else{
            alert(getVoiceTypingErrorMessage(error.name));
        }
    }
}

function stopVoiceTyping(){
    shouldTryNextRecorder = false;

    if(activeRecognition){
        activeRecognition.stop();
    }

    setRecordingButtonState(false);
}

function toggleVoiceTyping(){
    if(isRecording){
        stopVoiceTyping();
        return;
    }

    if(!canUseSpeechRecognition()){
        return;
    }

    startVoiceTyping();
}

function clearTranslationRequest(){
    if(translationDebounceTimer){
        clearTimeout(translationDebounceTimer);
        translationDebounceTimer = null;
    }

    if(translationAbortController){
        translationAbortController.abort();
        translationAbortController = null;
    }
}

function resetTranslationOutput(message = defaultTranslationMessage){
    const { result, translateButton, outputBox } = getTranslatorElements();

    clearTranslationRequest();
    result.textContent = message;
    result.className = "";
    if (outputBox) {
        outputBox.className = "result-container empty";
    }
    translatedTextForVoice = "";
    removeOutputVoiceButton();
    translateButton.disabled = false;
}

async function translateText(options = {}){
    const {
        inputText,
        result,
        sourceLanguage,
        targetLanguage,
        translateButton,
        outputBox,
    } = getTranslatorElements();

    const textToTranslate = inputText.value.trim();
    const sourceAtRequest = sourceLanguage.value;
    const targetAtRequest = targetLanguage.value;
    const isAutoTranslation = Boolean(options.auto);

    if(textToTranslate === ""){
        resetTranslationOutput(isAutoTranslation ? defaultTranslationMessage : "Please enter some text.");
        return;
    }

    clearTranslationRequest();

    const currentTranslationController = new AbortController();
    translationAbortController = currentTranslationController;

    result.textContent = "Translating...";
    translatedTextForVoice = "";
    removeOutputVoiceButton();
    translateButton.disabled = true;
    if (outputBox) {
        outputBox.className = "result-container loading";
    }

    try{
        // Send the user's text and selected languages to Django.
        const response = await authFetch("/api/translate/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: textToTranslate,
                source: sourceAtRequest,
                target: targetAtRequest
            }),
            signal: currentTranslationController.signal
        });

        const data = await response.json();

        if(!response.ok){
            throw new Error(data.error || "Translation failed.");
        }

        if(
            inputText.value.trim() !== textToTranslate
            || sourceLanguage.value !== sourceAtRequest
            || targetLanguage.value !== targetAtRequest
        ){
            return;
        }

        if(
            sourceAtRequest === "en"
            && data.corrected_text
            && data.corrected_text !== textToTranslate
        ){
            showSuggestion(data.corrected_text);
        }

        translatedTextForVoice = data.translated_text || "";
        result.textContent = translatedTextForVoice;
        result.className = "success";
        if (outputBox) {
            outputBox.className = "result-container success";
        }
        removeOutputVoiceButton();

        if(translatedTextForVoice.trim() !== ""){
            createOutputVoiceButton();
        }
    }catch(error){
        if(error.name === "AbortError"){
            return;
        }

        result.textContent = error.message;
        result.className = "error";
        if (outputBox) {
            outputBox.className = "result-container error";
        }
        translatedTextForVoice = "";
        removeOutputVoiceButton();
    }finally{
        if(translationAbortController === currentTranslationController){
            translationAbortController = null;
            translateButton.disabled = false;
        }
    }
}

function scheduleLiveTranslation(){
    const { inputText, translateButton } = getTranslatorElements();

    if(translationDebounceTimer){
        clearTimeout(translationDebounceTimer);
    }

    if(translationAbortController){
        translationAbortController.abort();
        translationAbortController = null;
        translateButton.disabled = false;
    }

    if(inputText.value.trim() === ""){
        resetTranslationOutput();
        return;
    }

    translationDebounceTimer = setTimeout(() => {
        translationDebounceTimer = null;
        translateText({ auto: true });
    }, translationDelay);
}

function handleInputChange(){
    updateCharCount();
    scheduleTextSuggestion();
    scheduleLiveTranslation();
}

function handleLanguageChange(){
    scheduleTextSuggestion();
    scheduleLiveTranslation();
}

function speakWithBrowserVoice(text, languageCode){
    const textToSpeak = text.trim();

    if(!("speechSynthesis" in window)){
        return false;
    }

    loadVoices();
    window.speechSynthesis.cancel();

    activeSpeech = new SpeechSynthesisUtterance(textToSpeak);
    activeSpeech.rate = 0.9;
    activeSpeech.pitch = 1;

    const matchingVoice = findVoice(languageCode);

    if(matchingVoice){
        activeSpeech.voice = matchingVoice;
        activeSpeech.lang = matchingVoice.lang;
    }else{
        activeSpeech.lang = navigator.language || "en-US";
    }

    activeSpeech.onend = () => {
        activeSpeech = null;
    };

    activeSpeech.onerror = () => {
        activeSpeech = null;
    };

    window.speechSynthesis.speak(activeSpeech);
    return true;
}

function speakText(text, languageCode){
    const textToSpeak = text.trim();

    if(textToSpeak === "" || textToSpeak === "Your translation will appear here..."){
        return;
    }

    if("speechSynthesis" in window){
        window.speechSynthesis.cancel();
    }

    if(activeAudio){
        activeAudio.pause();
        activeAudio = null;
    }

    activeAudio = new Audio(getGoogleVoiceUrl(textToSpeak, languageCode));
    activeAudio.onended = () => {
        activeAudio = null;
    };
    activeAudio.onerror = () => {
        activeAudio = null;

        if(!speakWithBrowserVoice(textToSpeak, languageCode)){
            alert("Voice over is not supported in this browser.");
        }
    };

    activeAudio.play().catch(() => {
        activeAudio = null;

        if(!speakWithBrowserVoice(textToSpeak, languageCode)){
            alert("Voice over could not play. Please check your browser sound settings.");
        }
    });
}

function speakInputText(){
    const { inputText, sourceLanguage } = getTranslatorElements();

    speakText(inputText.value, sourceLanguage.value);
}

function speakOutputText(){
    const { result, targetLanguage } = getTranslatorElements();
    const textToSpeak = translatedTextForVoice || result.textContent;

    speakText(textToSpeak, targetLanguage.value);
}

function clearText(){
    const { inputText, result } = getTranslatorElements();

    stopVoiceTyping();

    if("speechSynthesis" in window){
        window.speechSynthesis.cancel();
    }

    if(activeAudio){
        activeAudio.pause();
        activeAudio = null;
    }

    inputText.value = "";
    resetTranslationOutput();
    clearSuggestion();
}

function swapLanguages(){
    const { sourceLanguage, targetLanguage } = getTranslatorElements();
    const currentSource = sourceLanguage.value;

    sourceLanguage.value = targetLanguage.value;
    targetLanguage.value = currentSource;
    handleLanguageChange();
    syncCustomDropdowns();
}

document.addEventListener("DOMContentLoaded", () => {
    const { inputText, sourceLanguage, targetLanguage, suggestionText } = getTranslatorElements();

    if(!getAccessToken()){
        redirectToLogin();
        return;
    }

    populateLanguages();
    removeOutputVoiceButton();
    loadVoices();

    if("speechSynthesis" in window){
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    inputText.addEventListener("input", handleInputChange);
    sourceLanguage.addEventListener("change", handleLanguageChange);
    targetLanguage.addEventListener("change", handleLanguageChange);
    suggestionText.addEventListener("click", applySuggestion);

    const logoutButton = document.getElementById("logoutBtn");
    if(logoutButton){
        logoutButton.addEventListener("click", logout);
    }

    // Initialize character count
    updateCharCount();

    // Toggle custom dropdowns on click
    const sourceTrigger = document.getElementById("customSourceLangTrigger");
    const targetTrigger = document.getElementById("customTargetLangTrigger");
    const sourceSelect = document.getElementById("customSourceLang");
    const targetSelect = document.getElementById("customTargetLang");

    if (sourceTrigger && sourceSelect) {
        sourceTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isActive = sourceSelect.classList.contains("active");
            closeAllDropdowns();
            if (!isActive) {
                sourceSelect.classList.add("active");
                sourceTrigger.setAttribute("aria-expanded", "true");
            }
        });
    }

    if (targetTrigger && targetSelect) {
        targetTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isActive = targetSelect.classList.contains("active");
            closeAllDropdowns();
            if (!isActive) {
                targetSelect.classList.add("active");
                targetTrigger.setAttribute("aria-expanded", "true");
            }
        });
    }

    document.addEventListener("click", () => {
        closeAllDropdowns();
    });

    function closeAllDropdowns() {
        if (sourceSelect && sourceTrigger) {
            sourceSelect.classList.remove("active");
            sourceTrigger.setAttribute("aria-expanded", "false");
        }
        if (targetSelect && targetTrigger) {
            targetSelect.classList.remove("active");
            targetTrigger.setAttribute("aria-expanded", "false");
        }
    }

    // Hook up search filter
    const searchInputs = document.querySelectorAll(".lang-search-input");
    searchInputs.forEach(input => {
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            const dropdown = e.target.closest(".custom-select");
            const options = dropdown.querySelectorAll(".custom-option");
            
            options.forEach(opt => {
                const label = opt.querySelector(".option-text").textContent.toLowerCase();
                const code = opt.getAttribute("data-value").toLowerCase();
                if (label.includes(query) || code.includes(query)) {
                    opt.style.display = "flex";
                } else {
                    opt.style.display = "none";
                }
            });
        });
    });
});

window.translateText = translateText;
window.clearText = clearText;
window.swapLanguages = swapLanguages;
window.speakInputText = speakInputText;
window.speakOutputText = speakOutputText;
window.speakResult = speakResult;
window.toggleVoiceTyping = toggleVoiceTyping;
window.copyResult = copyResult;
window.logout = logout;
