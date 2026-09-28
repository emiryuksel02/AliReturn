const KEY = 'alireturnStateV7';
const RETURN_URL = 'https://m.aliexpress.com/p/refund-dispute/list.html?spm=a2g0o.order_list';
const EMPTY = {running:false,status:'idle',message:'Ready',from:'',to:'',
  results:[],processed:[],warnings:[],inspected:0,page:1};
const ids = ['from','to','start','stop','open','message','stats','totals','csv','json','reset','error','statusDot'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let state = {...EMPTY};

function iso(value) { return value.toISOString().slice(0, 10); }
function error(message = '') { ui.error.textContent = message; ui.error.classList.toggle('hidden', !message); }

async function load() {
  const stored = await chrome.storage.local.get(KEY);
  state = {...EMPTY, ...(stored[KEY] || {})};
  render();
}

function render() {
  if (!ui.from.value) {
    const today = new Date(); const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);
    ui.from.value = state.from || iso(monthAgo); ui.to.value = state.to || iso(today);
  }
  const visibleResults = state.results.filter(row => !state.from || !state.to ||
    (row.listDate >= state.from && row.listDate <= state.to));
  ui.message.textContent = state.message;
  const missing = visibleResults.filter(row => !row.refundedAmount).length;
  const collected = visibleResults.length - missing;
  ui.stats.textContent = `${collected} amounts - ${missing} missing - ${state.inspected} inspected - page ${state.page}`;
  const totals = {};
  for (const row of visibleResults) {
    if (row.currency && row.refundedAmount !== '') {
      totals[row.currency] = (totals[row.currency] || 0) + Number(row.refundedAmount);
    }
  }
  const entries = Object.entries(totals);
  ui.totals.textContent = entries.length ? entries.map(([currency,value]) => `${value.toFixed(2)} ${currency}`).join(' + ') : 'No refunds collected yet';
  ui.start.disabled = state.running; ui.stop.disabled = !state.running;
  ui.csv.disabled = !visibleResults.length; ui.json.disabled = !visibleResults.length;
  ui.statusDot.className = state.status;
  if (state.status === 'error') error(state.message);
}

ui.start.onclick = async () => {
  error();
  const from = ui.from.value; const to = ui.to.value;
  if (!from || !to || from > to) { error('Choose a valid inclusive date range.'); return; }
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.url?.includes('aliexpress.com/p/refund-dispute/')) {
      throw new Error('Open the AliExpress Returns & refunds tab first.');
    }
    const response = await chrome.tabs.sendMessage(tab.id, {type:'START',from,to});
    if (!response?.ok) throw new Error(response?.error || 'AliReturn could not start.');
    await load();
    setTimeout(() => window.close(), 100);
  } catch (failure) {
    const hint = failure.message.includes('Receiving end') ? 'Reload the AliExpress page once, then try again.' : failure.message;
    error(hint);
  }
};

ui.stop.onclick = async () => {
  await chrome.storage.local.set({[KEY]: {...state,running:false,status:'paused',message:'Stopped. Partial results can be exported.'}});
};

ui.reset.onclick = async () => {
  await chrome.storage.local.remove(KEY); state = {...EMPTY}; ui.from.value = ''; ui.to.value = ''; error(); render();
};

ui.open.onclick = async () => {
  const tabs = await chrome.tabs.query({url:'https://*.aliexpress.com/*'});
  const existing = tabs.find(tab => tab.url?.includes('/refund-dispute/'));
  if (existing) await chrome.tabs.update(existing.id, {active:true});
  else await chrome.tabs.create({url:RETURN_URL});
};

function csvCell(value) { const quote = String.fromCharCode(34); return quote + String(value ?? '').split(quote).join(quote + quote) + quote; }
function download(format) {
  const selectedResults = state.results.filter(row => row.listDate >= state.from && row.listDate <= state.to);
  const columns = ['listDate','refundedAmount','currency','orderId','store','product',
    'collectionStatus','note','detailUrl','collectedAt'];
  const headings = ['Date','Refunded amount','Currency','Order ID','Store','Product',
    'Result','Note','Detail URL','Collected at'];
  const excelRows = selectedResults.map(row => columns.map((key,index) =>
    index === 1 ? String(row[key] ?? '').replace('.', ',') : csvCell(row[key] ?? '')));
  const body = format === 'json' ? JSON.stringify(selectedResults,null,2) :
    String.fromCharCode(0xFEFF) + ['sep=;',headings.map(csvCell).join(';'),
      ...excelRows.map(row => row.join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], {type:format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'}));
  chrome.downloads.download({url,filename:`alireturn-${state.from}-${state.to}.${format}`,saveAs:true}, () => setTimeout(() => URL.revokeObjectURL(url), 1000));
}
ui.csv.onclick = () => download('csv'); ui.json.onclick = () => download('json');

chrome.storage.onChanged.addListener(changes => {
  if (changes[KEY]) { state = {...EMPTY,...changes[KEY].newValue}; render(); }
});
load();
