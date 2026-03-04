/**
 * alberta.js – content script for https://reservations.albertaparks.ca/
 *
 * Listens for a START_BOOKING message from the service worker, then:
 *  1. Waits for the booking window to open (midnight MST on the target date).
 *  2. Searches for the desired campsite and dates.
 *  3. Detects when a site becomes available and optionally auto-books it.
 *
 * NOTE: The CSS selectors below reflect the Alberta Parks reservation system
 * at the time of writing.  If the site is updated, adjust SELECTORS accordingly.
 */

(function () {
  'use strict';

  // ─── Selector map ──────────────────────────────────────────────────────────
  // Update these if the Alberta Parks site changes its markup.
  const SELECTORS = {
    searchInput: 'input[placeholder*="park" i], input[name="q"], #search-input',
    datePickerStart: 'input[placeholder*="arrival" i], input[name="startDate"], #arrival-date',
    datePickerEnd: 'input[placeholder*="departure" i], input[name="endDate"], #departure-date',
    partySizeInput: 'input[name="partySize"], select[name="partySize"], #party-size',
    searchButton: 'button[type="submit"], button.search-btn, #search-button',
    availableSite: '.available-site, .site-available, [data-available="true"]',
    bookButton: '.book-btn, button[aria-label*="book" i], a[href*="booking"]',
    confirmButton: 'button[type="submit"].confirm, button.btn-confirm, #confirm-booking',
    loginRequired: '.login-required, #sign-in-prompt, [data-requires-login]',
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
    return true; // async response
  });

  // ─── Main flow ─────────────────────────────────────────────────────────────
  async function startBookingFlow(settings) {
    if (isRunning) return { success: false, error: 'Already running' };
    isRunning = true;

    const { campsite, arrivalDate, nights, partySize, id: bookingId, province } = activeBooking;
    const { showBanner, waitForEl, safeClick, fillInput, pollUntil } = window.CampingCommon;

    showBanner('Waiting for booking window to open…');

    // Wait until the booking window is open (poll every second).
    const openTime = getBookingOpenTimeLocal(new Date(arrivalDate), province);
    const msUntilOpen = Math.max(0, openTime.getTime() - Date.now());

    if (msUntilOpen > 0) {
      showBanner(`Booking window opens in ${formatCountdown(msUntilOpen)}. Standing by…`);
      await sleep(msUntilOpen);
    }

    showBanner('Booking window open! Searching for availability…', 'info');

    // Check for login wall.
    if (document.querySelector(SELECTORS.loginRequired)) {
      isRunning = false;
      showBanner('Please log in to Alberta Parks, then the extension will retry.', 'warning');
      chrome.runtime.sendMessage({
        type: 'BOOKING_FAILED',
        bookingId,
        campsite,
        reason: 'User not logged in',
      });
      return { success: false, error: 'Login required' };
    }

    // Fill the search form.
    try {
      await fillSearchForm(campsite, arrivalDate, nights, partySize, settings);
    } catch (err) {
      isRunning = false;
      showBanner(`Search form error: ${err.message}`, 'error');
      chrome.runtime.sendMessage({ type: 'BOOKING_FAILED', bookingId, campsite, reason: err.message });
      return { success: false, error: err.message };
    }

    // Poll for an available site for up to maxCheckDurationMin.
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

    // Attempt to book.
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

  async function fillSearchForm(campsite, arrivalDate, nights, partySize, _settings) {
    const { waitForEl, fillInput, safeClick } = window.CampingCommon;

    const arrival = new Date(arrivalDate);
    const departure = new Date(arrival);
    departure.setDate(departure.getDate() + (nights || 1));

    // Campsite / park search field.
    const searchEl = await waitForEl(SELECTORS.searchInput);
    fillInput(searchEl, campsite);
    await sleep(300);

    // Arrival date.
    try {
      const startEl = await waitForEl(SELECTORS.datePickerStart, 5000);
      fillInput(startEl, formatDate(arrival));
    } catch (_) { /* optional field */ }

    // Departure date.
    try {
      const endEl = await waitForEl(SELECTORS.datePickerEnd, 5000);
      fillInput(endEl, formatDate(departure));
    } catch (_) { /* optional field */ }

    // Party size.
    if (partySize) {
      try {
        const psEl = await waitForEl(SELECTORS.partySizeInput, 5000);
        fillInput(psEl, String(partySize));
      } catch (_) { /* optional field */ }
    }

    // Submit search.
    const searchBtn = await waitForEl(SELECTORS.searchButton);
    await safeClick(searchBtn, 200);
  }

  async function attemptBooking(campsite, bookingId) {
    const { waitForEl, safeClick } = window.CampingCommon;

    // Click the first available site.
    const siteEl = document.querySelector(SELECTORS.availableSite);
    if (!siteEl) throw new Error('Available site disappeared');
    await safeClick(siteEl, 100);

    // Click the Book button on the detail page.
    const bookBtn = await waitForEl(SELECTORS.bookButton, 10000);
    await safeClick(bookBtn, 300);

    // Confirm the booking.
    const confirmBtn = await waitForEl(SELECTORS.confirmButton, 15000);
    await safeClick(confirmBtn, 500);
  }

  // ─── Pure helpers ──────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  function formatCountdown(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
  }

  /**
   * Alberta Parks booking window: midnight MST/MDT on the date 90 days prior.
   * MST (UTC-7) → midnight = 07:00 UTC; MDT (UTC-6) → midnight = 06:00 UTC.
   * This inline approximation uses the winter (MST) offset; the scheduler.js
   * utility uses Intl.DateTimeFormat for DST-accurate results.
   */
  function getBookingOpenTimeLocal(campsiteDate, _province) {
    const d = new Date(campsiteDate);
    d.setDate(d.getDate() - 90);
    d.setUTCHours(7, 0, 0, 0); // approx: midnight MST (UTC-7); MDT shifts to 06:00 UTC
    return d;
  }
})();
