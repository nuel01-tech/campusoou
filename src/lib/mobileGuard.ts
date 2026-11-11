/**
 * iPhone / Safari layout guard.
 *
 * 1. Detects Safari's "Request Desktop Website" mode on a phone (the page is then laid out
 *    ~980px wide and shrunk). CSS cannot override that, so we show a one-tap-fix banner.
 * 2. Detects elements that push the page wider than the screen (which makes iOS Safari zoom
 *    out to fit) and clamps them so the page stays at normal mobile scale.
 */

const BANNER_ID = 'cp-desktop-mode-banner';

function isPhoneScreen(): boolean {
  const w = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999);
  return w <= 480;
}

/** True when a phone is rendering the desktop site (iOS "Request Desktop Website"). */
export function isForcedDesktopMode(): boolean {
  if (typeof window === 'undefined' || !isPhoneScreen()) return false;
  const ua = navigator.userAgent || '';
  const looksLikeMac = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  const layoutIsWide = window.innerWidth >= 700;
  return looksLikeMac || layoutIsWide;
}

function showDesktopModeBanner(): void {
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.setAttribute('role', 'alert');
  bar.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'top:0',
    'z-index:2147483647',
    'background:#ffc107',
    'color:#000',
    'padding:14px 16px',
    'font:600 18px/1.35 -apple-system,Segoe UI,Arial,sans-serif',
    'text-align:center',
    'box-shadow:0 2px 8px rgba(0,0,0,.3)',
  ].join(';');
  bar.innerHTML =
    'Your phone opened the <u>desktop version</u>.<br>' +
    'Tap <b>aA</b> in Safari&rsquo;s address bar &rarr; <b>Request Mobile Website</b>.' +
    '<br><button type="button" style="margin-top:8px;font:inherit;padding:6px 14px;border:0;border-radius:4px;background:#282a35;color:#fff">OK</button>';
  bar.querySelector('button')?.addEventListener('click', () => bar.remove());
  document.body.appendChild(bar);
}

/** Clamp any element that sticks out past the right edge of the screen. */
function clampOverflowingElements(): void {
  const vw = document.documentElement.clientWidth;
  if (!vw || document.documentElement.scrollWidth <= vw + 1) return;
  const all = document.body.querySelectorAll<HTMLElement>('*');
  all.forEach((el) => {
    if (el.closest('.table-wrap, .vtabs, .segmented, #' + BANNER_ID)) return;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 || r.right > vw + 1) {
      el.style.maxWidth = '100%';
      el.style.boxSizing = 'border-box';
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowX = 'auto';
    }
  });
}

export function initMobileGuard(): void {
  if (typeof window === 'undefined') return;

  const run = () => {
    if (isForcedDesktopMode()) showDesktopModeBanner();
    if (isPhoneScreen()) clampOverflowingElements();
  };

  window.addEventListener('load', () => setTimeout(run, 400));
  // Re-check after route changes / data loads (cheap: bails out when nothing overflows).
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (isPhoneScreen()) clampOverflowingElements();
    }, 300);
  });
  observer.observe(document.getElementById('root') ?? document.body, {
    childList: true,
    subtree: true,
  });
}
