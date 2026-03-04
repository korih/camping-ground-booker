/**
 * options.js – drives the Camping Ground Booker settings page.
 */

(function () {
  'use strict';

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const banner          = document.getElementById('status-banner');
  const optGcalEnabled  = document.getElementById('opt-gcal-enabled');
  const gcalDetails     = document.getElementById('gcal-details');
  const optCalendarId   = document.getElementById('opt-calendar-id');
  const btnConnect      = document.getElementById('btn-gcal-connect');
  const btnDisconnect   = document.getElementById('btn-gcal-disconnect');
  const gcalAuthStatus  = document.getElementById('gcal-auth-status');
  const optAutoBook     = document.getElementById('opt-auto-book');
  const optNotify       = document.getElementById('opt-notify');
  const optInterval     = document.getElementById('opt-check-interval');
  const optMaxDuration  = document.getElementById('opt-max-duration');
  const btnSave         = document.getElementById('btn-save');

  // ─── Bootstrap ─────────────────────────────────────────────────────────────
  loadSettings();

  // ─── Event handlers ────────────────────────────────────────────────────────
  optGcalEnabled.addEventListener('change', () => {
    gcalDetails.hidden = !optGcalEnabled.checked;
  });

  btnConnect.addEventListener('click', connectGoogleCalendar);
  btnDisconnect.addEventListener('click', disconnectGoogleCalendar);
  btnSave.addEventListener('click', saveSettings);

  // ─── Functions ─────────────────────────────────────────────────────────────

  async function loadSettings() {
    const response = await sendMessage({ type: 'GET_SETTINGS' });
    if (!response || !response.success) return;
    const s = response.settings;

    optGcalEnabled.checked = !!s.googleCalendarEnabled;
    gcalDetails.hidden = !s.googleCalendarEnabled;
    optCalendarId.value = s.calendarId || 'primary';
    optAutoBook.checked = !!s.autoBook;
    optNotify.checked = s.notifyOnAvailability !== false;
    optInterval.value = Math.round((s.checkIntervalMs || 5000) / 1000);
    optMaxDuration.value = s.maxCheckDurationMin || 30;

    updateAuthStatus(s.googleCalendarEnabled);
  }

  async function saveSettings() {
    const checkIntervalSec = parseInt(optInterval.value, 10) || 5;
    if (checkIntervalSec < 2) {
      optInterval.value = 2;
      showBanner('Check interval cannot be less than 2 seconds.', 'error');
      return;
    }

    const settings = {
      googleCalendarEnabled: optGcalEnabled.checked,
      calendarId: optCalendarId.value.trim() || 'primary',
      autoBook: optAutoBook.checked,
      notifyOnAvailability: optNotify.checked,
      checkIntervalMs: checkIntervalSec * 1000,
      maxCheckDurationMin: parseInt(optMaxDuration.value, 10) || 30,
    };

    // Persist directly via chrome.storage.local from the options page.
    chrome.storage.local.set({ settings }, () => {
      if (chrome.runtime.lastError) {
        showBanner('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showBanner('Settings saved.', 'success');
      }
    });
  }

  async function connectGoogleCalendar() {
    try {
      await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken(
          { interactive: true, scopes: ['https://www.googleapis.com/auth/calendar.events'] },
          (token) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(token);
            }
          }
        );
      });
      updateAuthStatus(true);
      showBanner('Google Calendar connected successfully.', 'success');
    } catch (err) {
      showBanner('Could not connect: ' + err.message, 'error');
    }
  }

  async function disconnectGoogleCalendar() {
    // Retrieve the current token silently and remove it.
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          // Also revoke via the Google endpoint so the token is fully invalidated.
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
        });
      }
      updateAuthStatus(false);
      showBanner('Google Calendar disconnected.', 'success');
    });
  }

  function updateAuthStatus(isEnabled) {
    if (!isEnabled) {
      btnConnect.hidden = false;
      btnDisconnect.hidden = true;
      gcalAuthStatus.textContent = '';
      gcalAuthStatus.className = 'auth-status';
      return;
    }
    // Check silently whether we already have a valid token.
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        btnConnect.hidden = true;
        btnDisconnect.hidden = false;
        gcalAuthStatus.textContent = '✓ Connected';
        gcalAuthStatus.className = 'auth-status connected';
      } else {
        btnConnect.hidden = false;
        btnDisconnect.hidden = true;
        gcalAuthStatus.textContent = 'Not connected';
        gcalAuthStatus.className = 'auth-status';
      }
    });
  }

  function showBanner(msg, type = 'success') {
    banner.textContent = msg;
    banner.className = `banner ${type}`;
    banner.hidden = false;
    setTimeout(() => { banner.hidden = true; }, 4000);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Options sendMessage:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }
})();
