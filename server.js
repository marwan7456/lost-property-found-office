/*
 * Campus Lost Property Office - backend
 * A small Node.js server with no npm dependencies.
 * - Serves the front end from /public
 * - Stores records in data/records.json (read and written on every request)
 * - Exposes a JSON API under /api
 *
 * Sign-in is simulated (as the brief allows). The front end sends the signed-in
 * staff name and role in the X-Staff-Name and X-Staff-Role headers so the server
 * can record who changed what and stop desk assistants disposing of items.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');

const CATEGORIES = ['Phones and electronics', 'Bags', 'Keys', 'Cards and ID', 'Clothing', 'Books and stationery', 'Jewellery and watches', 'Other'];
const STATUSES = ['Open', 'Returned', 'Disposed'];
const ROLES = ['Desk assistant', 'Supervisor'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* ---------- Dates ---------- */
function isoDay(d) {
  // Local calendar date as YYYY-MM-DD (not UTC, so it is right near midnight)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

/* ---------- Seed data (only used the very first time) ---------- */
function buildSeed() {
  const rows = [
    ['found', 'Black umbrella', 'Other', 'Library', 2, 'Open', { other: 'Umbrella', shelf: 'A1' }],
    ['found', 'Samsung Galaxy phone, blue case', 'Phones and electronics', 'Main hall', 1, 'Open', { shelf: 'Safe', flags: ['Valuable'] }],
    ['lost', 'Silver house keys on red lanyard', 'Keys', 'Sports centre', 3, 'Open', { owner: 'Amira Hassan', contact: 'amira.h@example.ac.uk' }],
    ['found', 'Student ID card', 'Cards and ID', 'Cafeteria', 5, 'Returned', { shelf: 'Safe', flags: ['Contains ID or bank cards'] }],
    ['found', 'Grey wool scarf', 'Clothing', 'Lecture theatre 2', 6, 'Open', { shelf: 'B2' }],
    ['found', 'Blue water bottle', 'Other', 'Sports centre', 8, 'Open', { other: 'Drink bottle', shelf: 'A2' }],
    ['lost', 'Black leather wallet', 'Cards and ID', 'Car park', 2, 'Open', { owner: 'Tom Reid', contact: '07700 900123', flags: ['Contains ID or bank cards'] }],
    ['found', 'Casio calculator', 'Phones and electronics', 'Exam hall', 9, 'Returned', { shelf: 'B1' }],
    ['found', 'Brown backpack with laptop charger', 'Bags', 'Library', 12, 'Open', { shelf: 'C1' }],
    ['found', 'Gold ring', 'Jewellery and watches', 'Gym changing room', 4, 'Open', { shelf: 'Safe', flags: ['Valuable'] }],
    ['lost', 'AirPods in white case', 'Phones and electronics', 'Library', 1, 'Open', { owner: 'Lina Farouk', contact: 'lina.f@example.ac.uk', flags: ['Valuable'] }],
    ['found', 'Maths textbook (Calculus, 8th ed.)', 'Books and stationery', 'Lecture theatre 1', 15, 'Open', { shelf: 'B3' }],
    ['found', 'Navy hoodie, size M', 'Clothing', 'Student union', 20, 'Open', { shelf: 'B2' }],
    ['found', 'Single car key (Toyota)', 'Keys', 'Car park', 7, 'Returned', { shelf: 'A3' }],
    ['lost', 'Purple pencil case', 'Books and stationery', 'Lecture theatre 2', 10, 'Open', { owner: 'Sam Okafor', contact: 's.okafor@example.ac.uk' }],
    ['found', 'Reading glasses in black case', 'Other', 'Cafeteria', 35, 'Open', { other: 'Glasses', shelf: 'A1' }],
    ['found', 'Wireless mouse', 'Phones and electronics', 'Computer lab', 40, 'Open', { shelf: 'C2' }],
    ['found', 'Tote bag with notebooks', 'Bags', 'Bus stop', 45, 'Disposed', { shelf: 'C1' }],
    ['found', 'Wristwatch, leather strap', 'Jewellery and watches', 'Gym changing room', 11, 'Open', { shelf: 'Safe', flags: ['Valuable'] }],
    ['lost', 'Green umbrella', 'Other', 'Main hall', 4, 'Returned', { other: 'Umbrella', owner: 'Dana Lee', contact: '07700 900456' }],
    ['found', 'Bank card (name visible)', 'Cards and ID', 'Library', 0, 'Open', { shelf: 'Safe', flags: ['Contains ID or bank cards'] }],
    ['found', 'USB memory stick, 32 GB', 'Phones and electronics', 'Computer lab', 13, 'Open', { shelf: 'C2' }],
    ['found', 'Denim jacket', 'Clothing', 'Student union', 33, 'Open', { shelf: 'B2' }],
    ['lost', 'Laptop sleeve, grey', 'Bags', 'Library', 6, 'Open', { owner: 'Omar Said', contact: 'omar.s@example.ac.uk' }],
    ['found', 'Bicycle lock key', 'Keys', 'Bike shelter', 18, 'Open', { shelf: 'A3' }]
  ];

  // Extra everyday items so the Records table can be tested with a realistic number of rows
  // (about 175 in total), which shows that search, sorting and paging still work when the list is long.
  // Built from fixed lists rather than random numbers, so every fresh install gets the same data.
  const extras = [
    ['Black umbrella', 'Other', 'Umbrella', 'A1'], ['Phone charger cable', 'Phones and electronics', '', 'C2'],
    ['Red scarf', 'Clothing', '', 'B2'], ['Reusable coffee cup', 'Other', 'Cup', 'A2'],
    ['Lecture notes in a blue folder', 'Books and stationery', '', 'B3'], ['Earphones, wired', 'Phones and electronics', '', 'C2'],
    ['Black gloves', 'Clothing', '', 'B2'], ['Small grey backpack', 'Bags', '', 'C1'],
    ['Library card', 'Cards and ID', '', 'Safe'], ['Set of two keys on a ring', 'Keys', '', 'A3'],
    ['Silver bracelet', 'Jewellery and watches', '', 'Safe'], ['Lunch box', 'Other', 'Food container', 'A2']
  ];
  const places = ['Library', 'Main hall', 'Cafeteria', 'Lecture theatre 1', 'Lecture theatre 2', 'Computer lab',
    'Exam hall', 'Sports centre', 'Gym changing room', 'Student union', 'Car park', 'Bus stop'];
  for (let n = 0; n < 150; n++) {
    const [title, category, other, shelf] = extras[n % extras.length];
    const ago = 2 + ((n * 7) % 90);                      // spread over the last three months
    const status = ago > 60 ? (n % 3 ? 'Disposed' : 'Open') : (n % 4 === 0 ? 'Returned' : 'Open');
    rows.push(['found', title, category, places[(n * 5) % places.length], ago, status,
      { other, shelf, flags: category === 'Cards and ID' ? ['Contains ID or bank cards'] : shelf === 'Safe' ? ['Valuable'] : [] }]);
  }

  return rows.map((r, i) => {
    const [kind, title, category, location, ago, status, extra] = r;
    const date = daysAgo(ago);
    return {
      id: i + 1,
      ref: 'LF-' + String(i + 1).padStart(4, '0'),
      kind, title, category,
      otherCategory: extra.other || '',
      location, date,
      shelf: kind === 'found' ? extra.shelf || '' : '',
      owner: extra.owner || '',
      contact: extra.contact || '',
      flags: extra.flags || [],
      notes: '',
      status,
      returnedTo: status === 'Returned' ? 'Owner (ID checked)' : '',
      history: [{ at: date + 'T10:00:00', by: 'Seed data', action: 'Record created' }]
        .concat(status !== 'Open' ? [{ at: date + 'T15:00:00', by: 'Seed data', action: 'Marked as ' + status.toLowerCase() }] : [])
    };
  });
}

/* ---------- Storage ---------- */
function readRecords() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeRecords(buildSeed());
  }
  // If the file is damaged this throws and the request gets a 500,
  // rather than silently replacing real records with sample data.
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeRecords(records) {
  // Write to a temp file then rename, so a crash mid-write cannot corrupt the data
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- HTTP helpers ---------- */
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100000) { resolve(null); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
  });
}
const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
function staffFrom(req) {
  const name = text(req.headers['x-staff-name'], 40) || 'Unknown';
  const role = ROLES.includes(req.headers['x-staff-role']) ? req.headers['x-staff-role'] : 'Desk assistant';
  return { name, role };
}

/* ---------- Validation (mirrors the checks in the front end) ---------- */
function validateNewRecord(b) {
  const errors = {};
  if (!b || typeof b !== 'object') return { _: 'Request body must be JSON' };
  if (!['found', 'lost'].includes(b.kind)) errors.kind = 'Choose found item or lost enquiry';
  if (!text(b.title, 80)) errors.title = 'Enter a short description of the item';
  if (!CATEGORIES.includes(b.category)) errors.category = 'Choose a category';
  if (b.category === 'Other' && !text(b.otherCategory, 40)) errors.otherCategory = 'Say what kind of item it is';
  if (!text(b.location, 80)) errors.location = 'Enter where the item was found or lost';
  const date = text(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) errors.date = 'Enter a real date';
  else if (date > isoDay(new Date())) errors.date = 'The date cannot be in the future';
  if (b.kind === 'found' && !text(b.shelf, 10)) errors.shelf = 'Choose where the item is stored';
  if (b.kind === 'lost') {
    if (!text(b.owner, 60)) errors.owner = 'Enter the owner\'s name';
    if (!text(b.contact, 80)) errors.contact = 'Enter an email address or phone number';
  }
  return errors;
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const staff = staffFrom(req);

  if (url === '/api/records' && req.method === 'GET') {
    return sendJson(res, 200, readRecords());
  }

  if (url === '/api/records' && req.method === 'POST') {
    const b = await readBody(req);
    const errors = validateNewRecord(b);
    if (Object.keys(errors).length) return sendJson(res, 400, { error: 'Some details are missing or wrong', fields: errors });
    const records = readRecords();
    const id = records.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    const record = {
      id,
      ref: 'LF-' + String(id).padStart(4, '0'),
      kind: b.kind,
      title: text(b.title, 80),
      category: b.category,
      otherCategory: b.category === 'Other' ? text(b.otherCategory, 40) : '',
      location: text(b.location, 80),
      date: text(b.date, 10),
      shelf: b.kind === 'found' ? text(b.shelf, 10) : '',
      owner: b.kind === 'lost' ? text(b.owner, 60) : '',
      contact: b.kind === 'lost' ? text(b.contact, 80) : '',
      flags: Array.isArray(b.flags) ? b.flags.map(f => text(f, 40)).filter(Boolean).slice(0, 4) : [],
      notes: text(b.notes, 300),
      status: 'Open',
      returnedTo: '',
      history: [{ at: new Date().toISOString(), by: staff.name + ' (' + staff.role + ')', action: 'Record created' }]
    };
    records.push(record);
    writeRecords(records);
    return sendJson(res, 201, record);
  }

  const match = url.match(/^\/api\/records\/(\d+)$/);
  if (match) {
    const records = readRecords();
    const record = records.find(r => r.id === Number(match[1]));
    if (!record) return sendJson(res, 404, { error: 'No record with that number' });
    if (req.method === 'GET') return sendJson(res, 200, record);

    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (!b || !STATUSES.includes(b.status)) return sendJson(res, 400, { error: 'Choose a valid status' });
      if (b.status === 'Disposed' && staff.role !== 'Supervisor') {
        return sendJson(res, 403, { error: 'Only a supervisor can mark an item as disposed' });
      }
      if (b.status === 'Returned' && (!text(b.returnedTo, 60) || b.idChecked !== true)) {
        return sendJson(res, 400, { error: 'Enter who collected the item and confirm their ID was checked' });
      }
      record.status = b.status;
      record.returnedTo = b.status === 'Returned' ? text(b.returnedTo, 60) : '';
      let action = b.status === 'Open' ? 'Reopened' : 'Marked as ' + b.status.toLowerCase();
      if (b.status === 'Returned') action += ' to ' + record.returnedTo + ' (ID checked)';
      const note = text(b.note, 200);
      if (note) action += '. Note: ' + note;
      record.history.push({ at: new Date().toISOString(), by: staff.name + ' (' + staff.role + ')', action });
      writeRecords(records);
      return sendJson(res, 200, record);
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* ---------- Static files ---------- */
function serveStatic(res, url) {
  const file = path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  try {
    if (url.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, url);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'The server could not complete the request' });
  }
}).listen(PORT, () => console.log('Lost Property Office running at http://localhost:' + PORT));
