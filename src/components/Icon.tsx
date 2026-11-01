// Stroke icon set (paths adapted from Lucide, ISC licence). Decorative by default.

const P = {
  dashboard: ['M3 4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M14 4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z', 'M14 13a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z', 'M3 17a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  plus: ['M5 12h14', 'M12 5v14'],
  pill: ['m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z', 'm8.5 8.5 7 7'],
  weight: ['M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z'],
  clipboard: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
  chart: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  sliders: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
  heartPulse: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z', 'M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  wifiOff: ['M12 20h.01', 'M8.5 16.43a5 5 0 0 1 7 0', 'M2 8.82a15 15 0 0 1 4.17-2.65', 'M10.66 5c4.01-.36 8.14.9 11.34 3.76', 'M16.85 11.25a10 10 0 0 1 2.22 1.68', 'M5 13a10 10 0 0 1 5.24-2.76', 'm2 2 20 20'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  checkCircle: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'm9 12 2 2 4-4'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  xCircle: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'm15 9-6 6', 'm9 9 6 6'],
  info: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 16v-4', 'M12 8h.01'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  flask: ['M10 2v7.31', 'M14 9.3V2', 'M8.5 2h7', 'M14 9.3a6.5 6.5 0 1 1-4 0', 'M5.52 16h12.96'],
  clock: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
  circle: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z'],
  skip: ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
  award: ['M18 8A6 6 0 1 1 6 8a6 6 0 0 1 12 0z', 'M15.477 12.89 17 22l-5-3-5 3 1.523-9.11'],
  pencil: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  sunrise: ['M12 2v8', 'm4.93 10.93 1.41 1.41', 'M2 18h2', 'M20 18h2', 'm19.07 10.93-1.41 1.41', 'M22 22H2', 'm8 6 4-4 4 4', 'M16 18a4 4 0 0 0-8 0'],
  sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  timer: ['M10 2h4', 'M12 14l3-3', 'M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0z'],
  stethoscope: ['M11 2v2', 'M5 2v2', 'M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1', 'M8 15a6 6 0 0 0 12 0v-3', 'M22 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
  database: ['M21 5c0 1.66-4.03 3-9 3S3 6.66 3 5s4.03-3 9-3 9 1.34 9 3z', 'M3 5v14a9 3 0 0 0 18 0V5', 'M3 12a9 3 0 0 0 18 0'],
  smartphone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof P;

export function Icon({ name, className = 'h-5 w-5', label, strokeWidth = 2 }: { name: IconName; className?: string; label?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} focusable="false">
      {P[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Brand mark used in navigation and the report. */
export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-800 text-white shadow-sm ${className}`} aria-hidden="true">
      <Icon name="heartPulse" className="h-[58%] w-[58%]" />
    </span>
  );
}
