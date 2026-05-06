import { useEffect, useState } from 'react';

export function useIsMobile(breakpoint = 900) {
  const getMobile = () => window.innerWidth <= breakpoint;
  const [isMobile, setIsMobile] = useState(getMobile);

  useEffect(() => {
    const onResize = () => setIsMobile(getMobile());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isMobile;
}
