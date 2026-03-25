// background.js
let capturedRequests = [];

chrome.runtime.onInstalled.addListener(() => {
  console.log('CRM Helper Extension installed');
});

// Single message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'form_capture') {
    capturedRequests.push({
      data: message.data,
      url: sender.tab ? sender.tab.url : message.data?.pageUrl || '',
      time: new Date().toISOString()
    });
    sendResponse({ success: true });
    return true;
  }
  if (message.type === 'get_captured_requests') {
    sendResponse({ requests: capturedRequests });
    return true;
  }
  sendResponse({ success: false, error: 'Unknown message type' });
  return true;
});
