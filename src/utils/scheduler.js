/**
 * Booking-window scheduler for Alberta and BC camping reservations.
 *
 * Alberta Parks:  reservations open 90 days in advance at midnight MST/MDT.
 * BC Parks:       reservations open 4 months in advance on the 1st of that
 *                 month at 07:00 PST/PDT.
 */

const PROVINCES = {
  ALBERTA: 'alberta',
  BC: 'bc',
};

const BOOKING_RULES = {
  [PROVINCES.ALBERTA]: {
    advanceDays: 90,
    openHour: 0,
    openMinute: 0,
    timezone: 'America/Edmonton',
    preBookMinutes: 2,  // start checking 2 min before window opens
  },
  [PROVINCES.BC]: {
    advanceMonths: 4,
    openHour: 7,
    openMinute: 0,
    timezone: 'America/Vancouver',
    preBookMinutes: 2,
  },
};

/**
 * Get the UTC offset (in minutes) for a timezone at a specific date.
 * Handles DST via Intl.DateTimeFormat; falls back to static approximations.
 * @param {string} timezone - IANA timezone identifier.
 * @param {Date}   date     - Date for DST-aware lookup.
 * @returns {number} Offset in minutes (positive = ahead of UTC).
 */
function getTimezoneOffset(timezone, date) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(date);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName');
    if (offsetPart) {
      const match = offsetPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || '0', 10);
        return sign * (hours * 60 + minutes);
      }
    }
  } catch (_) {
    // fall through to static fallback
  }
  const fallbacks = {
    'America/Edmonton': -420,   // UTC-7 (MST); MDT = UTC-6
    'America/Vancouver': -480,  // UTC-8 (PST); PDT = UTC-7
  };
  return fallbacks[timezone] !== undefined ? fallbacks[timezone] : -420;
}

/**
 * Calculate when the booking window opens for a given camping date.
 * @param {Date}   campsiteDate - The first night of the camping stay.
 * @param {string} province     - 'alberta' | 'bc'
 * @returns {Date} UTC timestamp when the booking window opens.
 */
function getBookingOpenTime(campsiteDate, province) {
  const rules = BOOKING_RULES[province];
  if (!rules) {
    throw new Error(`Unknown province: ${province}`);
  }

  const openDate = new Date(campsiteDate);

  if (province === PROVINCES.ALBERTA) {
    openDate.setDate(openDate.getDate() - rules.advanceDays);
  } else {
    // BC: 4 calendar months back, then snap to the 1st of that month.
    openDate.setMonth(openDate.getMonth() - rules.advanceMonths);
    openDate.setDate(1);
  }

  // Convert the local opening hour/minute to UTC using the province's offset.
  const tzOffsetMinutes = getTimezoneOffset(rules.timezone, openDate);
  openDate.setUTCHours(
    rules.openHour - Math.floor(tzOffsetMinutes / 60),
    rules.openMinute - (tzOffsetMinutes % 60),
    0,
    0
  );

  return openDate;
}

/**
 * Return the time to start polling — a few minutes before the window opens.
 * @param {Date}   openTime - Result of getBookingOpenTime().
 * @param {string} province
 * @returns {Date}
 */
function getBookingStartTime(openTime, province) {
  const rules = BOOKING_RULES[province];
  const startTime = new Date(openTime.getTime());
  startTime.setMinutes(startTime.getMinutes() - rules.preBookMinutes);
  return startTime;
}

/**
 * Whether the booking window for a camping date is currently open.
 * @param {Date}   campsiteDate
 * @param {string} province
 * @returns {boolean}
 */
function isBookingWindowOpen(campsiteDate, province) {
  return Date.now() >= getBookingOpenTime(campsiteDate, province).getTime();
}

/**
 * Milliseconds until the booking window opens (0 if already open).
 * @param {Date}   campsiteDate
 * @param {string} province
 * @returns {number}
 */
function getMsUntilBookingOpens(campsiteDate, province) {
  const msUntil = getBookingOpenTime(campsiteDate, province).getTime() - Date.now();
  return Math.max(0, msUntil);
}

export {
  PROVINCES,
  BOOKING_RULES,
  getBookingOpenTime,
  getBookingStartTime,
  isBookingWindowOpen,
  getMsUntilBookingOpens,
  getTimezoneOffset,
};
