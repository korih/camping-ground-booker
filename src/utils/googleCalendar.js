/**
 * Google Calendar integration for camping reservation reminders.
 *
 * In the extension context this module uses Chrome's Identity API to obtain
 * an OAuth2 token.  In Node.js tests a fetchFn can be injected directly so
 * no browser APIs are required.
 */

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.events';

/**
 * Create a Google Calendar reminder event for an upcoming booking window.
 *
 * @param {object} params
 * @param {string}   params.accessToken    - OAuth2 access token.
 * @param {string}   params.campsite       - Human-readable campsite name.
 * @param {Date}     params.campsiteDate   - First night of the camping trip.
 * @param {Date}     params.bookingOpenTime - When the reservation window opens.
 * @param {string}   params.province       - 'alberta' | 'bc'
 * @param {string}  [params.calendarId]    - Target calendar (default 'primary').
 * @param {Function}[params.fetchFn]       - Injected fetch (for testing).
 * @returns {Promise<object>} The created calendar event resource.
 */
async function createBookingReminder({
  accessToken,
  campsite,
  campsiteDate,
  bookingOpenTime,
  province,
  calendarId = 'primary',
  fetchFn = undefined,
}) {
  const provinceLabel = province === 'bc' ? 'BC Parks' : 'Alberta Parks';
  const campsiteDateStr = campsiteDate.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const tz = province === 'bc' ? 'America/Vancouver' : 'America/Edmonton';

  const event = {
    summary: `🏕️ Book ${campsite} – ${provinceLabel} Reservation Opens`,
    description: [
      `Booking window opens for your camping trip on ${campsiteDateStr}.`,
      '',
      `Campsite: ${campsite}`,
      `Province: ${provinceLabel}`,
      `Camping Date: ${campsiteDateStr}`,
      '',
      'The Camping Ground Booker extension will automatically attempt to book',
      'this spot. Make sure the extension is running and you are logged into',
      'the reservation website.',
    ].join('\n'),
    start: {
      dateTime: bookingOpenTime.toISOString(),
      timeZone: tz,
    },
    end: {
      dateTime: new Date(bookingOpenTime.getTime() + 30 * 60 * 1000).toISOString(),
      timeZone: tz,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 5 },
      ],
    },
    colorId: '2',  // green
  };

  // If fetchFn is explicitly null, throw. If undefined (not provided), fall
  // back to the environment's global fetch. In tests pass a jest.fn().
  const doFetch = fetchFn !== undefined ? fetchFn : (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) {
    throw new Error('fetch is not available. Provide a fetchFn parameter.');
  }

  const response = await doFetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to create calendar event: ${response.status} ${response.statusText}.` +
        (errorData.error ? ` ${errorData.error.message}` : '')
    );
  }

  return response.json();
}

/**
 * Delete a previously created booking reminder event.
 *
 * @param {object} params
 * @param {string}   params.accessToken - OAuth2 access token.
 * @param {string}   params.eventId     - Google Calendar event ID.
 * @param {string}  [params.calendarId] - Target calendar (default 'primary').
 * @param {Function}[params.fetchFn]    - Injected fetch (for testing).
 * @returns {Promise<void>}
 */
async function deleteBookingReminder({ accessToken, eventId, calendarId = 'primary', fetchFn = undefined }) {
  const doFetch = fetchFn !== undefined ? fetchFn : (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) {
    throw new Error('fetch is not available. Provide a fetchFn parameter.');
  }

  const response = await doFetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  // 404 means the event was already removed — treat that as success.
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Failed to delete calendar event: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * Obtain an OAuth2 token via Chrome's Identity API.
 * Only works inside the extension; throws in Node.js.
 *
 * @param {boolean} [interactive=true] - Show the consent screen if needed.
 * @returns {Promise<string>} Access token.
 */
async function getChromeAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity) {
      reject(new Error('Chrome Identity API is not available'));
      return;
    }
    chrome.identity.getAuthToken({ interactive, scopes: [CALENDAR_SCOPES] }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Revoke and remove a cached OAuth2 token (sign-out).
 * @param {string} token - Token to revoke.
 * @returns {Promise<void>}
 */
async function revokeChromeAuthToken(token) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity) {
      reject(new Error('Chrome Identity API is not available'));
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

export {
  CALENDAR_API_BASE,
  CALENDAR_SCOPES,
  createBookingReminder,
  deleteBookingReminder,
  getChromeAuthToken,
  revokeChromeAuthToken,
};
