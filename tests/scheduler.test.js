const {
  PROVINCES,
  BOOKING_RULES,
  getBookingOpenTime,
  getBookingStartTime,
  isBookingWindowOpen,
  getMsUntilBookingOpens,
} = require('../src/utils/scheduler');

describe('Scheduler', () => {
  // ── PROVINCES ─────────────────────────────────────────────────────────────

  describe('PROVINCES', () => {
    it('exposes Alberta and BC identifiers', () => {
      expect(PROVINCES.ALBERTA).toBe('alberta');
      expect(PROVINCES.BC).toBe('bc');
    });
  });

  // ── BOOKING_RULES ─────────────────────────────────────────────────────────

  describe('BOOKING_RULES', () => {
    it('Alberta opens 90 days in advance at midnight', () => {
      const r = BOOKING_RULES[PROVINCES.ALBERTA];
      expect(r.advanceDays).toBe(90);
      expect(r.openHour).toBe(0);
      expect(r.preBookMinutes).toBeGreaterThan(0);
    });

    it('BC opens 4 months in advance at 07:00', () => {
      const r = BOOKING_RULES[PROVINCES.BC];
      expect(r.advanceMonths).toBe(4);
      expect(r.openHour).toBe(7);
      expect(r.preBookMinutes).toBeGreaterThan(0);
    });
  });

  // ── getBookingOpenTime ────────────────────────────────────────────────────

  describe('getBookingOpenTime', () => {
    it('throws for an unknown province', () => {
      expect(() => getBookingOpenTime(new Date(), 'ontario')).toThrow('Unknown province');
    });

    it('returns a Date for Alberta', () => {
      const result = getBookingOpenTime(new Date('2026-07-15'), PROVINCES.ALBERTA);
      expect(result).toBeInstanceOf(Date);
    });

    it('returns a date ~90 days before the camping date for Alberta', () => {
      const campDate = new Date('2026-07-15T12:00:00Z');
      const openTime = getBookingOpenTime(campDate, PROVINCES.ALBERTA);

      const expectedDate = new Date(campDate);
      expectedDate.setDate(expectedDate.getDate() - 90);

      expect(openTime.getUTCFullYear()).toBe(expectedDate.getUTCFullYear());
      expect(openTime.getUTCMonth()).toBe(expectedDate.getUTCMonth());
      expect(openTime.getUTCDate()).toBe(expectedDate.getUTCDate());
    });

    it('returns the 1st of the month 4 months prior for BC', () => {
      // Aug 2026 → 4 months back = Apr 2026, day 1
      const openTime = getBookingOpenTime(new Date('2026-08-15T12:00:00Z'), PROVINCES.BC);
      expect(openTime.getUTCMonth()).toBe(3); // April (0-indexed)
      expect(openTime.getUTCDate()).toBe(1);
    });

    it('Alberta open time is within plausible UTC range for midnight MST/MDT', () => {
      const openTime = getBookingOpenTime(new Date('2026-07-15'), PROVINCES.ALBERTA);
      // midnight MST = UTC+7 offset → 07:00 UTC (winter) or 06:00 UTC (summer)
      const utcHour = openTime.getUTCHours();
      expect(utcHour).toBeGreaterThanOrEqual(6);
      expect(utcHour).toBeLessThanOrEqual(7);
    });

    it('BC open time is within plausible UTC range for 07:00 PST/PDT', () => {
      const openTime = getBookingOpenTime(new Date('2026-08-15'), PROVINCES.BC);
      // 07:00 PDT (UTC-7) = 14:00 UTC  |  07:00 PST (UTC-8) = 15:00 UTC
      const utcHour = openTime.getUTCHours();
      expect(utcHour).toBeGreaterThanOrEqual(14);
      expect(utcHour).toBeLessThanOrEqual(15);
    });

    it('the open time is always before the camping date', () => {
      const campDate = new Date('2026-09-01');
      expect(getBookingOpenTime(campDate, PROVINCES.ALBERTA) < campDate).toBe(true);
      expect(getBookingOpenTime(campDate, PROVINCES.BC) < campDate).toBe(true);
    });
  });

  // ── getBookingStartTime ───────────────────────────────────────────────────

  describe('getBookingStartTime', () => {
    it('returns a time strictly before the opening time', () => {
      const openTime = new Date('2026-04-15T14:00:00Z');
      const start = getBookingStartTime(openTime, PROVINCES.BC);
      expect(start < openTime).toBe(true);
    });

    it('the gap equals preBookMinutes for the province', () => {
      const openTime = new Date('2026-04-16T07:00:00Z');
      const start = getBookingStartTime(openTime, PROVINCES.BC);
      const gapMin = (openTime.getTime() - start.getTime()) / 60_000;
      expect(gapMin).toBe(BOOKING_RULES[PROVINCES.BC].preBookMinutes);
    });
  });

  // ── isBookingWindowOpen ───────────────────────────────────────────────────

  describe('isBookingWindowOpen', () => {
    it('returns true for camping dates years in the past', () => {
      const past = new Date();
      past.setFullYear(past.getFullYear() - 2);
      expect(isBookingWindowOpen(past, PROVINCES.ALBERTA)).toBe(true);
      expect(isBookingWindowOpen(past, PROVINCES.BC)).toBe(true);
    });

    it('returns false for camping dates far in the future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      expect(isBookingWindowOpen(future, PROVINCES.ALBERTA)).toBe(false);
      expect(isBookingWindowOpen(future, PROVINCES.BC)).toBe(false);
    });
  });

  // ── getMsUntilBookingOpens ────────────────────────────────────────────────

  describe('getMsUntilBookingOpens', () => {
    it('returns 0 for windows that have already opened', () => {
      const past = new Date();
      past.setFullYear(past.getFullYear() - 2);
      expect(getMsUntilBookingOpens(past, PROVINCES.ALBERTA)).toBe(0);
    });

    it('returns a positive number for future windows', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      expect(getMsUntilBookingOpens(future, PROVINCES.ALBERTA)).toBeGreaterThan(0);
    });

    it('is consistent with isBookingWindowOpen', () => {
      const date = new Date();
      date.setMonth(date.getMonth() + 6);
      const ms = getMsUntilBookingOpens(date, PROVINCES.BC);
      const isOpen = isBookingWindowOpen(date, PROVINCES.BC);
      expect(isOpen ? ms === 0 : ms > 0).toBe(true);
    });
  });
});
