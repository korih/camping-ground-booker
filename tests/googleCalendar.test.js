const {
  createBookingReminder,
  deleteBookingReminder,
  CALENDAR_API_BASE,
  CALENDAR_SCOPES,
} = require('../src/utils/googleCalendar');

describe('GoogleCalendar', () => {
  // ── constants ─────────────────────────────────────────────────────────────

  describe('CALENDAR_SCOPES', () => {
    it('requests the calendar.events scope', () => {
      expect(CALENDAR_SCOPES).toContain('calendar.events');
    });
  });

  describe('CALENDAR_API_BASE', () => {
    it('points to the Google Calendar API', () => {
      expect(CALENDAR_API_BASE).toMatch(/googleapis\.com\/calendar/);
    });
  });

  // ── createBookingReminder ─────────────────────────────────────────────────

  describe('createBookingReminder', () => {
    it('throws when no fetch implementation is available', async () => {
      await expect(
        createBookingReminder({
          accessToken: 'tok',
          campsite: 'Test Site',
          campsiteDate: new Date('2026-07-15'),
          bookingOpenTime: new Date('2026-04-16'),
          province: 'alberta',
          fetchFn: null,
        })
      ).rejects.toThrow('fetch is not available');
    });

    it('POSTs to the correct Calendar API URL', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'ev1', summary: 'Test' }),
      });

      const result = await createBookingReminder({
        accessToken: 'tok',
        campsite: 'Banff – Tunnel Mountain',
        campsiteDate: new Date('2026-07-15'),
        bookingOpenTime: new Date('2026-04-16T07:00:00Z'),
        province: 'alberta',
        fetchFn: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain(CALENDAR_API_BASE);
      expect(url).toContain('primary');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer tok');
      expect(result.id).toBe('ev1');
    });

    it('embeds the campsite name and province in the event', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'ev2' }),
      });

      await createBookingReminder({
        accessToken: 'tok',
        campsite: 'Jasper – Whistlers',
        campsiteDate: new Date('2026-08-10'),
        bookingOpenTime: new Date('2026-05-11T07:00:00Z'),
        province: 'alberta',
        fetchFn: mockFetch,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.summary).toContain('Jasper – Whistlers');
      expect(body.description).toContain('Jasper – Whistlers');
      expect(body.description).toContain('Alberta Parks');
      expect(body.reminders.overrides).toHaveLength(3);
    });

    it('labels the event as BC Parks for the bc province', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'ev3' }),
      });

      await createBookingReminder({
        accessToken: 'tok',
        campsite: 'Garibaldi – Rubble Creek',
        campsiteDate: new Date('2026-09-01'),
        bookingOpenTime: new Date('2026-05-01T14:00:00Z'),
        province: 'bc',
        fetchFn: mockFetch,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.summary).toContain('BC Parks');
    });

    it('uses a custom calendarId when provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'ev4' }),
      });

      await createBookingReminder({
        accessToken: 'tok',
        campsite: 'Test',
        campsiteDate: new Date('2026-07-15'),
        bookingOpenTime: new Date('2026-04-16'),
        province: 'alberta',
        calendarId: 'custom@group.calendar.google.com',
        fetchFn: mockFetch,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('custom%40group.calendar.google.com');
    });

    it('throws a descriptive error on API failure', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: { message: 'Invalid credentials' } }),
      });

      await expect(
        createBookingReminder({
          accessToken: 'bad-tok',
          campsite: 'Test',
          campsiteDate: new Date('2026-07-15'),
          bookingOpenTime: new Date('2026-04-16'),
          province: 'alberta',
          fetchFn: mockFetch,
        })
      ).rejects.toThrow('Failed to create calendar event: 401');
    });
  });

  // ── deleteBookingReminder ─────────────────────────────────────────────────

  describe('deleteBookingReminder', () => {
    it('throws when no fetch implementation is available', async () => {
      await expect(
        deleteBookingReminder({ accessToken: 'tok', eventId: 'ev1', fetchFn: null })
      ).rejects.toThrow('fetch is not available');
    });

    it('sends a DELETE request to the correct endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });

      await deleteBookingReminder({ accessToken: 'tok', eventId: 'ev1', fetchFn: mockFetch });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/events/ev1');
      expect(opts.method).toBe('DELETE');
      expect(opts.headers.Authorization).toBe('Bearer tok');
    });

    it('resolves silently on 404 (event already deleted)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      await expect(
        deleteBookingReminder({ accessToken: 'tok', eventId: 'gone', fetchFn: mockFetch })
      ).resolves.toBeUndefined();
    });

    it('throws on other non-OK status codes', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(
        deleteBookingReminder({ accessToken: 'tok', eventId: 'ev1', fetchFn: mockFetch })
      ).rejects.toThrow('Failed to delete calendar event: 403');
    });
  });
});
