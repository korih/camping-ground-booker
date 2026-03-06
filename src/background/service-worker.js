/**
 * Camping Ground Booker – Background Service Worker
 *
 * Responsibilities:
 *  • Restore alarms on startup / install.
 *  • Schedule an alarm for each pending booking based on its booking-window
 *    open time (minus preBookMinutes).
 *  • When an alarm fires, open the correct camping website and message the
 *    content script to start the booking flow.
 *  • Create / remove Google Calendar reminders when bookings are added or
 *    removed.
 *  • Listen to messages from the popup and content scripts.
 *
 * All utility modules are loaded via importScripts so they work without a
 * bundler.  Each utility attaches itself to `self` (the service-worker global)
 * under a known name.
 */

import { PROVINCES, getBookingOpenTime, getBookingStartTime } from '../utils/scheduler.js';
import { createBookingReminder, getChromeAuthToken } from '../utils/googleCalendar.js';
import { getBookings, saveBooking, updateBooking, removeBooking, getSettings } from '../utils/storage.js';

const SITE_URLS = {
  [PROVINCES.ALBERTA]: 'https://reservations.albertaparks.ca/',
  [PROVINCES.BC]: 'https://camping.bcparks.ca/',
};

const ALARM_PREFIX = 'camp-booking-';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function alarmName(bookingId) {
  return `${ALARM_PREFIX}${bookingId}`;
}

function bookingIdFromAlarm(name) {
  return name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : null;
}

/**
 * Schedule (or reschedule) the Chrome alarm for a booking.
 * The alarm fires preBookMinutes before the booking window opens so the
 * content script is ready the instant the window becomes available.
 */
async function scheduleAlarm(booking) {
  const campsiteDate = new Date(booking.arrivalDate);
  const openTime = getBookingOpenTime(campsiteDate, booking.province);
  const startTime = getBookingStartTime(openTime, booking.province);
  const msUntilStart = startTime.getTime() - Date.now();

  if (msUntilStart <= 0) {
    // Window is already open (or very close) – fire immediately.
    chrome.alarms.create(alarmName(booking.id), { when: Date.now() + 500 });
  } else {
    chrome.alarms.create(alarmName(booking.id), { when: startTime.getTime() });
  }
}

/** Create a Google Calendar reminder for a booking if the feature is enabled. */
async function maybeCreateCalendarEvent(booking) {
  const settings = await getSettings(chrome.storage.local);
  if (!settings.googleCalendarEnabled) return;

  let token;
  try {
    token = await getChromeAuthToken(false); // non-interactive — user must connect in Options
  } catch (_) {
    return; // silently skip if not authenticated
  }

  const campsiteDate = new Date(booking.arrivalDate);
  const openTime = getBookingOpenTime(campsiteDate, booking.province);

  try {
    const event = await createBookingReminder({
      accessToken: token,
      campsite: booking.campsite,
      campsiteDate,
      bookingOpenTime: openTime,
      province: booking.province,
      calendarId: settings.calendarId,
    });
    await updateBooking(chrome.storage.local, booking.id, { calendarEventId: event.id });
  } catch (err) {
    console.warn('Could not create calendar event:', err.message);
  }
}

/** Send a desktop notification. */
function notify(title, message, iconPath = '') {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconPath || 'icons/icon48.png',
    title,
    message,
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const bookings = await getBookings(chrome.storage.local);
  for (const booking of bookings) {
    if (booking.status === 'pending' || booking.status === 'scheduled') {
      await scheduleAlarm(booking);
      await updateBooking(chrome.storage.local, booking.id, { status: 'scheduled' });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const bookings = await getBookings(chrome.storage.local);
  for (const booking of bookings) {
    if (booking.status === 'pending' || booking.status === 'scheduled') {
      await scheduleAlarm(booking);
      await updateBooking(chrome.storage.local, booking.id, { status: 'scheduled' });
    }
  }
});

// Alarm handler — open the site and tell the content script to start booking.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const bookingId = bookingIdFromAlarm(alarm.name);
  if (!bookingId) return;

  const bookings = await getBookings(chrome.storage.local);
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status === 'booked' || booking.status === 'failed') return;

  const siteUrl = SITE_URLS[booking.province];
  if (!siteUrl) return;

  await updateBooking(chrome.storage.local, bookingId, { status: 'active' });

  // Find an existing tab for the site or open a new one.
  const tabs = await chrome.tabs.query({ url: `${siteUrl}*` });
  let tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    tab = await chrome.tabs.create({ url: siteUrl, active: true });
    // Wait briefly for the tab to finish loading.
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  const settings = await getSettings(chrome.storage.local);

  // Deliver booking instructions to the content script.
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'START_BOOKING',
      booking,
      settings,
    });
  } catch (err) {
    console.warn('Could not message content script:', err.message);
  }
});

// Message handler for popup and content scripts.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // keep the channel open for the async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'ADD_BOOKING': {
      const booking = await saveBooking(chrome.storage.local, message.booking);
      await scheduleAlarm(booking);
      await updateBooking(chrome.storage.local, booking.id, { status: 'scheduled' });
      await maybeCreateCalendarEvent(booking);
      return { success: true, booking };
    }

    case 'REMOVE_BOOKING': {
      chrome.alarms.clear(alarmName(message.bookingId));
      await removeBooking(chrome.storage.local, message.bookingId);
      return { success: true };
    }

    case 'GET_BOOKINGS': {
      const bookings = await getBookings(chrome.storage.local);
      return { success: true, bookings };
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings(chrome.storage.local);
      return { success: true, settings };
    }

    case 'BOOKING_SUCCESS': {
      await updateBooking(chrome.storage.local, message.bookingId, { status: 'booked' });
      chrome.alarms.clear(alarmName(message.bookingId));
      notify('🏕️ Camping spot booked!', `Your spot at ${message.campsite} has been reserved.`);
      return { success: true };
    }

    case 'BOOKING_FAILED': {
      await updateBooking(chrome.storage.local, message.bookingId, {
        status: 'failed',
        failReason: message.reason,
      });
      notify('Booking failed', `Could not book ${message.campsite}: ${message.reason}`);
      return { success: true };
    }

    case 'SPOT_AVAILABLE': {
      notify('🏕️ Camping spot available!', `${message.campsite} is now available to book.`);
      return { success: true };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
