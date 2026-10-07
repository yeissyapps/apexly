// ============================================================================
//  i18n — la app en español o en inglés (JC, 2026-10-07: "quiero que toda la
//  app se pueda usar en inglés").
//
//  Estilo gettext: la CLAVE es el propio texto en español, tal cual aparece en
//  el código, y `t()` lo cambia por su traducción (src/i18n/en.js) si el
//  idioma es inglés. Así el código se sigue leyendo en español, no hace falta
//  inventar un nombre para cada texto, y lo que no tenga traducción sale en
//  español en vez de romperse.
//
//    t('Jugar')                              -> 'Play'
//    t('Te faltan {n} min', { n: 3 })        -> 'You have 3 min left'
//
//  Los textos que vienen de DATOS (nombres de piezas, clima, circuito...) se
//  traducen igual, en el sitio donde se pintan: t(pieza.label). Por eso los
//  datos se quedan en español y NO se traducen al definirlos — una constante
//  de módulo se evalúa una sola vez y no se enteraría del cambio de idioma.
//
//  Idioma: el del móvil la primera vez (español si el sistema está en
//  español, catalán, gallego o euskera; si no, inglés), y luego el que elija
//  el jugador en su Perfil, guardado en el dispositivo. Al cambiarlo, index.js
//  vuelve a montar la app entera (key = idioma), así que no hace falta que
//  cada pantalla escuche el cambio.
//
//  `npm run check:i18n` (tools/check-i18n.mjs) avisa de cualquier t('...')
//  que no tenga traducción en en.js.
// ============================================================================

import { useSyncExternalStore } from 'react';
import { I18nManager, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import EN from './i18n/en';

export const LANGS = ['es', 'en'];
const KEY = 'lang:v1';
const SPANISH_LIKE = ['es', 'ca', 'gl', 'eu'];

function deviceLocale() {
  // De más a menos fiable; con la nueva arquitectura de RN algún módulo puede
  // no estar, así que se prueba en cadena y al final cae a Intl (Hermes lo
  // resuelve con el idioma del sistema).
  try {
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      const l = s?.AppleLanguages?.[0] || s?.AppleLocale;
      if (l) return l;
    }
  } catch (_) {}
  try {
    const l = I18nManager.getConstants?.().localeIdentifier || NativeModules.I18nManager?.localeIdentifier;
    if (l) return l;
  } catch (_) {}
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch (_) {
    return '';
  }
}

export function deviceLang() {
  const base = String(deviceLocale()).toLowerCase().split(/[-_]/)[0];
  return SPANISH_LIKE.includes(base) ? 'es' : 'en';
}

let lang = deviceLang();
const listeners = new Set();

export function getLang() {
  return lang;
}

// Lee la elección guardada (si la hay). Se llama una vez al arrancar.
export async function loadSavedLang() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (LANGS.includes(saved) && saved !== lang) {
      lang = saved;
      listeners.forEach((l) => l());
    }
  } catch (_) {}
}

export async function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { await AsyncStorage.setItem(KEY, next); } catch (_) {}
  listeners.forEach((l) => l());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLang() {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

function fill(s, params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

export function t(es, params) {
  if (es == null) return '';
  const s = lang === 'en' ? (EN[es] ?? es) : es;
  return fill(s, params);
}

// Ordinal de un puesto: "3.º" / "3rd".
export function ord(n) {
  if (lang !== 'en') return `${n}.º`;
  const m100 = n % 100;
  const suf = m100 >= 11 && m100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suf}`;
}

// Etiquetas compuestas con " · " (nombre del circuito: "Estrecho · Chicanes").
export function tParts(label) {
  if (!label) return '';
  return String(label).split(' · ').map((p) => t(p)).join(' · ');
}

// Para bloques que no son solo texto (frases con trozos en otro color, listas
// de funciones...): elige la variante del idioma actual.
export function pick(byLang) {
  return byLang[lang] ?? byLang.es;
}
