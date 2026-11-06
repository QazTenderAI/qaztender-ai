import { mkdir, writeFile } from 'node:fs/promises';

const API_ORIGIN = 'https://ows.goszakup.gov.kz';
const SOURCE_PAGE = 'https://goszakup.gov.kz/ru/search/announce';
const OUTPUT = new URL('../data/tenders.json', import.meta.url);
const token = process.env.GOSZAKUP_API_TOKEN?.trim();

if (!token) {
  console.error('GOSZAKUP_API_TOKEN is not configured. Nothing was downloaded.');
  process.exit(1);
}

async function fetchJson(pathOrUrl) {
  const url = new URL(pathOrUrl, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error('The API returned an unsafe pagination URL.');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Official API request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchPages(firstPath, maxPages = 4) {
  const records = [];
  let next = firstPath;
  for (let page = 0; next && page < maxPages; page += 1) {
    const body = await fetchJson(next);
    if (!Array.isArray(body.items)) throw new Error('Unexpected response from the official API.');
    records.push(...body.items);
    next = body.next_page || '';
  }
  return records;
}

function refsMap(items) {
  return new Map(items.map(item => [String(item.id), {
    ru: String(item.name_ru || ''),
    kk: String(item.name_kz || item.name_ru || '')
  }]));
}

const [announcements, methodsBody, statusesBody] = await Promise.all([
  fetchPages('/trd-buy/all', 4),
  fetchJson('/refs/ref_trade_methods'),
  fetchJson('/refs/ref_buy_status')
]);

const methods = refsMap(Array.isArray(methodsBody.items) ? methodsBody.items : []);
const statuses = refsMap(Array.isArray(statusesBody.items) ? statusesBody.items : []);
const clean = value => value == null ? null : String(value).trim();

const items = announcements.map(raw => {
  const method = methods.get(String(raw.ref_trade_methods_id)) || {};
  const status = statuses.get(String(raw.ref_buy_status_id)) || {};
  return {
    id: clean(raw.id),
    number: clean(raw.number_anno) || '',
    nameRu: clean(raw.name_ru) || '',
    nameKk: clean(raw.name_kz) || clean(raw.name_ru) || '',
    amount: Number(raw.total_sum) || 0,
    publishDate: clean(raw.publish_date),
    startDate: clean(raw.start_date),
    endDate: clean(raw.end_date),
    organizerBin: clean(raw.org_bin) || '',
    methodId: raw.ref_trade_methods_id ?? null,
    methodRu: method.ru || '',
    methodKk: method.kk || method.ru || '',
    statusId: raw.ref_buy_status_id ?? null,
    statusRu: status.ru || '',
    statusKk: status.kk || status.ru || ''
  };
}).filter(item => item.id && (item.nameRu || item.nameKk))
  .sort((a, b) => String(b.publishDate || '').localeCompare(String(a.publishDate || '')))
  .slice(0, 200);

const output = {
  source: API_ORIGIN,
  sourcePage: SOURCE_PAGE,
  updatedAt: new Date().toISOString(),
  status: 'live',
  items
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Saved ${items.length} official announcements to data/tenders.json.`);
