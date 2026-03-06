/**
 * Chrome storage wrapper for Camping Ground Booker.
 *
 * All data lives in chrome.storage.local.  In tests a plain object that
 * mimics the chrome.storage API is injected instead.
 *
 * Booking object shape:
 * {
 *   id:            string   (generated on save)
 *   campsite:      string
 *   province:      'alberta' | 'bc'
 *   arrivalDate:   string   (ISO date)
 *   nights:        number
 *   partySize:     number
 *   calendarEventId?: string
 *   status:        'pending' | 'scheduled' | 'active' | 'booked' | 'failed'
 *   createdAt:     string   (ISO datetime)
 *   updatedAt?:    string
 * }
 */

const STORAGE_KEYS = {
  BOOKINGS: 'bookings',
  SETTINGS: 'settings',
};

const DEFAULT_SETTINGS = {
  autoBook: false,             // auto-submit the booking form
  notifyOnAvailability: true,
  checkIntervalMs: 5000,       // poll every 5 s when the window is open
  maxCheckDurationMin: 30,     // stop checking after 30 min
  googleCalendarEnabled: false,
  calendarId: 'primary',
};

/**
 * Return all stored bookings.
 * @param {object} storageArea - chrome.storage.local (or a test stub).
 * @returns {Promise<Array>}
 */
async function getBookings(storageArea) {
  return new Promise((resolve) => {
    storageArea.get(STORAGE_KEYS.BOOKINGS, (result) => {
      resolve(result[STORAGE_KEYS.BOOKINGS] || []);
    });
  });
}

/**
 * Persist a new booking and return it with a generated id.
 * @param {object} storageArea
 * @param {object} booking - Fields as described in the file header.
 * @returns {Promise<object>}
 */
async function saveBooking(storageArea, booking) {
  const bookings = await getBookings(storageArea);
  const newBooking = {
    ...booking,
    id: `booking_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  bookings.push(newBooking);
  await new Promise((resolve) => {
    storageArea.set({ [STORAGE_KEYS.BOOKINGS]: bookings }, resolve);
  });
  return newBooking;
}

/**
 * Update fields of an existing booking in place.
 * @param {object} storageArea
 * @param {string} bookingId
 * @param {object} updates - Partial fields to merge.
 * @returns {Promise<object>} The updated booking.
 */
async function updateBooking(storageArea, bookingId, updates) {
  const bookings = await getBookings(storageArea);
  const index = bookings.findIndex((b) => b.id === bookingId);
  if (index === -1) {
    throw new Error(`Booking ${bookingId} not found`);
  }
  bookings[index] = { ...bookings[index], ...updates, updatedAt: new Date().toISOString() };
  await new Promise((resolve) => {
    storageArea.set({ [STORAGE_KEYS.BOOKINGS]: bookings }, resolve);
  });
  return bookings[index];
}

/**
 * Remove a booking from storage.
 * @param {object} storageArea
 * @param {string} bookingId
 * @returns {Promise<void>}
 */
async function removeBooking(storageArea, bookingId) {
  const bookings = await getBookings(storageArea);
  const filtered = bookings.filter((b) => b.id !== bookingId);
  await new Promise((resolve) => {
    storageArea.set({ [STORAGE_KEYS.BOOKINGS]: filtered }, resolve);
  });
}

/**
 * Return the current settings merged with defaults.
 * @param {object} storageArea
 * @returns {Promise<object>}
 */
async function getSettings(storageArea) {
  return new Promise((resolve) => {
    storageArea.get(STORAGE_KEYS.SETTINGS, (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) });
    });
  });
}

/**
 * Persist settings (merged with defaults).
 * @param {object} storageArea
 * @param {object} settings
 * @returns {Promise<object>} The saved settings.
 */
async function saveSettings(storageArea, settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await new Promise((resolve) => {
    storageArea.set({ [STORAGE_KEYS.SETTINGS]: merged }, resolve);
  });
  return merged;
}

// Universal export
if (typeof module !== 'undefined') {
  module.exports = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    getBookings,
    saveBooking,
    updateBooking,
    removeBooking,
    getSettings,
    saveSettings,
  };
} else {
  (typeof self !== 'undefined' ? self : window).CampingStorage = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    getBookings,
    saveBooking,
    updateBooking,
    removeBooking,
    getSettings,
    saveSettings,
  };
}
