import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import sw from "./locales/sw.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "sw", label: "Swahili", nativeLabel: "Kiswahili" },
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGUAGES)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      sw: { translation: sw },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "sw"],
    // Detection order: localStorage → navigator language
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "smartprop_lang",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
