interface SparklineProps {
  values: number[];
  max?: number;
  height?: number;
  label: string;
}

export function Sparkline({ values, max, height = 44, label }: SparklineProps) {
  const width = 220;
  const pts = values.length > 1 ? values : [0, ...values];
  const peak = Math.max(max || 1, ...pts, 1);
  const stepX = width / Math.max(1, pts.length - 1);

  const coords = pts.map((v, i) => {
    const x = i * stepX;
    const y = height - Math.max(2, Math.min(height - 2, (v / peak) * (height - 4)));
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={label}
      style={{ display: 'block', marginTop: '0.35rem' }}
    >
      <defs>
        <linearGradient id={`grad-${label.replace(/\W+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#37abc8" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#247083" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#grad-${label.replace(/\W+/g, '')})`} />
      <path d={linePath} fill="none" stroke="#37abc8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
