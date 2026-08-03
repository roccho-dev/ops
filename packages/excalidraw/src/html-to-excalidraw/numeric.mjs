export function number(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Match Python round() used by the predecessor proof implementation.
export function roundHalfEven(value, digits = 0) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const absolute = Math.abs(scaled);
  const lower = Math.floor(absolute);
  const fraction = absolute - lower;
  const tolerance = Number.EPSILON * Math.max(1, absolute) * 4;
  let rounded;
  if (Math.abs(fraction - 0.5) <= tolerance) {
    rounded = lower % 2 === 0 ? lower : lower + 1;
  } else {
    rounded = Math.round(absolute);
  }
  return (sign * rounded) / factor;
}

export function rgbToHex(value, whiteBlend = true) {
  if (!value || value === "transparent") return null;
  if (value.startsWith("#")) return value.toLowerCase();

  const match = value.match(
    /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)$/,
  );
  if (!match) return null;

  let red = Number(match[1]);
  let green = Number(match[2]);
  let blue = Number(match[3]);
  const alpha = Number(match[4] ?? 1);
  if (alpha <= 0) return null;

  if (alpha < 1 && whiteBlend) {
    red = Math.round(red * alpha + 255 * (1 - alpha));
    green = Math.round(green * alpha + 255 * (1 - alpha));
    blue = Math.round(blue * alpha + 255 * (1 - alpha));
  }

  return `#${[red, green, blue]
    .map((component) => clamp(component, 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
