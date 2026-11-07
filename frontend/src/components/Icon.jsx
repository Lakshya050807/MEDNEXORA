const paths = {
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22.5z" /><path d="M4 5.5v17M8 7h8M8 11h8M8 15h5" /></>,
  file: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  checklist: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="m8 9 1.5 1.5L12 8M14 10h3M8 16l1.5 1.5L12 15M14 17h3" /></>,
  play: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 8 5 4-5 4z" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V3h6v2M8.5 10h7M8.5 14h7M8.5 18h4" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6.8L20 12M4 12l2 5.2A7 7 0 0 0 18.4 15" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  user: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  bag: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  arrowUpRight: <><path d="M7 17 17 7M7 7h10v10" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  shield: <><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  bookmark: <><path d="M6 4h12v17l-6-4-6 4z" /></>,
  heart: <><path d="M20.8 8.8c0 4.1-8.8 10-8.8 10s-8.8-5.9-8.8-10a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z" /></>,
  spark: <><path d="m12 2 1.7 7.2L21 12l-7.3 2.8L12 22l-1.7-7.2L3 12l7.3-2.8z" /></>,
  quote: <><path d="M10 11H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6c0 4-2 7-6 8M21 11h-5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6c0 4-2 7-6 8" /></>,
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.spark}
    </svg>
  );
}

