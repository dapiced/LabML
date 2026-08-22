/**
 * V28 — a schematic of the browser's Network panel, drawn rather than
 * screenshotted: DevTools is browser chrome, so no capture we could take here
 * would be honest for every browser and every locale. It is labelled as a
 * diagram on the page, and the text next to it names the real menus.
 */
export interface DevtoolsFigureProps {
  tabs: readonly string[];
  activeTab: string;
  preserveLog: string;
  offline: string;
  columns: readonly string[];
  rows: readonly string[];
  emptyNote: string;
  calloutOffline: string;
  calloutEmpty: string;
  ariaLabel: string;
}

export function DevtoolsFigure({
  tabs,
  activeTab,
  preserveLog,
  offline,
  columns,
  rows,
  emptyNote,
  calloutOffline,
  calloutEmpty,
  ariaLabel,
}: DevtoolsFigureProps) {
  const tabX = (index: number) => 14 + index * 78;
  return (
    <svg
      viewBox="0 0 640 306"
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x="1"
        y="1"
        width="638"
        height="304"
        rx="12"
        fill="var(--surface-2)"
        stroke="var(--line)"
      />

      {/* Tab strip — one of them is the panel we are describing. */}
      <rect x="1" y="1" width="638" height="34" rx="12" fill="var(--surface)" />
      <rect x="1" y="23" width="638" height="12" fill="var(--surface)" />
      <line x1="1" y1="35" x2="639" y2="35" stroke="var(--line)" />
      {tabs.map((tab, index) => {
        const active = tab === activeTab;
        return (
          <g key={tab}>
            {active && (
              <rect
                x={tabX(index) - 8}
                y="7"
                width="74"
                height="22"
                rx="6"
                fill="var(--accent-soft)"
              />
            )}
            <text
              x={tabX(index)}
              y="22"
              className="font-mono"
              fontSize="11"
              fill={active ? 'var(--accent-strong)' : 'var(--muted)'}
              fontWeight={active ? 600 : 400}
            >
              {tab}
            </text>
          </g>
        );
      })}

      {/* Toolbar: the two controls the protocol asks the reader to touch. */}
      <rect
        x="14"
        y="48"
        width="12"
        height="12"
        rx="3"
        fill="var(--surface)"
        stroke="var(--muted)"
      />
      <path d="M17 54 l2.5 2.5 L24 51" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <text x="34" y="58" fontSize="11" fill="var(--muted)">
        {preserveLog}
      </text>
      <rect
        x="176"
        y="45"
        width="120"
        height="19"
        rx="5"
        fill="var(--surface)"
        stroke="var(--copper)"
        strokeWidth="1.5"
      />
      <text x="186" y="58" fontSize="11" fill="var(--copper)" fontWeight="600">
        {offline}
      </text>
      <line x1="72" y1="45" x2="640" y2="45" stroke="var(--line)" />

      {/* Column headers + the requests the app makes for its own files. */}
      <line x1="1" y1="72" x2="639" y2="72" stroke="var(--line)" />
      {columns.map((column, index) => (
        <text key={column} x={14 + index * 210} y="87" fontSize="10" fill="var(--muted)">
          {column}
        </text>
      ))}
      <line x1="1" y1="95" x2="639" y2="95" stroke="var(--line)" />
      {rows.map((row, index) => (
        <g key={row}>
          <text
            x="14"
            y={114 + index * 22}
            className="font-mono"
            fontSize="10"
            fill="var(--ink)"
            opacity="0.75"
          >
            {row}
          </text>
          <text x="224" y={114 + index * 22} className="font-mono" fontSize="10" fill="var(--ok)">
            200
          </text>
          <text
            x="434"
            y={114 + index * 22}
            className="font-mono"
            fontSize="10"
            fill="var(--muted)"
          >
            script
          </text>
        </g>
      ))}

      {/* The point of the whole figure: nothing more shows up. */}
      <rect
        x="14"
        y={112 + rows.length * 22}
        width="612"
        height="62"
        rx="8"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text
        x="320"
        y={148 + rows.length * 22}
        fontSize="12"
        fill="var(--accent-strong)"
        textAnchor="middle"
        fontWeight="600"
      >
        {emptyNote}
      </text>

      {/* Callouts, kept as text so they translate with everything else. */}
      <path
        d="M302 55 h34"
        stroke="var(--copper)"
        strokeWidth="1.5"
        fill="none"
        markerEnd="url(#labml-privacy-arrow)"
      />
      <defs>
        <marker
          id="labml-privacy-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0 0 L7 3.5 L0 7 z" fill="var(--copper)" />
        </marker>
      </defs>
      <text x="344" y="59" fontSize="10.5" fill="var(--copper)">
        {calloutOffline}
      </text>
      <text
        x="320"
        y={168 + rows.length * 22}
        fontSize="10.5"
        fill="var(--muted)"
        textAnchor="middle"
      >
        {calloutEmpty}
      </text>
    </svg>
  );
}
