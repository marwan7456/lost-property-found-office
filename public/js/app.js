/*
 * Lost Property Office - front end
 * Plain JavaScript, no libraries. One page, five views, switched by the URL hash:
 *   #/signin  #/home  #/log  #/records  #/records/<id>
 *
 * Accessibility patterns used throughout:
 *  - every view change moves focus to the new <h1> and updates document.title
 *  - one polite live region (#announcer) for status messages
 *  - form errors: summary box (focused) + inline message + aria-invalid on the field
 *  - after a re-render, focus goes back to something sensible, never lost to <body>
 */
(function () {
  'use strict';

  /* =========================================================
     Small helpers
     ========================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pause = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

  // Escape anything typed by a user before it goes into innerHTML
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Local date as YYYY-MM-DD (toISOString alone is UTC and gives the wrong day near midnight)
  function todayIso() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function daysBetween(isoA, isoB) {
    return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
  }
  const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const niceDate = iso => (iso ? dateFormatter.format(new Date(iso + 'T12:00:00')) : '');
  const niceTime = iso => timeFormatter.format(new Date(iso));
  function ago(iso) {
    const n = daysBetween(iso, todayIso());
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
  }

  /* ---------- Live region ---------- */
  let announceTimer;
  function announce(message, delay = 100) {
    const region = $('#announcer');
    clearTimeout(announceTimer);
    region.textContent = '';
    // Clearing then setting after a short delay makes screen readers repeat identical messages
    announceTimer = setTimeout(() => { region.textContent = message; }, delay);
  }

  /* ---------- Signed-in staff member (simulated sign-in) ---------- */
  const STAFF_KEY = 'lpo-staff';
  function getStaff() {
    try { return JSON.parse(sessionStorage.getItem(STAFF_KEY)); } catch { return null; }
  }
  function setStaff(staff) {
    try {
      if (staff) sessionStorage.setItem(STAFF_KEY, JSON.stringify(staff));
      else sessionStorage.removeItem(STAFF_KEY);
    } catch { /* storage blocked: the session lasts until refresh */ }
  }

  /* ---------- API wrapper ---------- */
  // Responses from a local server are almost instant. A short minimum time keeps the
  // loading and saving states visible long enough to be noticed (visibility of system status).
  const MIN_FEEDBACK_MS = 350;

  // The pages only work when they are served by server.js, because that is what answers /api/...
  // These messages explain the real problem instead of blaming the user's internet connection.
  const OPENED_AS_FILE = location.protocol === 'file:';
  const ON_LOCAL_MACHINE = OPENED_AS_FILE || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SETUP_HELP = 'Start the server by running "node server.js" in the lostfound folder, then open http://localhost:3000 in your browser. Do not double-click index.html or use Live Server.';

  async function api(path, options = {}) {
    const staff = getStaff() || {};
    const started = Date.now();
    let response, data;
    if (OPENED_AS_FILE) {
      await pause(MIN_FEEDBACK_MS);
      const err = new Error('This page was opened as a file, so it cannot reach the server. ' + SETUP_HELP);
      err.network = true;
      throw err;
    }
    try {
      response = await fetch(path, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Staff-Name': staff.name || '',
          'X-Staff-Role': staff.role || ''
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      data = await response.json().catch(() => null);
    } catch {
      await pause(MIN_FEEDBACK_MS - (Date.now() - started));
      const err = new Error(ON_LOCAL_MACHINE
        ? 'The Lost Property server is not running. ' + SETUP_HELP
        : 'The system could not reach the server. Check your connection and try again.');
      err.network = true;
      throw err;
    }
    await pause(MIN_FEEDBACK_MS - (Date.now() - started));
    // Something answered, but not server.js (for example Live Server, which returns an HTML page)
    if (data === null) {
      const err = new Error(ON_LOCAL_MACHINE
        ? 'This page is not connected to the Lost Property server. ' + SETUP_HELP
        : 'The server sent an unexpected reply. Try again in a moment.');
      err.network = true;
      throw err;
    }
    if (!response.ok) {
      const err = new Error(data.error || 'Something went wrong. Try again.');
      err.status = response.status;
      err.fields = data.fields;
      throw err;
    }
    return data;
  }

  // Warn straight away if the page was opened as a file: sign-in is simulated, so otherwise
  // the problem would only show up later, when the first record fails to save.
  if (OPENED_AS_FILE) {
    const warning = document.createElement('div');
    warning.className = 'notice notice--error notice--top';   // spacing lives in main.css, not an inline style
    warning.innerHTML = '<h2>The server is not connected</h2><p>This page was opened as a file, so records cannot be loaded or saved. ' + esc(SETUP_HELP) + '</p>';
    $('#main').prepend(warning);
  }

  // In the phone layout (same 46rem breakpoint as main.css) the table header is visually hidden and each
  // card shows its own labels. The sort buttons in that hidden header would still be in the tab order, so a
  // keyboard user would land on 7 invisible buttons (WCAG 2.4.7). Below the breakpoint they are taken out of
  // the tab order; sorting is still available from the "Sort by" list in the filters, which is always visible.
  // Screen readers can still reach the headers with table navigation.
  const CARD_LAYOUT = window.matchMedia('(max-width: 46rem)');
  CARD_LAYOUT.addEventListener('change', () => {
    document.querySelectorAll('.sort-button').forEach(btn => {
      if (CARD_LAYOUT.matches) btn.setAttribute('tabindex', '-1');
      else btn.removeAttribute('tabindex');
    });
  });

  /* ---------- Buttons that show a busy state ---------- */
  function setBusy(button, busy, busyText) {
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyText;
      button.setAttribute('aria-disabled', 'true');
      button.dataset.busy = 'true';
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.removeAttribute('aria-disabled');
      delete button.dataset.busy;
    }
  }
  // aria-disabled (not disabled) keeps the button focusable, so keyboard focus is not lost while saving
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-busy="true"]');
    if (b) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* =========================================================
     Form errors (shared by every form)
     ========================================================= */
  function clearErrors(form, summary) {
    $$('.field--error', form).forEach(el => el.classList.remove('field--error'));
    $$('[aria-invalid]', form).forEach(el => el.removeAttribute('aria-invalid'));
    $$('.error-message', form).forEach(el => { el.textContent = ''; });
    summary.hidden = true;
    summary.innerHTML = '';
  }

  // errors: [{ id: 'fieldId', message: 'text' }], in the order the fields appear
  function showErrors(form, summary, errors) {
    clearErrors(form, summary);
    if (!errors.length) return;
    errors.forEach(({ id, message }) => {
      const group = $('#' + id + '-group');
      const msg = $('#' + id + '-error');
      const control = $('#' + id) || (group && $('input, select, textarea', group));
      if (group) group.classList.add('field--error');
      if (msg) msg.innerHTML = '<span class="visually-hidden">Error: </span>' + esc(message);
      if (control) control.setAttribute('aria-invalid', 'true');
      if (group && group.tagName === 'FIELDSET') $$('input', group).forEach(i => i.setAttribute('aria-invalid', 'true'));
    });
    summary.innerHTML =
      '<h2>There ' + (errors.length === 1 ? 'is a problem' : 'are ' + errors.length + ' problems') + '</h2>' +
      '<ul>' + errors.map(e => '<li><a href="#' + e.id + '" data-target="' + e.id + '">' + esc(e.message) + '</a></li>').join('') + '</ul>';
    summary.hidden = false;
    summary.focus();
  }

  // Summary links move focus to the field itself (the hash would otherwise change the route)
  document.addEventListener('click', e => {
    const link = e.target.closest('.error-summary a[data-target]');
    if (!link) return;
    e.preventDefault();
    const id = link.dataset.target;
    const target = $('#' + id) || $('#' + id + '-group input');
    if (target) {
      target.focus();
      const group = $('#' + id + '-group');
      if (group) group.scrollIntoView({ block: 'center' });
    }
  });

  /* =========================================================
     Router
     ========================================================= */
  const VIEW_TITLES = { signin: 'Sign in', home: 'Home', log: 'Log an item', records: 'Records', record: 'Record' };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    return { view: parts[0] || 'home', id: parts[1], query: new URLSearchParams(queryPart || '') };
  }

  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function showView(name, pageTitle) {
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    const signedIn = !!getStaff();
    $('#site-nav').hidden = !signedIn;
    $('#staff-box').hidden = !signedIn;
    const navKey = name === 'record' ? 'records' : name;
    $$('#site-nav a').forEach(a => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = pageTitle + ' – Lost Property Office';
  }

  function focusHeading(name) {
    const h = $('#view-' + name + ' h1');
    if (h) h.focus();
    window.scrollTo(0, 0);
  }

  async function route() {
    const { view, id, query } = parseHash();
    const staff = getStaff();

    if (!staff && view !== 'signin') { navigate('#/signin'); return; }
    if (staff && view === 'signin') { navigate('#/home'); return; }

    if (staff) $('#staff-label').textContent = 'Signed in as ' + staff.name + ' (' + staff.role + ')';

    switch (view) {
      case 'signin':
        showView('signin', VIEW_TITLES.signin); focusHeading('signin'); break;
      case 'home':
        showView('home', VIEW_TITLES.home); focusHeading('home'); await renderHome(); break;
      case 'log':
        showView('log', VIEW_TITLES.log); prepareLogForm(query); focusHeading('log'); break;
      case 'records':
        if (id) {
          showView('record', VIEW_TITLES.record); await renderRecord(Number(id));
        } else {
          showView('records', VIEW_TITLES.records); applyQueryToFilters(query); focusHeading('records'); await loadRecords();
        }
        break;
      default:
        navigate('#/home');
    }
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     Data cache
     ========================================================= */
  let records = [];
  async function fetchRecords() {
    records = await api('/api/records');
    return records;
  }

  /* =========================================================
     SIGN IN
     ========================================================= */
  $('#show-password').addEventListener('change', e => {
    $('#password').type = e.target.checked ? 'text' : 'password';
  });

  $('#signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const summary = $('#signin-errors');
    const name = $('#staffName').value.trim();
    const password = $('#password').value;
    const role = $('input[name="role"]:checked', form).value;
    const errors = [];

    if (!name) errors.push({ id: 'staffName', message: 'Enter your staff name' });
    if (!password) errors.push({ id: 'password', message: 'Enter your password' });
    else if (password.length < 4) errors.push({ id: 'password', message: 'Password must be at least 4 characters' });

    if (errors.length) { showErrors(form, summary, errors); return; }
    clearErrors(form, summary);

    const button = $('#signin-button');
    setBusy(button, true, 'Signing in…');
    announce('Signing in, please wait');
    await pause(900); // simulated authentication delay
    setBusy(button, false);

    setStaff({ name, role });
    form.reset();
    $('#password').type = 'password';
    announce('Signed in as ' + name + ', ' + role);
    navigate('#/home');
  });

  $('#sign-out').addEventListener('click', () => {
    setStaff(null);
    records = [];
    try { sessionStorage.removeItem(FILTER_KEY); } catch { /* ignore */ }
    navigate('#/signin');
    announce('You have signed out');
  });

  /* =========================================================
     HOME
     ========================================================= */
  async function renderHome() {
    const staff = getStaff();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('#home-welcome').textContent = greeting + ', ' + staff.name + '. You are signed in as a ' + staff.role.toLowerCase() + '.';

    const tiles = $('#home-tiles');
    tiles.innerHTML = '<li><p class="loading"><span class="spinner" aria-hidden="true"></span> Loading summary…</p></li>';
    tiles.setAttribute('aria-busy', 'true');

    try {
      await fetchRecords();
    } catch (err) {
      tiles.removeAttribute('aria-busy');
      tiles.innerHTML = '<li class="notice notice--error"><p><strong>Error:</strong> ' + esc(err.message) + '</p><button type="button" class="button button--secondary" id="home-retry">Try again</button></li>';
      $('#home-retry').addEventListener('click', renderHome);
      announce('Error: the summary could not be loaded');
      return;
    }

    const today = todayIso();
    const open = records.filter(r => r.status === 'Open');
    const openFound = open.filter(r => r.kind === 'found');
    const openLost = open.filter(r => r.kind === 'lost');
    const valuables = openFound.filter(r => r.flags.includes('Valuable'));
    const old = openFound.filter(r => daysBetween(r.date, today) > 30).sort((a, b) => a.date.localeCompare(b.date));

    const tileData = [
      [openFound.length, 'Found items in storage', '#/records?kind=found&status=Open'],
      [openLost.length, 'Open lost-item enquiries', '#/records?kind=lost&status=Open'],
      [valuables.length, 'Valuables in storage', '#/records?kind=found&status=Open&flag=Valuable'],
      [records.filter(r => r.status === 'Returned').length, 'Items returned to owners', '#/records?status=Returned']
    ];
    tiles.innerHTML = tileData.map(([n, label, href]) =>
      '<li><a class="tile" href="' + href + '"><span class="tile-number">' + n + '</span><span class="tile-label">' + esc(label) + '</span></a></li>'
    ).join('');
    tiles.removeAttribute('aria-busy');

    // Needs attention (role-aware wording)
    const attention = $('#attention-list');
    if (!old.length) {
      attention.innerHTML = '<p>Nothing needs attention. All found items are less than 30 days old.</p>';
    } else {
      const roleNote = staff.role === 'Supervisor'
        ? 'Open each record to return it or mark it as disposed.'
        : 'A supervisor can mark these as disposed. You can still return them to an owner.';
      attention.innerHTML = '<p>' + roleNote + '</p><ul class="plain-list">' + old.slice(0, 5).map(r =>
        '<li><a href="#/records/' + r.id + '">' + esc(r.title) + '</a><span class="meta">' + esc(r.ref) + ' · in storage ' + daysBetween(r.date, today) + ' days · shelf ' + esc(r.shelf) + '</span></li>'
      ).join('') + '</ul>' + (old.length > 5 ? '<p><a href="#/records?kind=found&status=Open&sort=date:asc">See all ' + old.length + ' items</a></p>' : '');
    }

    // Recently logged (newest record IDs first)
    const recent = records.slice().sort((a, b) => b.id - a.id).slice(0, 5);
    $('#recent-list').innerHTML = recent.map(r =>
      '<li><a href="#/records/' + r.id + '">' + esc(r.title) + '</a><span class="meta">' + esc(r.ref) + ' · ' + (r.kind === 'found' ? 'Found' : 'Lost enquiry') + ' · ' + esc(niceDate(r.date)) + '</span></li>'
    ).join('');
  }

  /* =========================================================
     LOG AN ITEM
     ========================================================= */
  const logForm = $('#log-form');

  // Show or hide the parts of the form that depend on earlier answers.
  // Hidden sections use the hidden attribute so they are removed from the tab order
  // and from the accessibility tree. Nothing moves focus or submits (3.2.2).
  function syncLogForm() {
    const kind = $('input[name="kind"]:checked', logForm).value;
    const found = kind === 'found';
    $('#found-section').hidden = !found;
    $('#lost-section').hidden = found;
    $('#location-label').textContent = found ? 'Where was it found?' : 'Where did the owner lose it?';
    $('#date-label').textContent = found ? 'Date found' : 'Date lost';
    $('#log-submit').textContent = found ? 'Save found item' : 'Save lost enquiry';
    $('#otherCategory-group').hidden = $('#category').value !== 'Other';
    $('#locationOther-group').hidden = $('#locationChoice').value !== 'elsewhere';
    updateNotesCount();
  }

  function updateNotesCount() {
    const left = 300 - $('#notes').value.length;
    $('#notes-count').textContent = left === 300 ? 'You can enter up to 300 characters.' : 'You have ' + left + ' character' + (left === 1 ? '' : 's') + ' remaining.';
  }

  ['change', 'input'].forEach(evt => logForm.addEventListener(evt, e => {
    if (e.target.matches('input[name="kind"], #category, #locationChoice')) syncLogForm();
  }));
  $('#notes').addEventListener('input', updateNotesCount);

  // Error prevention: ticking "Valuable" on a found item suggests the safe
  $('#flag-valuable').addEventListener('change', e => {
    const shelf = $('#shelf');
    if (e.target.checked && $('#kind-found').checked && shelf.value === '') {
      shelf.value = 'Safe';
      announce('Storage set to the safe because the item is valuable');
    }
  });

  logForm.addEventListener('reset', () => {
    // Let the browser reset first, then put sensible defaults back
    setTimeout(() => {
      $('#date').value = todayIso();
      clearErrors(logForm, $('#log-errors'));
      $('#log-success').hidden = true;
      syncLogForm();
      announce('Form cleared');
    });
  });

  function prepareLogForm(query) {
    $('#date').max = todayIso();
    if (!$('#date').value) $('#date').value = todayIso();
    const kind = query.get('kind');
    if (kind === 'found' || kind === 'lost') $('#kind-' + kind).checked = true;
    $('#log-success').hidden = true;
    syncLogForm();
  }

  function readLogForm() {
    const v = id => $('#' + id).value.trim();
    const kind = $('input[name="kind"]:checked', logForm).value;
    const locationChoice = v('locationChoice');
    return {
      kind,
      title: v('title'),
      category: v('category'),
      otherCategory: v('otherCategory'),
      locationChoice,
      location: locationChoice === 'elsewhere' ? v('locationOther') : locationChoice,
      date: v('date'),
      shelf: v('shelf'),
      owner: v('owner'),
      contact: v('contact'),
      flags: $$('input[name="flags"]:checked', logForm).map(c => c.value),
      notes: $('#notes').value.trim()
    };
  }

  function validateLog(d) {
    const errors = [];
    const found = d.kind === 'found';
    if (!d.title) errors.push({ id: 'title', message: 'Enter a description of the item' });
    else if (d.title.length < 3) errors.push({ id: 'title', message: 'Description must be at least 3 characters' });
    if (!d.category) errors.push({ id: 'category', message: 'Select a category' });
    else if (d.category === 'Other' && !d.otherCategory) errors.push({ id: 'otherCategory', message: 'Enter what kind of item it is' });
    if (!d.locationChoice) errors.push({ id: 'locationChoice', message: found ? 'Select where the item was found' : 'Select where the owner lost it' });
    else if (d.locationChoice === 'elsewhere' && !d.location) errors.push({ id: 'locationOther', message: 'Describe the place' });
    if (!d.date) errors.push({ id: 'date', message: 'Enter the date, for example ' + niceDate(todayIso()) });
    else if (d.date > todayIso()) errors.push({ id: 'date', message: 'The date cannot be in the future' });
    else if (daysBetween(d.date, todayIso()) > 365) errors.push({ id: 'date', message: 'The date must be within the last year' });
    if (found) {
      if (!d.shelf) errors.push({ id: 'shelf', message: 'Select where the item is being stored' });
      else if (d.flags.includes('Valuable') && d.shelf !== 'Safe') errors.push({ id: 'shelf', message: 'Valuable items must be stored in the safe. Select Safe (valuables)' });
    } else {
      if (!d.owner) errors.push({ id: 'owner', message: 'Enter the owner\'s full name' });
      if (!d.contact) errors.push({ id: 'contact', message: 'Enter an email address or phone number' });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contact) && !/^\+?[\d\s()-]{7,}$/.test(d.contact)) {
        errors.push({ id: 'contact', message: 'Enter an email address like name@example.com, or a phone number like 07700 900123' });
      }
    }
    return errors;
  }

  logForm.addEventListener('submit', async e => {
    e.preventDefault();
    const summary = $('#log-errors');
    const success = $('#log-success');
    const button = $('#log-submit');
    if (button.dataset.busy) return;
    success.hidden = true;

    const data = readLogForm();
    const errors = validateLog(data);
    if (errors.length) { showErrors(logForm, summary, errors); return; }
    clearErrors(logForm, summary);

    setBusy(button, true, 'Saving…');
    announce('Saving record');
    let saved;
    try {
      saved = await api('/api/records', { method: 'POST', body: data });
    } catch (err) {
      setBusy(button, false);
      if (err.fields) {
        // Server found a problem the browser missed: show it the same way
        showErrors(logForm, summary, Object.entries(err.fields).map(([id, message]) => ({ id: id === 'location' ? 'locationChoice' : id, message })));
      } else {
        summary.innerHTML = '<h2>The record was not saved</h2><p>' + esc(err.message) + ' Your answers are still in the form.</p>';
        summary.hidden = false;
        summary.focus();
      }
      return;
    }
    setBusy(button, false);
    records.push(saved);

    // Possible matches: for a lost enquiry, show open found items in the same category (recognition over recall)
    let matchesHtml = '';
    if (saved.kind === 'lost') {
      try { await fetchRecords(); } catch { /* use cached list */ }
      const matches = records.filter(r => r.kind === 'found' && r.status === 'Open' && r.category === saved.category);
      matchesHtml = matches.length
        ? '<h3>Possible matches already handed in (' + matches.length + ')</h3><ul>' + matches.slice(0, 5).map(r =>
            '<li><a href="#/records/' + r.id + '">' + esc(r.title) + '</a> – ' + esc(r.location) + ', ' + esc(niceDate(r.date)) + ', shelf ' + esc(r.shelf) + '</li>').join('') + '</ul>'
        : '<p>No open found items in this category yet.</p>';
    }

    const what = saved.kind === 'found' ? 'Found item saved. Store it ' + (saved.shelf === 'Safe' ? 'in the safe.' : 'on shelf ' + saved.shelf + '.') : 'Lost-item enquiry saved.';
    success.innerHTML =
      '<h2>' + esc(saved.ref) + ' saved</h2>' +
      '<p>' + esc(saved.title) + '. ' + esc(what) + ' <a href="#/records/' + saved.id + '">View ' + esc(saved.ref) + '</a></p>' +
      matchesHtml +
      '<p>The form is ready for the next item. Report type, place and date have been kept.</p>';
    success.hidden = false;

    // Efficiency for repeat entry: keep kind, place and date; clear the rest
    const keep = { kind: data.kind, locationChoice: data.locationChoice, locationOther: $('#locationOther').value, date: data.date };
    ['title', 'category', 'otherCategory', 'shelf', 'owner', 'contact', 'notes'].forEach(id => { $('#' + id).value = ''; });
    $$('input[name="flags"]', logForm).forEach(c => { c.checked = false; });
    $('#kind-' + keep.kind).checked = true;
    $('#locationChoice').value = keep.locationChoice;
    $('#locationOther').value = keep.locationOther;
    $('#date').value = keep.date;
    syncLogForm();
    success.focus();
  });

  /* =========================================================
     RECORDS (search, filter, sort, paginate)
     ========================================================= */
  const FILTER_KEY = 'lpo-filters';
  const COLUMNS = [
    { key: 'ref', label: 'Ref.' },
    { key: 'title', label: 'Description' },
    { key: 'kind', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'location', label: 'Place' },
    { key: 'date', label: 'Date' },
    { key: 'status', label: 'Status' }
  ];
  const state = { q: '', kind: '', status: '', category: '', sort: 'date:desc', size: 10, page: 1, flag: '' };

  function saveFilters() {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }
  function restoreFilters() {
    try { Object.assign(state, JSON.parse(sessionStorage.getItem(FILTER_KEY)) || {}); } catch { /* ignore */ }
  }
  function writeFiltersToForm() {
    $('#f-search').value = state.q;
    $('#f-kind').value = state.kind;
    $('#f-status').value = state.status;
    $('#f-category').value = state.category;
    $('#f-sort').value = state.sort;
    if (!$('#f-sort').value) { state.sort = 'date:desc'; $('#f-sort').value = state.sort; }
    $('#f-size').value = String(state.size);
  }

  // Links from the home page carry filters in the hash, e.g. #/records?kind=found&status=Open
  function applyQueryToFilters(query) {
    restoreFilters();
    if ([...query.keys()].length) {
      Object.assign(state, { q: query.get('q') || '', kind: query.get('kind') || '', status: query.get('status') || '',
        category: query.get('category') || '', flag: query.get('flag') || '', page: 1 });
      if (query.get('sort')) state.sort = query.get('sort');
      // Tidy the address so a refresh doesn't keep re-applying it over later changes
      history.replaceState(null, '', '#/records');
      saveFilters();
    }
    writeFiltersToForm();
  }

  async function loadRecords() {
    const loading = $('#records-loading');
    const table = $('#records-table');
    const error = $('#records-error');
    error.hidden = true;
    loading.hidden = false;
    table.setAttribute('aria-busy', 'true');
    $('#result-count').textContent = '';
    announce('Loading records');
    try {
      await fetchRecords();
      loading.hidden = true;
      table.removeAttribute('aria-busy');
      renderTable({ announceCount: true });
    } catch (err) {
      loading.hidden = true;
      table.hidden = true;
      error.innerHTML = '<p><strong>Error:</strong> ' + esc(err.message) + '</p><button type="button" class="button button--secondary" id="records-retry">Try again</button>';
      error.hidden = false;
      $('#records-retry').addEventListener('click', loadRecords);
      error.focus();
    }
  }

  function filteredRecords() {
    const q = state.q.trim().toLowerCase();
    const [key, dir] = state.sort.split(':');
    const list = records.filter(r =>
      (!q || [r.ref, r.title, r.location, r.owner, r.otherCategory, r.category].join(' ').toLowerCase().includes(q)) &&
      (!state.kind || r.kind === state.kind) &&
      (!state.status || r.status === state.status) &&
      (!state.category || r.category === state.category) &&
      (!state.flag || r.flags.includes(state.flag))
    );
    list.sort((a, b) => {
      const cmp = key === 'ref' ? a.id - b.id : String(a[key]).localeCompare(String(b[key]), 'en', { sensitivity: 'base' });
      return (dir === 'desc' ? -cmp : cmp) || b.id - a.id;
    });
    return list;
  }

  function statusBadge(status) {
    const icon = { Open: '○', Returned: '✓', Disposed: '✕' }[status] || '';
    return '<span class="badge badge--' + status.toLowerCase() + '"><span aria-hidden="true">' + icon + ' </span>' + esc(status) + '</span>';
  }

  function renderTable(opts = {}) {
    const list = filteredRecords();
    const pages = Math.max(1, Math.ceil(list.length / state.size));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.size;
    const pageRows = list.slice(start, start + state.size);
    const [sortKey, sortDir] = state.sort.split(':');

    // Header: each sortable column has a real <button>; aria-sort is on the <th>.
    // The explicit table roles (columnheader, row, cell, rowheader) look redundant, but they are deliberate:
    // below 46rem main.css sets the table to display:block to show cards, and some browsers (Safari/VoiceOver
    // in particular) then stop exposing it as a table. The roles keep the row/column structure for screen readers.
    $('#records-head').innerHTML = COLUMNS.map(c => {
      const active = c.key === sortKey;
      const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      const icon = active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
      return '<th scope="col" role="columnheader" aria-sort="' + ariaSort + '"><button type="button" class="sort-button" data-sort="' + c.key + '"' + (CARD_LAYOUT.matches ? ' tabindex="-1"' : '') + '>' +
        esc(c.label) + '<span class="sort-icon" aria-hidden="true">' + icon + '</span></button></th>';
    }).join('');

    $('#records-body').innerHTML = pageRows.map(r => {
      const category = r.category === 'Other' && r.otherCategory ? 'Other: ' + r.otherCategory : r.category;
      const flags = r.flags.length ? '<span class="meta">' + esc(r.flags.join(', ')) + '</span>' : '';
      const cell = (label, html) => '<td role="cell"><span class="cell-label" aria-hidden="true">' + label + ': </span>' + html + '</td>';
      return '<tr role="row">' +
        cell('Ref.', esc(r.ref)) +
        '<th scope="row" role="rowheader"><a href="#/records/' + r.id + '">' + esc(r.title) + '</a>' + flags + '</th>' +
        cell('Type', '<span class="kind">' + (r.kind === 'found' ? 'Found' : 'Lost enquiry') + '</span>') +
        cell('Category', esc(category)) +
        cell('Place', esc(r.location)) +
        cell('Date', '<time datetime="' + esc(r.date) + '">' + esc(niceDate(r.date)) + '</time>') +
        cell('Status', statusBadge(r.status)) +
        '</tr>';
    }).join('');

    const empty = list.length === 0;
    $('#records-empty').hidden = !empty;
    $('#records-table').hidden = empty;

    const filtered = state.q || state.kind || state.status || state.category || state.flag;
    let countText = empty
      ? 'No records found'
      : 'Showing ' + (start + 1) + ' to ' + (start + pageRows.length) + ' of ' + list.length + ' record' + (list.length === 1 ? '' : 's');
    if (filtered) countText += ' (filtered from ' + records.length + ')';
    if (state.flag) countText += ' – only items flagged ' + state.flag.toLowerCase();
    $('#result-count').textContent = countText;

    const pager = $('#pagination');
    pager.innerHTML = pages > 1
      ? '<button type="button" class="button button--secondary button--small" data-page="prev"' + (state.page === 1 ? ' aria-disabled="true"' : '') + '>Previous<span class="visually-hidden"> page</span></button>' +
        '<p>Page ' + state.page + ' of ' + pages + '</p>' +
        '<button type="button" class="button button--secondary button--small" data-page="next"' + (state.page === pages ? ' aria-disabled="true"' : '') + '>Next<span class="visually-hidden"> page</span></button>'
      : '';

    if (opts.announceCount) announce(countText, opts.delay || 100);
    saveFilters();
  }

  // Filters update the table straight away. The count is announced after a pause in typing,
  // so a screen reader is not interrupted on every key press.
  const filterInputs = { 'f-search': 'q', 'f-kind': 'kind', 'f-status': 'status', 'f-category': 'category', 'f-sort': 'sort', 'f-size': 'size' };
  Object.entries(filterInputs).forEach(([id, key]) => {
    $('#' + id).addEventListener(id === 'f-search' ? 'input' : 'change', e => {
      state[key] = key === 'size' ? Number(e.target.value) : e.target.value;
      if (key !== 'sort') state.page = 1;
      renderTable({ announceCount: true, delay: id === 'f-search' ? 800 : 100 });
    });
  });
  $('#filters').addEventListener('submit', e => e.preventDefault()); // Enter in search does not reload

  function clearFilters() {
    Object.assign(state, { q: '', kind: '', status: '', category: '', flag: '', page: 1 });
    writeFiltersToForm();
    renderTable({ announceCount: true });
    $('#f-search').focus();
  }
  $('#f-clear').addEventListener('click', clearFilters);
  $('#empty-clear').addEventListener('click', clearFilters);

  // Sorting from the column headers
  $('#records-head').addEventListener('click', e => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    const key = btn.dataset.sort;
    const [curKey, curDir] = state.sort.split(':');
    const dir = curKey === key ? (curDir === 'asc' ? 'desc' : 'asc') : (key === 'date' ? 'desc' : 'asc');
    state.sort = key + ':' + dir;
    // Keep the "Sort by" list in step; add the option if this combination is not listed
    const select = $('#f-sort');
    if (![...select.options].some(o => o.value === state.sort)) {
      const label = COLUMNS.find(c => c.key === key).label + ', ' + (dir === 'asc' ? 'ascending' : 'descending');
      select.add(new Option(label, state.sort));
    }
    select.value = state.sort;
    renderTable();
    // The header was rebuilt, so put focus back on the same button (2.4.3)
    $('#records-head [data-sort="' + key + '"]').focus();
    announce('Sorted by ' + COLUMNS.find(c => c.key === key).label + ', ' + (dir === 'asc' ? 'ascending' : 'descending'));
  });

  $('#pagination').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    state.page += btn.dataset.page === 'next' ? 1 : -1;
    renderTable({ announceCount: true });
    // New page of results: move focus to the count above the table so reading starts at the top
    $('#result-count').focus();
  });

  /* =========================================================
     RECORD DETAIL + STATUS UPDATE
     ========================================================= */
  async function renderRecord(id) {
    const content = $('#record-content');
    const loading = $('#record-loading');
    const section = $('#view-record');
    // Only point aria-labelledby at the heading once it exists, so it is never a broken reference
    section.removeAttribute('aria-labelledby');
    content.innerHTML = '';
    loading.hidden = false;
    document.title = 'Loading record – Lost Property Office';
    let r;
    try {
      r = await api('/api/records/' + id);
    } catch (err) {
      loading.hidden = true;
      const notFound = err.status === 404;
      document.title = (notFound ? 'Record not found' : 'Error') + ' – Lost Property Office';
      content.innerHTML = '<h1 id="record-title" tabindex="-1">' + (notFound ? 'Record not found' : 'The record could not be loaded') + '</h1>' +
        '<p>' + (notFound ? 'There is no record with that number. It may have been typed incorrectly.' : esc(err.message)) + '</p>' +
        '<p><a href="#/records">Go to all records</a></p>';
      section.setAttribute('aria-labelledby', 'record-title');
      $('h1', content).focus();
      return;
    }
    loading.hidden = true;
    const i = records.findIndex(x => x.id === r.id);
    if (i >= 0) records[i] = r; else records.push(r);
    drawRecord(r);
    document.title = r.ref + ' ' + r.title + ' – Lost Property Office';
    section.setAttribute('aria-labelledby', 'record-title');
    $('#record-title').focus();
  }

  function drawRecord(r, message) {
    const staff = getStaff();
    const isSupervisor = staff.role === 'Supervisor';
    const rows = [
      ['Reference', esc(r.ref)],
      ['Type', r.kind === 'found' ? 'Found item' : 'Lost-item enquiry'],
      ['Category', esc(r.category === 'Other' && r.otherCategory ? 'Other: ' + r.otherCategory : r.category)],
      [r.kind === 'found' ? 'Where found' : 'Where lost', esc(r.location)],
      [r.kind === 'found' ? 'Date found' : 'Date lost', esc(niceDate(r.date)) + ' (' + ago(r.date) + ')']
    ];
    if (r.kind === 'found') rows.push(['Stored on', esc(r.shelf === 'Safe' ? 'Safe (valuables)' : 'Shelf ' + r.shelf)]);
    if (r.kind === 'lost') rows.push(['Owner', esc(r.owner)], ['Contact', esc(r.contact)]);
    rows.push(['Flags', r.flags.length ? esc(r.flags.join(', ')) : 'None']);
    if (r.notes) rows.push(['Notes', esc(r.notes)]);
    if (r.returnedTo) rows.push(['Returned to', esc(r.returnedTo)]);

    let updateHtml;
    if (r.status === 'Open') {
      updateHtml =
        '<h2 id="update-title">Update status</h2>' +
        '<div class="error-summary" id="update-errors" tabindex="-1" hidden></div>' +
        '<form id="update-form" class="card" novalidate aria-labelledby="update-title">' +
          '<fieldset class="field" id="newStatus-group"><legend>What has happened to this item?</legend>' +
            '<p class="error-message" id="newStatus-error"></p>' +
            '<div class="radio"><input type="radio" id="newStatus" name="newStatus" value="Returned"><label for="newStatus">Returned to the owner</label></div>' +
            (isSupervisor
              ? '<div class="radio"><input type="radio" id="newStatus-disposed" name="newStatus" value="Disposed"><label for="newStatus-disposed">Disposed of or donated (unclaimed)</label></div>'
              : '<p class="hint">Only a supervisor can mark an item as disposed.</p>') +
          '</fieldset>' +
          '<div class="conditional" id="returned-section" hidden>' +
            '<div class="field" id="returnedTo-group"><label for="returnedTo">Name of the person who collected it</label>' +
              '<p class="error-message" id="returnedTo-error"></p>' +
              '<input type="text" id="returnedTo" maxlength="60" autocomplete="off" value="' + esc(r.owner) + '" aria-describedby="returnedTo-error"></div>' +
            '<div class="field" id="idChecked-group"><p class="error-message" id="idChecked-error"></p>' +
              '<div class="check"><input type="checkbox" id="idChecked" aria-describedby="idChecked-error"><label for="idChecked">I have checked their photo ID and they described the item correctly</label></div></div>' +
          '</div>' +
          '<div class="field" id="note-group"><label for="note">Note (optional)</label>' +
            '<textarea id="note" rows="2" maxlength="200"></textarea></div>' +
          '<button type="submit" class="button" id="update-submit">Update record</button>' +
        '</form>';
    } else {
      updateHtml =
        '<h2>Update status</h2>' +
        '<p>This record is closed (' + esc(r.status.toLowerCase()) + '). If this was a mistake, you can reopen it.</p>' +
        '<button type="button" class="button button--secondary" id="reopen">Reopen record</button>';
    }

    $('#record-content').innerHTML =
      (message ? '<div class="notice notice--success" id="record-message" tabindex="-1"><p>' + esc(message) + '</p></div>' : '') +
      '<h1 id="record-title" tabindex="-1">' + esc(r.title) + '</h1>' +
      '<p class="summary-line"><span>' + esc(r.ref) + '</span>' + statusBadge(r.status) + '</p>' +
      '<div class="two-col"><div>' +
        '<h2>Details</h2><dl class="details">' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
        '<h2>History</h2><ol class="history">' + r.history.map(h =>
          '<li><strong>' + esc(h.action) + '</strong><span class="meta"><time datetime="' + esc(h.at) + '">' + esc(niceTime(h.at)) + '</time> by ' + esc(h.by) + '</span></li>').join('') + '</ol>' +
      '</div><div>' + updateHtml + '</div></div>';

    wireRecordForm(r);
  }

  function wireRecordForm(r) {
    const form = $('#update-form');
    if (!form) {
      $('#reopen').addEventListener('click', async e => {
        const btn = e.currentTarget;
        if (btn.dataset.busy) return;
        setBusy(btn, true, 'Reopening…');
        announce('Reopening record');
        try {
          const updated = await api('/api/records/' + r.id, { method: 'PATCH', body: { status: 'Open', note: '' } });
          drawRecord(updated, r.ref + ' has been reopened.');
          $('#record-message').focus();
        } catch (err) {
          setBusy(btn, false);
          announce('Error: ' + err.message);
        }
      });
      return;
    }

    form.addEventListener('change', () => {
      const chosen = $('input[name="newStatus"]:checked', form);
      $('#returned-section').hidden = !(chosen && chosen.value === 'Returned');
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const button = $('#update-submit');
      if (button.dataset.busy) return;
      const summary = $('#update-errors');
      const chosen = $('input[name="newStatus"]:checked', form);
      const errors = [];
      if (!chosen) errors.push({ id: 'newStatus', message: 'Select what has happened to the item' });
      else if (chosen.value === 'Returned') {
        if (!$('#returnedTo').value.trim()) errors.push({ id: 'returnedTo', message: 'Enter the name of the person who collected it' });
        if (!$('#idChecked').checked) errors.push({ id: 'idChecked', message: 'Confirm that you checked their photo ID' });
      }
      if (errors.length) { showErrors(form, summary, errors); return; }
      clearErrors(form, summary);

      setBusy(button, true, 'Saving…');
      announce('Saving');
      try {
        const updated = await api('/api/records/' + r.id, {
          method: 'PATCH',
          body: { status: chosen.value, returnedTo: $('#returnedTo').value.trim(), idChecked: $('#idChecked').checked, note: $('#note').value.trim() }
        });
        const msg = chosen.value === 'Returned'
          ? r.ref + ' marked as returned to ' + updated.returnedTo + '.'
          : r.ref + ' marked as disposed.';
        drawRecord(updated, msg);
        $('#record-message').focus();
      } catch (err) {
        setBusy(button, false);
        summary.innerHTML = '<h2>The record was not updated</h2><p>' + esc(err.message) + '</p>';
        summary.hidden = false;
        summary.focus();
      }
    });
  }

  /* =========================================================
     Start
     ========================================================= */
  route();
})();
