# Harpoon privacy

Short version: Harpoon keeps everything on your computer, only **reads** from HubSpot, and only sends data to the Slack channel you choose.

## What Harpoon stores, and where

Everything is kept in your own Chrome (`chrome.storage`), on your own computer:

- your HubSpot private app access token
- your Slack webhook link
- your list of target accounts (company names and HubSpot IDs)
- a copy of the latest data it read from HubSpot, so the board opens quickly
- your settings (schedule, hot and cold rules, Slack member IDs, look)

There's no Harpoon server and no Harpoon account. Nothing is sent to the maker of Harpoon.

## Who Harpoon talks to

| Where | Why |
|---|---|
| `api.hubapi.com` (HubSpot) | Reads your target companies, their owners, deals, and the emails, calls and meetings logged on them. Read-only: it never creates, changes or deletes anything. It counts emails but never reads what they say. |
| `hooks.slack.com` (Slack) | Posts the notification to the one channel your webhook link belongs to, only when you press Share to Slack or on the schedule you set. |
| `fonts.googleapis.com` / `fonts.gstatic.com` (Google Fonts) | Loads the two typefaces the board uses (Fredoka and Inter). |
| `georgepohl2-design.github.io` | Only when someone clicks "Open the target account list in Harpoon" in Slack. That page just opens your board. |

## No tracking

No analytics, no ads, no cookies, no selling or sharing of data.

## Removing your data

- In Harpoon, open **Settings → Disconnect** to delete the HubSpot token and the saved HubSpot data.
- Removing the extension from `chrome://extensions` deletes everything Harpoon stored.
- To cut Harpoon off from HubSpot or Slack at the source, delete the private app in HubSpot or the webhook in Slack.
