/**
 * bc.js – content script for https://camping.bcparks.ca/
 *
 * Listens for a START_BOOKING message from the service worker, then:
 *  1. Waits for the booking window to open (07:00 PST/PDT on the 1st of the
 *     month, 4 months before the camping date).
 *  2. Searches for the desired campsite and dates.
 *  3. Detects when a site becomes available and optionally auto-books it.
 *
 * NOTE: Selectors are based on the BC Parks camping site at time of writing.
 * Adjust SELECTORS if the site updates its markup.
 */

(function () {
  'use strict';

  // ─── Selector map ──────────────────────────────────────────────────────────
  const SELECTORS = {
    parkSearch: 'input[placeholder*="park" i], input[name="park"], #park-search',
    datePickerStart: 'input[placeholder*="arrival" i], input[name="startDate"], #start-date',
    datePickerEnd: 'input[placeholder*="departure" i], input[name="endDate"], #end-date',
    partySizeInput: 'input[name="partySize"], select[name="partySize"], #party-size',
    searchButton: 'button[type="submit"], button.search-btn, #search-camps',
    availableSite: '.available, [class*="available"], [data-availability="available"]',
    bookButton: 'button.book-now, a.book-now, button[aria-label*="book" i]',
    addToCartButton: 'button[aria-label*="add to cart" i], button.add-to-cart',
    checkoutButton: 'button.checkout, a[href*="checkout"]',
    confirmButton: 'button[type="submit"].confirm, button.btn-primary[class*="confirm"]',
    loginRequired: '#sign-in-required, .login-prompt, [data-requires-login]',
  };

  let activeBooking = null;
  let isRunning = false;

  // ─── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'START_BOOKING') return;
    activeBooking = message.booking;
    const settings = message.settings || {};
    startBookingFlow(settings).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });

  // ─── Main flow ─────────────────────────────────────────────────────────────
  async function startBookingFlow(settings) {
    if (isRunning) return { success: false, error: 'Already running' };
    isRunning = true;

    const { campsite, arrivalDate, nights, partySize, id: bookingId } = activeBooking;
    const { showBanner, pollUntil } = window.CampingCommon;

    showBanner('Waiting for BC Parks booking window to open…');

    const openTime = getBookingOpenTimeLocal(new Date(arrivalDate));
    const msUntilOpen = Math.max(0, openTime.getTime() - Date.now());

    if (msUntilOpen > 0) {
      showBanner(`Booking window opens in ${formatCountdown(msUntilOpen)}. Standing by…`);
      await sleep(msUntilOpen);
    }

    showBanner('Booking window open! Searching for availability…');

    if (document.querySelector(SELECTORS.loginRequired)) {
      isRunning = false;
      showBanner('Please log in to BC Parks, then the extension will retry.', 'warning');
      chrome.runtime.sendMessage({
        type: 'BOOKING_FAILED',
        bookingId,
        campsite,
        reason: 'User not logged in',
      });
      return { success: false, error: 'Login required' };
    }

    try {
      await fillSearchForm(campsite, arrivalDate, nights, partySize);
    } catch (err) {
      isRunning = false;
      showBanner(`Search form error: ${err.message}`, 'error');
      chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', bookingId, campsite, reason: err.message });
      return { success: false, error: err.message };
    }

    showBanner('Checking availability…');
    const maxMs = (settings.maxCheckDurationMin || 30) * 60 * 1000;
    const intervalMs = settings.checkIntervalMs || 5000;

    const found = await pollUntil(
      () => !!document.querySelector(SELECTORS.availableSite),
      intervalMs,
      maxMs
    );

    if (!found) {
      isRunning = false;
      showBanner('No availability found within the check window.', 'error');
      chrome.runtime.sendMessage({
        type: 'BOOKING_FAILED',
        bookingId,
        campsite,
        reason: 'No availability within check window',
      });
      return { success: false };
    }

    showBanner('Site available!', 'success');
    chrome.runtime.sendMessage({ type: 'SPOT_AVAILABLE', campsite });

    if (!settings.autoBook) {
      isRunning = false;
      return { success: true, booked: false, reason: 'autoBook disabled' };
    }

    try {
      await attemptBooking(campsite, bookingId);
    } catch (err) {
      isRunning = false;
      showBanner(`Booking error: ${err.message}`, 'error');
      chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', bookingId, campsite, reason: err.message });
      return { success: false, error: err.message };
    }

    isRunning = false;
    showBanner('Booking complete! 🎉', 'success');
    chrome.runtime.sendMessage({ type: 'BOOKING_SUCCESS', bookingId, campsite });
    return { success: true, booked: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async function fillSearchForm(campsite, arrivalDate, nights, partySize) {
    const { waitForEl, fillInput, safeClick } = window.CampingCommon;

    const arrival = new Date(arrivalDate);
    const departure = new Date(arrival);
    departure.setDate(departure.getDate() + (nights || 1));

    const parkEl = await waitForEl(SELECTORS.parkSearch);
    fillInput(parkEl, campsite);
    await sleep(300);

    try {
      const startEl = await waitForEl(SELECTORS.datePickerStart, 5000);
      fillInput(startEl, formatDate(arrival));
    } catch (_) { /* optional */ }

    try {
      const endEl = await waitForEl(SELECTORS.datePickerEnd, 5000);
      fillInput(endEl, formatDate(departure));
    } catch (_) { /* optional */ }

    if (partySize) {
      try {
        const psEl = await waitForEl(SELECTORS.partySizeInput, 5000);
        fillInput(psEl, String(partySize));
      } catch (_) { /* optional */ }
    }

    const searchBtn = await waitForEl(SELECTORS.searchButton);
    await safeClick(searchBtn, 200);
  }

  async function attemptBooking(_campsite, _bookingId) {
    const { waitForEl, safeClick } = window.CampingCommon;

    const siteEl = document.querySelector(SELECTORS.availableSite);
    if (!siteEl) throw new Error('Available site disappeared');
    await safeClick(siteEl, 100);

    // BC Parks may use "Add to cart" instead of a direct Book button.
    try {
      const addBtn = await waitForEl(SELECTORS.addToCartButton, 8000);
      await safeClick(addBtn, 300);
      const checkoutBtn = await waitForEl(SELECTORS.checkoutButton, 10000);
      await safeClick(checkoutBtn, 300);
    } catch (_) {
      // Fallback: direct Book Now flow.
      const bookBtn = await waitForEl(SELECTORS.bookButton, 10000);
      await safeClick(bookBtn, 300);
    }

    const confirmBtn = await waitForEl(SELECTORS.confirmButton, 15000);
    await safeClick(confirmBtn, 500);
  }

  // ─── Pure helpers ──────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatCountdown(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
  }

  /**
   * BC Parks booking window: 07:00 PST/PDT on the 1st of the month, 4 months prior.
   * PST (UTC-8) → 07:00 = 15:00 UTC; PDT (UTC-7) → 07:00 = 14:00 UTC.
   * Uses the winter (PST) offset as an approximation; scheduler.js provides
   * DST-accurate results via Intl.DateTimeFormat.
   */
  function getBookingOpenTimeLocal(campsiteDate) {
    const d = new Date(campsiteDate);
    d.setMonth(d.getMonth() - 4);
    d.setDate(1);
    d.setUTCHours(15, 0, 0, 0); // approx: 07:00 PST (UTC-8); PDT shifts to 14:00 UTC
    return d;
  }
})();
