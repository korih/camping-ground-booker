/**
 * common.js – shared utilities injected into every camping-site content script.
 *
 * Provides:
 *  • CampingCommon.showBanner()   – non-intrusive status banner on the page.
 *  • CampingCommon.waitForEl()    – promise that resolves when a selector appears.
 *  • CampingCommon.safeClick()    – click with an optional human-speed delay.
 *  • CampingCommon.fillInput()    – clear + set value + fire input/change events.
 *  • CampingCommon.pollUntil()    – repeat a test function at an interval.
 */

(function (root) {
  const BANNER_ID = 'cgb-status-banner';

  /**
   * Show (or update) a small status banner at the top of the page.
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'} [type='info']
   */
  function showBanner(message, type = 'info') {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      Object.assign(banner.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        zIndex: '2147483647',
        padding: '10px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        transition: 'background 0.3s',
      });
      document.body.prepend(banner);
    }

    const colours = {
      info: { bg: '#1565c0', fg: '#fff' },
      success: { bg: '#2e7d32', fg: '#fff' },
      error: { bg: '#c62828', fg: '#fff' },
      warning: { bg: '#e65100', fg: '#fff' },
    };
    const c = colours[type] || colours.info;
    banner.style.background = c.bg;
    banner.style.color = c.fg;
    banner.textContent = `🏕️ Camping Ground Booker: ${message}`;
  }

  /**
   * Resolve when a CSS selector matches at least one element in the DOM.
   * @param {string} selector
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<Element>}
   */
  function waitForEl(selector, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const deadline = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for selector: ${selector}`));
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearTimeout(deadline);
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /**
   * Click an element after an optional human-speed delay.
   * @param {Element} el
   * @param {number}  [delayMs=0]
   */
  async function safeClick(el, delayMs = 0) {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  /**
   * Set the value of an input field and fire the events frameworks listen for.
   * @param {HTMLInputElement|HTMLSelectElement} el
   * @param {string} value
   */
  function fillInput(el, value) {
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    );
    if (nativeInputSetter && nativeInputSetter.set) {
      nativeInputSetter.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Repeatedly call testFn until it returns truthy or the timeout is reached.
   * @param {Function} testFn      – returns truthy/falsy.
   * @param {number}   intervalMs  – how often to check.
   * @param {number}   timeoutMs   – max total wait time.
   * @returns {Promise<boolean>}   – true if testFn became truthy in time.
   */
  function pollUntil(testFn, intervalMs = 2000, timeoutMs = 30 * 60 * 1000) {
    return new Promise((resolve) => {
      const deadline = setTimeout(() => {
        clearInterval(handle);
        resolve(false);
      }, timeoutMs);

      const handle = setInterval(() => {
        if (testFn()) {
          clearInterval(handle);
          clearTimeout(deadline);
          resolve(true);
        }
      }, intervalMs);
    });
  }

  root.CampingCommon = { showBanner, waitForEl, safeClick, fillInput, pollUntil };
})(typeof window !== 'undefined' ? window : self);
