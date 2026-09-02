# Notas de versión — 2.4.2

Sustituye a `notas-version-2.4.1.md` (ese documento queda como histórico —
la 2.4.1 nunca llegó a pasar la revisión de iOS, así que su contenido y el
de esta se solapan). Misma estructura: corta para Play, larga para App
Store.

---

## Corta — Google Play ("Novedades de esta versión")

```
🏆 Grand Prix: crea una temporada de 7 circuitos con tu grupo y pelea la
general, no solo el día. Ahora con colores de podio por ronda.

🧭 Indicador de curva: una flecha te avisa de si viene recta, izquierda o
derecha — cada circuito es nuevo cada día, ya no hace falta memorizarlo.

🎨 Cada circuito con su ambiente: el escenario cambia de tono según el
trazado, ya no es siempre el mismo fondo.

📸 Compartir mejorado: la tarjeta de tu vuelta lleva enlace directo a la
tienda.

🐛 Arreglos: la salida ya siempre es recta, el aviso de monedas de ranking
no se pierde, y varios retoques de estabilidad.
```

(≈480 caracteres — dentro del límite típico de Play)

---

## Larga — App Store ("Novedades")

```
Indicador de siguiente curva

Una flecha te avisa con antelación de si viene recta, izquierda o derecha.
Cada circuito es nuevo cada día — ya no hace falta memorizarlo para saber
qué toca a continuación.

Grand Prix — el modo que pedíais

Arranca una temporada con tu grupo: 7 circuitos exclusivos, formato
clasificación (2 vueltas de calentamiento + la que cuenta), puntos F1
acumulados y una general que se pelea toda la semana, no solo hoy. La
tira de resultados por ronda ahora tiene color de podio: morado, oro,
plata y bronce según tu puesto.

Cada circuito con su ambiente

El escenario ya no es siempre el mismo fondo oscuro: el tono cambia según
el propio trazado, día a día.

Amigos, al día

Si un grupo tuyo tiene una ronda de Grand Prix esperando, ahora lo ves de
un vistazo sin entrar a mirar uno por uno.

Compartir con gancho

La tarjeta de tu vuelta lleva enlace directo a la tienda, así que si la
mandas a un grupo, quien la reciba puede entrar a jugar sin buscar nada.

Más sensación en cada carrera

· Aviso de "casi" cuando rozas tu mejor marca sin llegar a batirla
· Los sectores se revelan uno a uno al cruzar meta, no todos de golpe
· El coche del líder mundial corre contigo en pantalla, con su nombre
  encima — para que sepas en todo momento cuánto le sacas o le debes
· El titular de rivalidad ahora muestra milésimas, no solo décimas
· El Garaje confirma visualmente que cada cambio se ha guardado

Arreglos

· La salida de cada vuelta ahora siempre es recta, sin tirón hacia el
  lado que tocaste para arrancar
· El aviso de monedas ganadas por el ranking podía no llegar a mostrarse
  la primera vez que abrías la app
· El recordatorio de las 20h dejaba de respetar que ya hubieras jugado
  en algunos casos
· Los sectores de Grand Prix y Carrera pintaban mal algunos colores
· Varios retoques de seguridad en cómo se guardan los tiempos
```

(≈1500 caracteres — cómodo dentro del límite de 4000 de App Store)

---

## Qué se ha dejado fuera a propósito

- **Nada sobre el volante.** Quitar los botones es un cambio estético
  interno (pantalla más limpia); no es una novedad que el jugador note como
  "feature".
- **Nada sobre el ATT ni sobre los rechazos de Apple.** Es cumplimiento, no
  contenido — va explicado aparte en `docs/review-notes.md`, en las Review
  Notes del envío, no en las notas públicas.
- **Nada del cierre del ranking escribible a mano.** Fix de seguridad
  server-side; anunciarlo solo invita a quien no lo sabía a intentarlo antes
  de actualizar.
