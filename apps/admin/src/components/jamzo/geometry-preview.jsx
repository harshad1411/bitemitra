/**
 * Lightweight SVG preview of a GeoJSON Polygon/MultiPolygon. A real map editor needs a maps provider
 * (DECISIONS Q-14) and arrives later; this lets admins sanity-check a pasted shape now.
 */
export function GeometryPreview({ geometry, size = 160, label = 'Shape preview' }) {
  const polys =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const pts = polys.flat(2);
  if (!pts.length)
    return (
      <div
        className="grid place-items-center rounded border text-xs text-muted-foreground"
        style={{ width: size, height: size }}
      >
        No shape
      </div>
    );
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = 8;
  const scale = (size - pad * 2) / span;
  const toPath = (ring) =>
    ring
      .map(
        ([x, y], i) =>
          `${i ? 'L' : 'M'}${(pad + (x - minX) * scale).toFixed(1)},${(pad + (maxY - y) * scale).toFixed(1)}`,
      )
      .join(' ') + ' Z';
  return (
    <svg width={size} height={size} role="img" aria-label={label} className="rounded border bg-muted/40">
      {polys.map((poly, i) => (
        <path
          key={i}
          d={poly.map(toPath).join(' ')}
          fillRule="evenodd"
          className="fill-primary/20 stroke-primary"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}
