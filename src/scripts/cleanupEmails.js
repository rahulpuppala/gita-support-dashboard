/**
 * Cleanup script: removes all SevaBot email artifacts from Gmail and local DB.
 * 
 * What it does:
 * 1. Deletes all Gmail drafts that were created by SevaBot
 * 2. Removes SevaBot/* labels from all Gmail messages
 * 3. Deletes the SevaBot/* labels themselves from Gmail
 * 4. Wipes the emails table in the local DB
 * 5. Removes gmail_last_sync from settings
 * 6. Removes email-sourced actions from the actions table
 * 
 * Usage: node src/scripts/cleanupEmails.js
 */

require('dotenv').config();
const { getDb, closeDb } = require('../config/database');
const { getGmailClient, isAuthorized } = require('../services/gmailAuth');
const { migrate } = require('../database/migrate');

async function cleanup() {
  migrate(); // ensure tables exist
  const db = getDb();

  // ─── 1. Delete Gmail drafts ───────────────────────────
  if (isAuthorized()) {
    const gmail = getGmailClient();

    console.log('Fetching Gmail drafts...');
    try {
      let allDrafts = [];
      let pageToken = null;
      do {
        const params = { userId: 'me', maxResults: 100 };
        if (pageToken) params.pageToken = pageToken;
        const res = await gmail.users.drafts.list(params);
        allDrafts.push(...(res.data.drafts || []));
        pageToken = res.data.nextPageToken;
      } while (pageToken);

      console.log(`Found ${allDrafts.length} drafts in Gmail`);

      // Only delete drafts that match our DB records
      const dbDraftIds = db.prepare("SELECT gmail_draft_id FROM emails WHERE gmail_draft_id IS NOT NULL").all().map(r => r.gmail_draft_id);
      const toDelete = allDrafts.filter(d => dbDraftIds.includes(d.id));
      console.log(`${toDelete.length} drafts were created by SevaBot — deleting...`);

      for (const d of toDelete) {
        try {
          await gmail.users.drafts.delete({ userId: 'me', id: d.id });
        } catch (err) {
          console.warn(`  Could not delete draft ${d.id}: ${err.message}`);
        }
      }
      console.log('Drafts cleaned up.');
    } catch (err) {
      console.error('Draft cleanup error:', err.message);
    }

    // ─── 2. Remove SevaBot labels from messages ──────────
    console.log('\nFetching SevaBot labels...');
    try {
      const labelsRes = await gmail.users.labels.list({ userId: 'me' });
      const sevaBotLabels = labelsRes.data.labels.filter(l => l.name.startsWith('SevaBot/'));
      console.log(`Found ${sevaBotLabels.length} SevaBot labels: ${sevaBotLabels.map(l => l.name).join(', ')}`);

      for (const label of sevaBotLabels) {
        // Find all messages with this label
        let msgIds = [];
        let pageToken = null;
        do {
          const params = { userId: 'me', labelIds: [label.id], maxResults: 100 };
          if (pageToken) params.pageToken = pageToken;
          const res = await gmail.users.messages.list(params);
          msgIds.push(...(res.data.messages || []).map(m => m.id));
          pageToken = res.data.nextPageToken;
        } while (pageToken);

        if (msgIds.length > 0) {
          console.log(`  Removing label "${label.name}" from ${msgIds.length} messages...`);
          // Batch remove in chunks of 50
          for (let i = 0; i < msgIds.length; i += 50) {
            const batch = msgIds.slice(i, i + 50);
            try {
              await gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: { ids: batch, removeLabelIds: [label.id] },
              });
            } catch (err) {
              console.warn(`  Batch remove failed: ${err.message}`);
            }
          }
        }

        // Delete the label itself
        try {
          await gmail.users.labels.delete({ userId: 'me', id: label.id });
          console.log(`  Deleted label "${label.name}"`);
        } catch (err) {
          console.warn(`  Could not delete label "${label.name}": ${err.message}`);
        }
      }
      console.log('Labels cleaned up.');
    } catch (err) {
      console.error('Label cleanup error:', err.message);
    }
  } else {
    console.log('Gmail not authorized — skipping Gmail cleanup (local DB will still be wiped)');
  }

  // ─── 3. Wipe local DB ─────────────────────────────────
  console.log('\nWiping emails table...');
  const emailCount = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
  db.prepare('DELETE FROM emails').run();
  console.log(`Deleted ${emailCount} email records.`);

  console.log('Removing gmail_last_sync...');
  db.prepare("DELETE FROM settings WHERE key = 'gmail_last_sync'").run();

  // ─── 4. Remove email-sourced actions ───────────────────
  console.log('Removing email-sourced actions...');
  const actionCount = db.prepare("DELETE FROM actions WHERE group_id = 'email'").run().changes;
  console.log(`Deleted ${actionCount} email-sourced actions.`);

  console.log('\nCleanup complete! You can now restart the app and run a controlled backfill.');
  closeDb();
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
