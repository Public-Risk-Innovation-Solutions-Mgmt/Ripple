// ============================================================================
// THE RIPPLE LOGO IN THE TOP BAR — the full logo (the mark, "Ripple" and
// "Powered by PRISM"), from docs/brand/Ripple Logo.png.
//
// ⚠ SERVED AT ITS NATIVE RESOLUTION AND ONLY EVER SCALED DOWN. public/ripple-logo.png
// is the source with its white margin cropped off (a crop: no pixel resampled),
// 263 x 284. The bar shows it 44-56px tall, so even a 3x phone screen draws it
// at or below the file's own pixels. It is still soft beside the bar's text: a
// larger PNG or an SVG of the logo would make it crisper, and only this file and
// that image would change.
//
// ⚠ ITS BACKGROUND IS WHITE, NOT TRANSPARENT, and its lettering is black — so on
// the dark single-player bar it sits on a white rounded tile (`tile`), and on
// the host's white bar it needs none.
// ============================================================================

// Read through a cast, as session/index.ts and adminAuth.ts read the env: the
// scripts' tsconfig (and node, which renders nothing of this) has no Vite types.
const BASE = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.BASE_URL ?? '/';
const SRC = `${BASE}ripple-logo.png`;
/** The file's own size: the width and height attributes keep the bar from shifting while it loads. */
const WIDTH = 263;
const HEIGHT = 284;

/** The logo's width per pixel of height: the file's own proportions. */
export const LOGO_ASPECT = WIDTH / HEIGHT;

export default function RippleBrandLogo({ tile = false, className = '', height }: {
  tile?: boolean; className?: string;
  /** A height in px, when the bar sets one it has measured; otherwise the className sizes it. */
  height?: number;
}) {
  const img = (
    <img
      src={SRC}
      width={WIDTH}
      height={HEIGHT}
      alt="Ripple"
      data-testid="ripple-logo"
      decoding="async"
      className={`block w-auto ${className}`}
      style={height !== undefined ? { height } : undefined}
    />
  );
  return tile ? <span className="flex-shrink-0 rounded-md bg-white p-0.5">{img}</span> : <span className="flex-shrink-0">{img}</span>;
}
