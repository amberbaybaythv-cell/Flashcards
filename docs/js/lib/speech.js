// Озвучка слов встроенным синтезом речи браузера (офлайн, без ключей).
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const TAG = { en: 'en-US', ru: 'ru-RU' };

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const tag = TAG[lang];
  return voices.find((v) => v.lang === tag) || voices.find((v) => v.lang.toLowerCase().startsWith(lang));
}

export function speak(text, lang) {
  if (!speechSupported || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = TAG[lang] || lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

if (speechSupported) speechSynthesis.getVoices(); // прогрев списка голосов
