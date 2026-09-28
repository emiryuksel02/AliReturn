'use strict';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'GET_TAB_ID') {
    respond({ok: true, tabId: sender.tab?.id});
    return false;
  }

  if (message?.type === 'RETURN_TO_LIST') {
    returnToList(sender.tab?.id, message.listTabId, respond);
    return true;
  }

  if (message?.type !== 'TRUSTED_CLICK') return false;

  const tabId = sender.tab?.id;
  if (!tabId || !Number.isFinite(message.x) || !Number.isFinite(message.y)) {
    respond({ok: false, error: 'AliReturn could not locate the detail button.'});
    return false;
  }

  dispatchTrustedClick(tabId, message.x, message.y)
    .then(() => respond({ok: true}))
    .catch(error => respond({ok: false, error: error.message}));
  return true;
});

async function returnToList(detailTabId, listTabId, respond) {
  try {
    if (!detailTabId || !listTabId || detailTabId === listTabId) {
      respond({ok: true, sameTab: true});
      return;
    }
    await chrome.tabs.update(listTabId, {active: true});
    respond({ok: true, sameTab: false});
    chrome.tabs.remove(detailTabId).catch(() => {});
  } catch (error) {
    respond({ok: false, error: error.message});
  }
}

async function dispatchTrustedClick(tabId, x, y) {
  const target = {tabId};
  await chrome.debugger.attach(target, '1.3');
  try {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await new Promise(resolve => setTimeout(resolve, 60));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) { /* already detached */ }
  }
}
