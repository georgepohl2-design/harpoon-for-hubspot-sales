// Runs only on Harpoon's own "open" page (linked from the Slack notification).
// If Harpoon is installed, it opens your board and closes the link tab.
chrome.runtime.sendMessage({ type: 'open-board' });
