const paths = {
  terminal: 'm5 7 5 5-5 5 M12 17h7',
  popup: 'M3 6h18v12H3z M3 10h18',
  sound: 'm11 5-6 5H2v4h3l6 5z M15 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12',
  edgeGlow:
    'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2',
  completed: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z m-15 0 3 3 6-6',
  attention: 'M12 3 2 20h20z M12 9v4 M12 16h.01',
  external: 'M8 5h11v11 M19 5 5 19'
}

export function Icon({ name }: { name: keyof typeof paths }): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
