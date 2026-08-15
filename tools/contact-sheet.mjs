// ============================================================================
//  Hoja de contactos del catálogo — TODAS las piezas de golpe, en un SVG.
//
//  Para qué: hasta ahora, para juzgar una pieza había que compilar la app,
//  instalarla y abrir sobres hasta que tocara. Eso hace imposible comparar
//  ("¿estos dos azules se distinguen?", "¿la legendaria se nota frente a la
//  épica?") y es justo por lo que en su día se descartó ampliar los chasis:
//  no se podían juzgar en un icono aislado, había que verlos a tamaño real.
//
//  Importa la MISMA geometría (src/carGeometry.js) y el MISMO catálogo
//  (src/car.js) que usa el juego. No hay una copia de la forma del coche
//  aquí: si diverge, es que alguien rompió el import, no que se olvidó de
//  actualizar dos sitios.
//
//  Uso:
//    node tools/contact-sheet.mjs            -> catalogo.svg
//    node tools/contact-sheet.mjs salida.svg
//
//  Lo que NO hace: el holográfico anima con el reloj real en el juego; aquí
//  se congela en una fase fija (se indica en la etiqueta). Para juzgar el
//  movimiento hay que verlo en el dispositivo.
// ============================================================================

import { writeFileSync } from 'node:fs';
import {
  wingGeomFor, liveryGeomFor, highlightEllipses, LIGHT_BEAMS,
} from '../src/carGeometry.js';
import { CHASSIS, chassisById, DEFAULT_CHASSIS } from '../src/chassis.js';
import { CAR_COLORS, WING_SHAPES, LIVERY_PATTERNS, LIGHT_COLORS, CAR_DEFAULTS } from '../src/car.js';

const CELL_W = 132;
const CELL_H = 116;
const COLS = 6;
const PAD = 22;

const BG = '#0b0b0c';
const INK = '#f2ede2';
const DIM = '#8c8c8c';
const BORDER = '#2a2a2c';
const RARITY = { rara: '#4fa9ff', epica: '#d63384', legendaria: '#f0c451' };

let uid = 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// --- Un coche completo, con el mismo orden de capas que CarSprite -----------
function carSvg(loadout, scale = 2.6) {
  const lo = { ...CAR_DEFAULTS, chassis: DEFAULT_CHASSIS, ...loadout };
  const ch = chassisById(lo.chassis);
  const id = `g${uid++}`;
  const entry = CAR_COLORS.find((c) => c.c === lo.bodyColor) || { c: lo.bodyColor, finish: 'flat' };

  let defs = '';
  let bodyFill = entry.c;
  let veta = '';

  if (entry.finish === 'holografico' && entry.stops) {
    defs = `<linearGradient id="${id}" x1="-50%" y1="0%" x2="50%" y2="100%">` +
      entry.stops.map((c, i) => `<stop offset="${i / (entry.stops.length - 1)}" stop-color="${c}"/>`).join('') +
      `</linearGradient>`;
    bodyFill = `url(#${id})`;
  } else if (entry.stops) {
    defs = `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="0%">` +
      entry.stops.map((c, i) => `<stop offset="${i / (entry.stops.length - 1)}" stop-color="${c}"/>`).join('') +
      `</linearGradient>`;
    veta = highlightEllipses(entry.finish)
      .map((e) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="url(#${id})" opacity="${e.opacity}"/>`)
      .join('');
  }

  const wing = wingGeomFor(ch, lo.wingShape)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.rx}" fill="${lo.wingColor}"/>`)
    .join('');

  const livery = !lo.livery ? '' : liveryGeomFor(ch, lo.liveryPattern).map((p) => {
    if (p.type === 'rect') return `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${lo.livery}"/>`;
    if (p.type === 'polygon') return `<polygon points="${p.points}" fill="${lo.livery}"/>`;
    if (p.type === 'circle') {
      return p.stroke
        ? `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="none" stroke="${lo.livery}" stroke-width="${p.strokeWidth}"/>`
        : `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${lo.livery}"/>`;
    }
    if (p.type === 'text') {
      return `<text x="${p.x}" y="${p.y}" font-size="${p.fontSize}" font-weight="${p.fontWeight}" text-anchor="${p.anchor}" fill="${lo.livery}">${esc(p.value)}</text>`;
    }
    return '';
  }).join('');

  const rect = (r, fill) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.rx}" fill="${fill}"/>`;
  // Ruedas descubiertas y demás añadidos del chasis: heredan el color del
  // cuerpo, así que van con él y antes de la librea.
  const extras = (ch.extras || []).map((r) => rect(r, bodyFill)).join('');
  const beams = LIGHT_BEAMS.map((b) => `<polygon points="${b.points}" fill="${lo.lightsColor}" opacity="${b.opacity}"/>`).join('');
  const bulbs = ch.lights.map((b) => `<circle cx="${b.x}" cy="${b.y}" r="1.7" fill="${lo.lightsColor}"/>`).join('');

  return `${defs ? `<defs>${defs}</defs>` : ''}<g transform="scale(${scale})">` +
    wing + extras +
    `<path d="${ch.body}" fill="${bodyFill}"/>` + veta + livery +
    rect(ch.grille, 'rgba(0,0,0,0.18)') + rect(ch.cabin, '#1b2733') + rect(ch.splitter, '#0f1218') +
    beams + bulbs +
    `</g>`;
}

// --- Una celda: coche + nombre + rareza -------------------------------------
function cell(x, y, loadout, label, rarity) {
  const rc = rarity ? RARITY[rarity] : DIM;
  return `<g transform="translate(${x} ${y})">` +
    `<rect x="0" y="0" width="${CELL_W}" height="${CELL_H}" fill="none" stroke="${BORDER}" stroke-width="1"/>` +
    `<g transform="translate(${CELL_W / 2} ${CELL_H / 2 - 12})">${carSvg(loadout)}</g>` +
    `<text x="${CELL_W / 2}" y="${CELL_H - 26}" font-size="10" font-family="monospace" fill="${INK}" text-anchor="middle">${esc(label)}</text>` +
    (rarity
      ? `<text x="${CELL_W / 2}" y="${CELL_H - 12}" font-size="8" font-family="monospace" fill="${rc}" text-anchor="middle" letter-spacing="1">${rarity.toUpperCase()}</text>`
      : `<text x="${CELL_W / 2}" y="${CELL_H - 12}" font-size="8" font-family="monospace" fill="${DIM}" text-anchor="middle" letter-spacing="1">LIBRE</text>`) +
    `</g>`;
}

// --- Composición ------------------------------------------------------------
const sections = [
  {
    // Cada chasis con el MISMO color y alerón, que es la única forma de
    // juzgar la silueta: si cada uno lleva su color, se compara el color.
    title: 'CHASIS · silueta',
    items: CHASSIS.map((c) => ({
      loadout: { chassis: c.id, bodyColor: '#ffffff', wingColor: '#e4002b', wingShape: 'cuello_cisne' },
      label: c.label,
      rarity: c.rarity,
    })),
  },
  {
    // El mismo chasis con cada alerón, para ver que el anclaje encaja.
    title: 'CHASIS × ALERÓN · encaje',
    items: CHASSIS.map((c) => ({
      loadout: { chassis: c.id, bodyColor: '#1a1a1c', wingColor: '#f0c451', wingShape: 'cola_de_pato', liveryPattern: 'diagonal', livery: '#4fa9ff' },
      label: `${c.label} + cola`,
      rarity: c.rarity,
    })),
  },
  {
    title: 'CARROCERÍA · color',
    items: CAR_COLORS.map((c) => ({
      loadout: { bodyColor: c.c, wingColor: c.c },
      label: c.label || c.id,
      rarity: c.rarity,
    })),
  },
  {
    title: 'ALERÓN · forma',
    items: WING_SHAPES.map((w) => ({
      loadout: { wingShape: w.id, bodyColor: '#ffffff', wingColor: '#e4002b' },
      label: w.label,
      rarity: w.rarity,
    })),
  },
  {
    title: 'LIBREA · patrón',
    items: LIVERY_PATTERNS.map((l) => ({
      loadout: { liveryPattern: l.id, livery: '#e4002b', bodyColor: '#ffffff' },
      label: l.label,
      rarity: l.rarity,
    })),
  },
  {
    title: 'FAROS · color',
    items: LIGHT_COLORS.map((l) => ({
      loadout: { lightsColor: l.c, bodyColor: '#1a1a1c' },
      label: l.label || l.id,
      rarity: l.rarity,
    })),
  },
];

let y = PAD;
let body = '';
let total = 0;

for (const sec of sections) {
  body += `<text x="${PAD}" y="${y + 12}" font-size="13" font-family="monospace" font-weight="700" fill="${INK}" letter-spacing="1">${esc(sec.title)}</text>`;
  body += `<text x="${PAD + 320}" y="${y + 12}" font-size="11" font-family="monospace" fill="${DIM}">${sec.items.length} piezas</text>`;
  y += 26;

  sec.items.forEach((it, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    body += cell(PAD + col * (CELL_W + 10), y + row * (CELL_H + 10), it.loadout, it.label, it.rarity);
  });

  y += Math.ceil(sec.items.length / COLS) * (CELL_H + 10) + 22;
  total += sec.items.length;
}

const W = PAD * 2 + COLS * (CELL_W + 10) - 10;
const H = y + PAD;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="${BG}"/>` +
  `<text x="${PAD}" y="${PAD - 6}" font-size="10" font-family="monospace" fill="${DIM}">` +
  `APEXLY · catálogo completo · ${total} piezas · holográfico congelado en una fase fija</text>` +
  body +
  `</svg>`;

const out = process.argv[2] || 'catalogo.svg';
writeFileSync(out, svg);
console.log(`${out} — ${total} piezas, ${W}x${H}px`);
for (const sec of sections) console.log(`  ${sec.title}: ${sec.items.length}`);
