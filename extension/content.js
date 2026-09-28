(() => {
  'use strict';

  const KEY = 'alireturnStateV7';
  const S = Object.freeze({
    card: '[class*=orderItem--orderItem--]',
    orderId: '[class*=orderItem--orderSKUId--]',
    store: '[class*=orderItem--orderStore--]',
    product: '[class*=orderItem--orderSKUTitle--]',
    status: '[class*=orderItem--orderStatusDesc--]',
    actions: '[class*=orderItem--orderStatusAction--]',
    amount: '[class*=newReverseRefundInfo--amount--]',
    current: '.next-pagination-item.next-current',
    previous: '.next-pagination-item.next-prev',
    next: '.next-pagination-item.next-next'
  });
  const DATE_RE = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])/;
  const ID_RE = /\b\d{12,22}\b/;
  const DETAIL_AMOUNT_WAIT_MS = 5000;
  const EMPTY = {
    running: false, status: 'idle', message: 'Ready', from: '', to: '',
    targetPage: 1, currentItem: null, processed: [], results: [], warnings: [],
    inspected: 0, page: 1
  };

  let state = {...EMPTY};
  let busy = false;
  let timer = 0;

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    state = {...EMPTY, ...(stored[KEY] || {})};
    return state;
  }

  async function save(patch) {
    state = {...state, ...patch};
    await chrome.storage.local.set({[KEY]: state});
  }

  function schedule(delay = 500) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  async function start(from, to) {
    if (!document.querySelector(S.card)) {
      throw new Error('Open the AliExpress Returns & refunds list and reload the page first.');
    }
    await save({
      ...EMPTY, running: true, status: 'working', from, to,
      message: 'Starting from returns page 1...'
    });
    schedule(20);
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type !== 'START') return false;
    start(message.from, message.to)
      .then(() => respond({ok: true}))
      .catch(error => respond({ok: false, error: error.message}));
    return true;
  });

  async function run() {
    timer = 0;
    if (busy) return;
    await load();
    if (!state.running) return;
    busy = true;
    try {
      if (document.querySelector(S.card)) {
        await processList();
      } else if (state.currentItem) {
        await processDetail();
      } else {
        await save({message: 'Waiting for AliExpress to load...'});
        schedule(900);
      }
    } catch (error) {
      console.error('[AliReturn]', error);
      await save({running: false, status: 'error', message: error.message});
    } finally {
      busy = false;
    }
  }

  async function processList() {
    const cards = [...document.querySelectorAll(S.card)].filter(visible);
    if (!cards.length) {
      await save({message: 'Waiting for return records...'});
      schedule(800); return;
    }

    if (state.currentItem) {
      if (Date.now() - state.currentItem.openedAt < 30000) {
        schedule(700); return;
      }
      const item = cards.map(readCard).find(candidate => candidate?.key === state.currentItem.key);
      const button = item && detailButton(item.element);
      if (!button) throw new Error(`Could not click the detail button for order ${state.currentItem.orderId}.`);
      await save({currentItem:{...state.currentItem,openedAt:Date.now()},message:'Retrying the detail button...'});
      await trustedClick(button); schedule(1200); return;
    }

    const page = pageNumber();
    if (page !== state.targetPage) {
      if (state.actionFromPage === page && Date.now() - (state.actionAt || 0) < 4000) {
        schedule(500); return;
      }
      const control = document.querySelector(page > state.targetPage ? S.previous : S.next);
      if (!enabled(control)) throw new Error('AliReturn could not navigate to the required returns page.');
      await save({page, actionFromPage: page, actionAt: Date.now(),
        message: `Opening returns page ${state.targetPage}...`});
      click(control); schedule(900); return;
    }

    const items = cards.map(readCard).filter(Boolean);
    const nextItem = items.find(item => !state.processed.includes(item.key));
    if (nextItem) {
      const processed = [...new Set([...state.processed, nextItem.key])];
      if (nextItem.date < state.from || nextItem.date > state.to) {
        await save({processed, inspected: state.inspected + 1, page});
        schedule(20); return;
      }
      const button = detailButton(nextItem.element);
      if (!button) throw new Error(`Could not find the detail button for order ${nextItem.orderId}.`);
      const listTabId = await getTabId();
      const currentItem = {key:nextItem.key,date:nextItem.date,orderId:nextItem.orderId,
        product:nextItem.product,store:nextItem.store,openedAt:Date.now(),listTabId};
      await save({currentItem,page,message:`Clicking the detail button for order ${nextItem.orderId}...`});
      await trustedClick(button); schedule(1200); return;
    }

    const next = document.querySelector(S.next);
    if (!enabled(next)) {
      await finish('Complete: reached the last returns page.'); return;
    }
    await save({targetPage: page + 1, actionFromPage: page, actionAt: Date.now(),
      message: `Opening returns page ${page + 1}...`});
    click(next); schedule(900);
  }

  function readCard(element) {
    const dateMatch = (element.querySelector(S.status)?.innerText || element.innerText || '').match(DATE_RE);
    const idMatch = (element.querySelector(S.orderId)?.innerText || element.innerText || '').match(ID_RE);
    if (!dateMatch || !idMatch) return null;
    const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    const product = clean(element.querySelector(S.product)?.textContent);
    return {
      key: `${idMatch[0]}:${date}:${product}`, date, orderId: idMatch[0], product,
      store: clean(element.querySelector(S.store)?.textContent), element
    };
  }

  function detailButton(card) {
    const actionGroup = card.querySelector(S.actions);
    if (!actionGroup) return null;
    // Confirmed HTML structure: first action wrapper is Details; second is seller contact.
    // The localized caption is intentionally never inspected.
    return actionGroup.querySelector(':scope > div:first-child button');
  }

  async function processDetail() {
    const item = state.currentItem;
    if (!item) return;
    if (item.date < state.from || item.date > state.to) {
      await save({currentItem:null,processed:[...new Set([...state.processed,item.key])],
        inspected:state.inspected + 1,message:`Skipped out-of-range return ${item.orderId}; going back...`});
      await leaveDetail(item); return;
    }
    const bodyText = document.body?.innerText || '';
    const orderMatches = bodyText.includes(item.orderId);
    const amountElement = [...document.querySelectorAll(S.amount)].find(visible);
    const money = amountElement && orderMatches && parseMoney(amountElement.innerText || amountElement.textContent);
    if (!money) {
      if (Date.now() - item.openedAt < DETAIL_AMOUNT_WAIT_MS) {
        await save({message:`Waiting for the matching detail page for order ${item.orderId}...`});
        schedule(700); return;
      }
      await load();
      const results = withoutCurrentResult(state.results, item);
      results.push(resultRow(item, {
        refundedAmount: '',
        currency: '',
        collectionStatus: 'Missing amount',
        note: 'No refund amount was found on the detail page after 5 seconds.'
      }));
      await save({results,currentItem:null,
        processed:[...new Set([...state.processed,item.key])],inspected:state.inspected + 1,
        message:`No amount found for order ${item.orderId}; recorded it and continuing...`});
      await leaveDetail(item);
      return;
    }

    await load();
    const results = withoutCurrentResult(state.results, item);
    results.push(resultRow(item, {
      refundedAmount: money.amount,
      currency: money.currency,
      collectionStatus: 'Collected',
      note: ''
    }));
    await save({results,currentItem:null,
      processed:[...new Set([...state.processed,item.key])],inspected:state.inspected + 1,
      message:`Collected ${money.amount} ${money.currency} for order ${item.orderId}; going back...`});
    await leaveDetail(item);
  }

  function withoutCurrentResult(results, item) {
    return results.filter(row => row.orderId !== item.orderId ||
      row.listDate !== item.date || row.product !== item.product);
  }

  function resultRow(item, values) {
    return {
      listDate:item.date,
      refundedAmount:values.refundedAmount,
      currency:values.currency,
      orderId:item.orderId,
      store:item.store,
      product:item.product,
      collectionStatus:values.collectionStatus,
      note:values.note,
      detailUrl:location.href,
      collectedAt:new Date().toISOString()
    };
  }

  function parseMoney(text) {
    const raw = clean(text).replace(/\u00a0/g, ' ');
    const currencyMatch = raw.match(/EUR|USD|GBP|AUD|CAD|CHF|JPY|CNY|RMB|PLN|TRY|BRL|MXN|INR|AED|SAR|SEK|NOK|DKK|CZK|HUF|RON|RUB|KRW|\u20ac|\$|\u00a3|\u00a5|\u20ba|\u20b9|\u20bd|\u20a9/i);
    const numberMatch = raw.match(/(?:^|[^\d])((?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?)(?!\d)/);
    if (!currencyMatch || !numberMatch) return null;
    let number = numberMatch[1].replace(/\s/g, '');
    const decimal = Math.max(number.lastIndexOf(','), number.lastIndexOf('.'));
    if (decimal >= 0 && number.length - decimal <= 3) {
      number = number.slice(0, decimal).replace(/[.,]/g, '') + '.' + number.slice(decimal + 1);
    } else number = number.replace(/[.,]/g, '');
    const numeric = Number(number);
    if (!Number.isFinite(numeric)) return null;
    const symbols = {'\u20ac':'EUR', '$':'USD', '\u00a3':'GBP', '\u00a5':'JPY',
      '\u20ba':'TRY', '\u20b9':'INR', '\u20bd':'RUB', '\u20a9':'KRW'};
    const token = currencyMatch[0];
    return {amount: numeric.toFixed(2), currency: symbols[token] || token.toUpperCase()};
  }

  function pageNumber() {
    const match = (document.querySelector(S.current)?.textContent || '').match(/\d+/);
    return match ? Number(match[0]) : 1;
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function enabled(element) {
    return visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  }

  function click(element) {
    element.scrollIntoView({block: 'center'});
    element.click();
  }

  async function getTabId() {
    const response = await chrome.runtime.sendMessage({type: 'GET_TAB_ID'});
    if (!response?.ok || !Number.isInteger(response.tabId)) {
      throw new Error('AliReturn could not identify the current Chrome tab.');
    }
    return response.tabId;
  }

  async function leaveDetail(item) {
    const tabId = await getTabId();
    if (item.listTabId && tabId !== item.listTabId) {
      const response = await chrome.runtime.sendMessage({
        type: 'RETURN_TO_LIST', listTabId: item.listTabId
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not return to the returns list.');
      return;
    }
    history.back();
    schedule(1200);
  }

  async function trustedClick(element) {
    element.scrollIntoView({block: 'center', inline: 'center'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = element.getBoundingClientRect();
    if (!visible(element)) throw new Error('The detail button is not visible after scrolling to it.');
    const response = await chrome.runtime.sendMessage({
      type: 'TRUSTED_CLICK',
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
    if (!response?.ok) throw new Error(response?.error || 'Chrome could not click the detail button.');
  }

  async function finish(message) {
    await save({running: false, status: 'complete', currentItem: null, message});
  }

  load().then(() => state.running && schedule(300));
  chrome.storage.onChanged.addListener(changes => {
    if (changes[KEY]?.newValue) {
      state = {...EMPTY, ...changes[KEY].newValue};
      if (state.running && !busy && !timer) schedule(100);
    }
  });
  new MutationObserver(() => {
    if (state.running && !busy && !timer) schedule(300);
  }).observe(document.documentElement, {childList: true, subtree: true});
})();
