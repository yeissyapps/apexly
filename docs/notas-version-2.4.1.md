# Notas de versión — 2.4.1

Dos formatos: una corta para Play Store (tiene límite de espacio real) y una
larga para App Store (hay sitio de sobra, y conviene aprovecharlo).

---

## Corta — Google Play ("Novedades de esta versión")

```
🏆 Grand Prix: crea una temporada de 7 circuitos con tu grupo y pelea la
general, no solo el día.

📸 Compartir mejorado: la tarjeta de tu vuelta ahora lleva enlace directo
a la tienda, para que quien la reciba pueda jugar.

✨ Más feedback en cada vuelta: te avisamos cuando casi bates tu marca,
los sectores se revelan uno a uno, y ves cuánto le sacas al líder mundial
mientras corres.

🐛 Arreglos: el recordatorio de las 20h ya no llega si has jugado, los
sectores se leen bien en Grand Prix y Carrera, y varios retoques de
seguridad y estabilidad.
```

(438 caracteres — dentro del límite típico de Play)

---

## Larga — App Store ("Novedades")

```
Grand Prix — el modo que pedíais

Arranca una temporada con tu grupo: 7 circuitos exclusivos, formato
clasificación (2 vueltas de calentamiento + la que cuenta), puntos F1
acumulados y una general que se pelea toda la semana, no solo hoy.

Compartir con gancho

La tarjeta de tu vuelta ahora lleva enlace directo a la tienda, así que
si la mandas a un grupo, quien la reciba puede entrar a jugar sin buscar
nada.

Más sensación en cada carrera

· Aviso de "casi" cuando rozas tu mejor marca sin llegar a batirla
· Los sectores se revelan uno a uno al cruzar meta, no todos de golpe
· El coche del líder mundial corre contigo en pantalla, con su nombre
  encima — para que sepas en todo momento cuánto le sacas o le debes
· El titular de rivalidad ahora muestra milésimas, no solo décimas

Arreglos

· El recordatorio de las 20h dejaba de respetar que ya hubieras jugado
  en algunos casos — solucionado
· Los sectores de Grand Prix y Carrera pintaban mal algunos colores
· Varios retoques de seguridad en cómo se guardan los tiempos
```

(≈1000 caracteres — cómodo dentro del límite de 4000 de App Store)

---

## Qué se ha dejado fuera a propósito

- **Nada sobre el volante.** Quitar los botones es un cambio estético
  interno (pantalla más limpia); no es una novedad que el jugador note como
  "feature", así que no ocupa espacio en las notas. Si alguien pregunta por
  qué ya no ve botones, es eso.
- **Nada sobre el ATT ni sobre el rechazo de Apple.** Es cumplimiento, no
  contenido — no aporta nada al jugador y en la review de Apple ya va
  explicado aparte en `docs/review-notes.md`.
- **Nada del cierre del ranking escribible a mano.** Es un fix de seguridad
  server-side; anunciarlo solo invita a quien no lo sabía a intentarlo antes
  de actualizar.
