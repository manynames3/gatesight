export function Brand() {
  return (
    <div className="brand">
      <svg
        className="brand-symbol"
        viewBox="0 0 180 144"
        role="img"
        aria-label="GateSight"
      >
        <defs>
          <mask id="gatesight-aperture">
            <rect width="128" height="128" rx="26" fill="white" />
            <rect x="26" y="26" width="76" height="76" rx="12" fill="black" />
            <rect x="82" y="45" width="46" height="36" fill="black" />
            <rect x="67" y="64" width="61" height="18" rx="4" fill="white" />
          </mask>
        </defs>
        <rect
          width="128"
          height="128"
          rx="26"
          fill="currentColor"
          mask="url(#gatesight-aperture)"
        />
        <rect x="142" y="64" width="18" height="18" rx="4" fill="currentColor" />
      </svg>
      <div className="brand-copy">
        <span className="brand-name">
          <strong>Gate</strong>Sight
        </span>
        <small>by Supreme AI Ventures</small>
      </div>
    </div>
  );
}
