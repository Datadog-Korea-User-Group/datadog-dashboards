/**
 * Isometric brand illustration for the home hero. Pure inline SVG, no client JS.
 *
 * Motif: extruded geometric forms lit from the top-left, so every top face is
 * bright and every extruded side face is a dark purple. Left to right the scene
 * reads as a stack of discs (dashboards piling up), an exclamation pillar
 * (alerting) and concentric ripples (a signal spreading), with small tiles as
 * loose widgets. Floating is done in CSS (.hero-float-*), disabled under
 * prefers-reduced-motion.
 */

const LILAC = "#beaaff";
const PURPLE = "#632ca6";
const BLUE = "#006bc2";
const PINK = "#d9539b"; // #ff0080, desaturated so it sits next to the purples
const SIDE = "#451481"; // extruded side faces, single light source
const SHADE = "#2f1a4e";

export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 360"
      width="520"
      height="360"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <filter id="ha-blur" x="-45%" y="-60%" width="190%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* contact shadows, kept on the floor so the shapes read as floating */}
      <g filter="url(#ha-blur)" fill={SHADE} opacity="0.18">
        <ellipse cx="132" cy="324" rx="84" ry="13" />
        <ellipse cx="262" cy="292" rx="30" ry="9" />
        <ellipse cx="398" cy="326" rx="92" ry="12" />
      </g>

      {/* small disc, top-left accent */}
      <g className="hero-float-5">
        <path d="M44,110 L44,126 A34,14 0 0 0 112,126 L112,110 A34,14 0 0 0 44,110 Z" fill={PURPLE} />
        <ellipse cx="78" cy="110" rx="34" ry="14" fill={LILAC} />
      </g>

      {/* stacked discs */}
      <g className="hero-float-1">
        <path d="M46,252 L46,278 A86,36 0 0 0 218,278 L218,252 A86,36 0 0 0 46,252 Z" fill={PURPLE} />
        <ellipse cx="132" cy="252" rx="86" ry="36" fill={LILAC} />
        <path d="M66,224 L66,252 A66,27 0 0 0 198,252 L198,224 A66,27 0 0 0 66,224 Z" fill={SIDE} />
        <ellipse cx="132" cy="224" rx="66" ry="27" fill={BLUE} />
        <path d="M86,200 L86,224 A46,19 0 0 0 178,224 L178,200 A46,19 0 0 0 86,200 Z" fill={PURPLE} />
        <ellipse cx="132" cy="200" rx="46" ry="19" fill={LILAC} />
      </g>

      {/* extruded exclamation pillar */}
      <g className="hero-float-2">
        <rect x="251" y="87" width="30" height="132" rx="15" fill={PURPLE} />
        <circle cx="266" cy="252" r="15" fill={SIDE} />
        <rect x="240" y="76" width="30" height="132" rx="15" fill={LILAC} />
        <circle cx="255" cy="241" r="15" fill={PINK} />
      </g>

      {/* concentric ripples */}
      <g className="hero-float-3" fill="none" strokeWidth="14" strokeLinecap="round">
        <g stroke={SIDE}>
          <path d="M302,239 A96,96 0 0 1 494,239" />
          <path d="M330,239 A68,68 0 0 1 466,239" />
          <path d="M358,239 A40,40 0 0 1 438,239" />
        </g>
        <path d="M296,232 A96,96 0 0 1 488,232" stroke={LILAC} />
        <path d="M324,232 A68,68 0 0 1 460,232" stroke={BLUE} />
        <path d="M352,232 A40,40 0 0 1 432,232" stroke={PINK} />
      </g>

      {/* loose tiles */}
      <g className="hero-float-4">
        <rect x="308" y="268" width="44" height="44" rx="13" fill={SIDE} />
        <rect x="300" y="260" width="44" height="44" rx="13" fill={BLUE} />
        <rect x="372" y="284" width="32" height="32" rx="10" fill={PURPLE} />
        <rect x="366" y="278" width="32" height="32" rx="10" fill={LILAC} />
      </g>
    </svg>
  );
}

/** Compact cut of the same scene: one pillar plus the ripples. Used on 404. */
export function HeroArtMini({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 175" width="240" height="175" aria-hidden="true" focusable="false" className={className}>
      <g fill={SHADE} opacity="0.16">
        <ellipse cx="38" cy="160" rx="26" ry="7" />
        <ellipse cx="152" cy="160" rx="66" ry="8" />
      </g>
      <g className="hero-float-2">
        <rect x="35" y="41" width="24" height="76" rx="12" fill={PURPLE} />
        <circle cx="47" cy="137" r="12" fill={SIDE} />
        <rect x="26" y="32" width="24" height="76" rx="12" fill={LILAC} />
        <circle cx="38" cy="128" r="12" fill={PINK} />
      </g>
      <g className="hero-float-3" fill="none" strokeWidth="11" strokeLinecap="round">
        <g stroke={SIDE}>
          <path d="M87,145 A70,70 0 0 1 227,145" />
          <path d="M109,145 A48,48 0 0 1 205,145" />
          <path d="M131,145 A26,26 0 0 1 183,145" />
        </g>
        <path d="M82,140 A70,70 0 0 1 222,140" stroke={LILAC} />
        <path d="M104,140 A48,48 0 0 1 200,140" stroke={BLUE} />
        <path d="M126,140 A26,26 0 0 1 178,140" stroke={PINK} />
      </g>
    </svg>
  );
}
