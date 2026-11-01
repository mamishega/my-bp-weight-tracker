import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, q] = h.split('?');
  return { path: path || '/', params: new URLSearchParams(q ?? '') };
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(href: string) {
  window.location.hash = href.replace(/^#/, '');
}
