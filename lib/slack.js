// Sends a message to the team's Slack channel through an incoming webhook link.
// The link is kept in chrome.storage on this computer only.

export async function sendSlack(webhook, text) {
  if (!/^https:\/\/hooks\.slack\.com\//.test(webhook || '')) {
    throw new Error('That doesn\'t look like a Slack webhook link. It should start with https://hooks.slack.com/');
  }
  let res;
  try {
    res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch {
    throw new Error("Couldn't reach Slack. Check your internet connection and try again.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 || /no_service|channel_not_found|invalid_token/.test(body)) throw new Error('Slack says this webhook link no longer works. Make a new one and paste it in Settings.');
    throw new Error(`Slack said no (error ${res.status}${body ? ': ' + body : ''}).`);
  }
  return true;
}
