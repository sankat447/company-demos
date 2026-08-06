import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import hi from './hi.json';

export const SUPPORTED_LOCALES = ['en', 'hi'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const deviceLanguage = getLocales()[0]?.languageCode;
const initialLocale: AppLocale = deviceLanguage === 'hi' ? 'hi' : 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLocale(locale: AppLocale): void {
  void i18n.changeLanguage(locale);
}

export function currentLocale(): AppLocale {
  return i18n.language === 'hi' ? 'hi' : 'en';
}

/** Server-driven copy comes as EN+HI pairs; pick by active locale. */
export function pickLang(en: string, hi?: string | null): string {
  return currentLocale() === 'hi' && hi ? hi : en;
}

export function toggleLocale(): void {
  setLocale(currentLocale() === 'hi' ? 'en' : 'hi');
}

export default i18n;
