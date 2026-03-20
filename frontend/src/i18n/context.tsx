"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import en from "./en";
import ar from "./ar";

// ── Types ──

export type Locale = "en" | "ar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NestedDict = Record<string, any>;

const dictionaries: Record<Locale, NestedDict> = { en, ar };

/** Flatten nested object into dot-separated keys → string values */
function flatten(obj: NestedDict, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result[key] = v;
    } else if (typeof v === "object" && v !== null) {
      Object.assign(result, flatten(v, key));
    }
  }
  return result;
}

// Pre-flatten for fast lookup
const flat: Record<Locale, Record<string, string>> = {
  en: flatten(en),
  ar: flatten(ar),
};

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dir: "ltr" | "rtl";
  t: (key: string, params?: Record<string, string | number>) => string;
}

// ── Context ──

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

const STORAGE_KEY = "sme-locale";

// ── Provider ──

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Always start with "en" so server and client initial render match.
  // The stored preference is picked up in the useEffect below.
  const [locale, setLocaleState] = useState<Locale>("en");

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  // Hydrate stored locale preference after mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") {
      setLocaleState(stored);
    } else if (navigator.language.startsWith("ar")) {
      setLocaleState("ar");
    }
  }, []);

  // Sync <html> lang & dir attributes
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("lang", locale);
    html.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = flat[locale]?.[key] ?? flat.en[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
        }
      }
      return value;
    },
    [locale],
  );

  const dir: "ltr" | "rtl" = locale === "ar" ? "rtl" : "ltr";

  const ctx = useMemo(
    () => ({ locale, setLocale, dir, t }),
    [locale, setLocale, dir, t],
  );

  return (
    <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>
  );
}

// ── Hooks ──

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/** Shorthand — returns t() plus locale and dir for convenience */
export function useTranslation() {
  return useLocale();
}
