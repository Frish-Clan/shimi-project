export function normalize(value, min, max) {
  if (min === max) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
