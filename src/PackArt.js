// ============================================================================
//  PackArt — el sobre, dibujado como objeto.
//
//  Antes la tienda solo ponía la palabra "SOBRE": no había nada que mirar ni
//  que desear, y comprar es un acto de deseo. Esto le da cuerpo.
//
//  DIRECCIÓN (deliberada, no gacha): un PASE DE PADDOCK sellado, no un sobre
//  de purpurina con destellos. Vocabulario del mundo del juego —franja
//  diagonal de la marca, tipografía mono, número de serie troquelado, sello
//  lacrado con el ápex— porque el resto de la app está construida así y un
//  sobre brillante de gacha genérico se leería como pegado de otro juego.
//
//  `variant`:
//    'paid' -> el que compras con monedas (sello en rojo de marca)
//    'free' -> el regalo de la racha de 7 días (sello dorado, y lo dice)
// ============================================================================

import Svg, {
  Defs, Pattern, Rect, G, Path, Circle, Text as SvgText, Line, ClipPath,
} from 'react-native-svg';
import { RD } from './theme';

export default function PackArt({ width = 116, variant = 'paid', serial = '000' }) {
  // Proporción de credencial (ISO 7810 girada), no de sobre de cromos: es lo
  // que la hace leer como acreditación y no como chuchería.
  const H = width * 1.42;
  // El de regalo va en VERDE y no en dorado: el dorado ya es la moneda (y el
  // podio), así que un sobre dorado al lado del saldo dorado se leía como
  // "sobre de pago". El verde dice "esto ya es tuyo, no cuesta nada".
  const seal = variant === 'free' ? RD.successGreen : RD.brand;
  const sealInk = variant === 'free' ? '#04220f' : '#ffffff';

  return (
    <Svg width={width} height={H} viewBox="0 0 100 142">
      <Defs>
        <Pattern id="pk-stripe" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
          <Rect width="10" height="10" fill={RD.bg} />
          <Rect width="5" height="10" fill={seal} />
        </Pattern>
        {/* Recorta la franja a la silueta del pase para que no se salga por
            la esquina cortada de abajo. */}
        <ClipPath id="pk-body">
          <Path d="M2,2 H98 V128 L86,140 H2 Z" />
        </ClipPath>
      </Defs>

      <G clipPath="url(#pk-body)">
        <Rect x="0" y="0" width="100" height="142" fill="#131316" />
        {/* Cabecera con la franja de marca: la misma que corona cada pantalla
            de la app (DangerStripe), aquí como banda del pase. */}
        <Rect x="0" y="0" width="100" height="13" fill="url(#pk-stripe)" />

        {/* Ventana troquelada con el ápex — el vértice de curva que da nombre
            al juego, mismo trazo que el logo. */}
        <Rect x="14" y="26" width="72" height="52" fill="#0b0b0c" stroke={RD.panelBorder} strokeWidth="1" />
        <Path
          d="M24,68 C34,68 40,58 50,42 C60,58 66,68 76,68"
          fill="none"
          stroke={seal}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Circle cx="50" cy="42" r="3.4" fill={seal} />

        {/* Datos del pase, en mono como el resto de números de la app. */}
        <SvgText x="14" y="88" fill={RD.textSecondary} fontSize="7" letterSpacing="1.2">
          PADDOCK PASS
        </SvgText>
        <Line x1="14" y1="93" x2="86" y2="93" stroke={RD.panelBorder} strokeWidth="1" />
        <SvgText x="14" y="105" fill={RD.textPrimary} fontSize="8.5" letterSpacing="0.4">
          {variant === 'free' ? 'REGALO · RACHA 7' : '1 PIEZA'}
        </SvgText>
        {/* El nº de serie va a la DERECHA del lacre (que ocupa x 13-31): en
            la esquina inferior izquierda quedaba justo debajo y el sello lo
            tapaba. */}
        <SvgText x="40" y="125" fill={RD.textTertiary} fontSize="6" letterSpacing="1">
          N.º {String(serial).padStart(3, '0')}
        </SvgText>

        {/* Código de barras: relleno visual con sentido (un pase lo lleva),
            no decoración abstracta. Anchos variados para que no parezca una
            trama repetida.
            OJO con la escala: el patrón llega a 38 unidades, así que el
            factor tiene que dejarlo dentro del borde (x < 96) o el clip lo
            corta por la mitad y parece un error de dibujo. */}
        <G>
          {[0, 3, 5, 9, 11, 12, 16, 19, 21, 25, 27, 31, 33, 34, 38].map((x, i) => (
            <Rect
              key={x}
              x={52 + x * 1.15}
              y={97}
              width={i % 3 === 0 ? 1.5 : 0.9}
              height={12}
              fill={RD.textDisabled}
            />
          ))}
        </G>
      </G>

      {/* Silueta por encima de todo: esquina inferior cortada, como una
          acreditación de verdad. */}
      <Path
        d="M2,2 H98 V128 L86,140 H2 Z"
        fill="none"
        stroke={RD.panelBorder}
        strokeWidth="1.5"
      />
      {/* Sello lacrado: comunica "sin abrir". Va abajo a la IZQUIERDA, no
          sobre la esquina cortada — ahí tapaba justo el corte, así que el
          pase se leía como un rectángulo plano y el sello parecía pegado
          por error. Separados, se leen las dos cosas. */}
      <Circle cx="22" cy="120" r="9" fill={seal} />
      <SvgText
        x="22" y="123.5" fill={sealInk} fontSize="8.5" fontWeight="bold" textAnchor="middle"
      >
        A
      </SvgText>
    </Svg>
  );
}
