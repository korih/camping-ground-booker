/**
 * popup.js – drives the Camping Ground Booker popup UI.
 *
 * Communicates exclusively with the background service worker via
 * chrome.runtime.sendMessage so the popup remains thin.
 */

(function () {
  'use strict';

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const sectionBookings = document.getElementById('section-bookings');
  const sectionForm = document.getElementById('section-form');
  const bookingList = document.getElementById('booking-list');
  const bookingListEmpty = document.getElementById('booking-list-empty');
  const btnAdd = document.getElementById('btn-add');
  const btnCancel = document.getElementById('btn-cancel');
  const btnOptions = document.getElementById('btn-options');
  const bookingForm = document.getElementById('booking-form');
  const formError = document.getElementById('form-error');

  // Form fields
  const fCampsite = document.getElementById('f-campsite');
  const fProvince = document.getElementById('f-province');
  const fArrival = document.getElementById('f-arrival');
  const fNights = document.getElementById('f-nights');
  const fParty = document.getElementById('f-party');

  // Set a sensible minimum date (today).
  fArrival.min = new Date().toISOString().slice(0, 10);

  // ─── Initialise ────────────────────────────────────────────────────────────
  loadBookings();

  // ─── Event handlers ────────────────────────────────────────────────────────
  btnAdd.addEventListener('click', () => showForm());
  btnCancel.addEventListener('click', () => hideForm());
  btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  bookingForm.addEventListener('submit', handleSubmit);

  // ─── Functions ─────────────────────────────────────────────────────────────

  async function loadBookings() {
    const response = await sendMessage({ type: 'GET_BOOKINGS' });
    if (!response || !response.success) return;
    renderBookings(response.bookings);
  }

  function renderBookings(bookings) {
    bookingList.innerHTML = '';

    if (!bookings || bookings.length === 0) {
      bookingListEmpty.hidden = false;
      return;
    }
    bookingListEmpty.hidden = true;

    bookings.forEach((b) => {
      const li = document.createElement('li');
      li.className = 'booking-item';
      li.dataset.id = b.id;

      const statusClass = `status-${b.status || 'pending'}`;
      const arrivalStr = b.arrivalDate
        ? new Date(b.arrivalDate + 'T12:00:00').toLocaleDateString('en-CA', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
      const provinceLabel = b.province === 'bc' ? 'BC Parks' : 'Alberta Parks';

      li.innerHTML = `
        <div class="booking-item-info">
          <div class="booking-item-name" title="${esc(b.campsite)}">${esc(b.campsite)}</div>
          <div class="booking-item-meta">${provinceLabel} · ${arrivalStr} · ${b.nights || 1} night(s)</div>
        </div>
        <span class="booking-item-status ${statusClass}">${capitalize(b.status || 'pending')}</span>
        <button class="booking-item-delete" aria-label="Remove booking" title="Remove">&times;</button>
      `;

      li.querySelector('.booking-item-delete').addEventListener('click', () =>
        removeBooking(b.id)
      );

      bookingList.appendChild(li);
    });
  }

  function showForm(booking = null) {
    sectionForm.hidden = false;
    btnAdd.style.display = 'none';
    formError.hidden = true;
    bookingForm.reset();

    if (booking) {
      fCampsite.value = booking.campsite || '';
      fProvince.value = booking.province || 'alberta';
      fArrival.value = booking.arrivalDate || '';
      fNights.value = booking.nights || 2;
      fParty.value = booking.partySize || 2;
    }
    fCampsite.focus();
  }

  function hideForm() {
    sectionForm.hidden = true;
    btnAdd.style.display = '';
    formError.hidden = true;
    bookingForm.reset();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    formError.hidden = true;

    const campsite = fCampsite.value.trim();
    const province = fProvince.value;
    const arrivalDate = fArrival.value;
    const nights = parseInt(fNights.value, 10) || 1;
    const partySize = parseInt(fParty.value, 10) || 1;

    if (!campsite) return showFormError('Please enter a campsite or park name.');
    if (!arrivalDate) return showFormError('Please select an arrival date.');
    if (new Date(arrivalDate) < new Date(new Date().toISOString().slice(0, 10))) {
      return showFormError('Arrival date must be in the future.');
    }

    const response = await sendMessage({
      type: 'ADD_BOOKING',
      booking: { campsite, province, arrivalDate, nights, partySize },
    });

    if (!response || !response.success) {
      return showFormError(response?.error || 'Could not save booking. Try again.');
    }

    hideForm();
    loadBookings();
  }

  async function removeBooking(bookingId) {
    if (!confirm('Remove this booking?')) return;
    await sendMessage({ type: 'REMOVE_BOOKING', bookingId });
    loadBookings();
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  /** Wrapper that returns null instead of throwing if the extension context
   *  is not yet ready (e.g. service worker waking up). */
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Popup sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
})();
