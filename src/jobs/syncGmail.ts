import { prisma } from "../lib/prisma";
import {
  listNewEmailMessages,
  getEmailContent,
} from "../services/gmailService";
import { processAndSaveEmail } from "./processEmail";

/**
 * Main function to synchronize emails from Gmail.
 * It fetches new email messages since the last sync (using history ID),
 * processes each email (saving metadata and handling attachments),
 * and updates the last processed history ID.
 */
export async function runEmailSync(): Promise<void> {
  console.log(
    `🚀 [${new Date().toISOString()}] Starting email synchronization cycle...`
  );

  let tokenRecord;
  try {
    // Assuming a single token record with id: 1 for this application's scope
    tokenRecord = await prisma.oAuthToken.findUnique({ where: { id: 1 } });
  } catch (dbError) {
    console.error(
      `❌ [${new Date().toISOString()}] Critical error fetching OAuth token from DB:`,
      dbError
    );
    return; // Cannot proceed without token
  }

  if (!tokenRecord) {
    console.error(
      `❌ [${new Date().toISOString()}] No OAuth token found in DB. Please complete the authentication flow.`
    );
    return;
  }
  if (!tokenRecord.refresh) {
    // This check is important because getAuthenticatedClient in services will fail without a refresh token.
    console.error(
      `❌ [${new Date().toISOString()}] OAuth token record found, but refresh token is missing. Re-authentication required.`
    );
    return;
  }

  const currentHistoryId = tokenRecord.lastHistoryId;
  console.log(
    `🔄 [${new Date().toISOString()}] Current last processed Gmail History ID: ${
      currentHistoryId || "None (first sync or reset)"
    }.`
  );

  try {
    const { messages: messageHeaders, historyId: newHistoryId } =
      await listNewEmailMessages(currentHistoryId || undefined);

    if (!messageHeaders || messageHeaders.length === 0) {
      console.log(
        `✅ [${new Date().toISOString()}] No new email messages to sync.`
      );
      // Even if no new messages, the history ID might have advanced due to other non-message events (e.g., label changes).
      // It's important to save the new history ID to stay current.
      if (newHistoryId && newHistoryId !== currentHistoryId) {
        await prisma.oAuthToken.update({
          where: { id: 1 },
          data: { lastHistoryId: newHistoryId },
        });
        console.log(
          `   Updated history ID to ${newHistoryId} (no new messages, but history advanced).`
        );
      }
      console.log(
        `🏁 [${new Date().toISOString()}] Email synchronization cycle completed.`
      );
      return;
    }

    console.log(
      `📬 [${new Date().toISOString()}] Found ${
        messageHeaders.length
      } new email message(s) to process.`
    );

    let successfullyProcessedCount = 0;
    let failedProcessingCount = 0;

    for (const messageHeader of messageHeaders) {
      if (!messageHeader || !messageHeader.id) {
        console.warn(`   Skipping invalid message header:`, messageHeader);
        failedProcessingCount++;
        continue;
      }
      const gmailMessageId = messageHeader.id;
      try {
        console.log(`   Processing email with Gmail ID: ${gmailMessageId}...`);
        const fullEmail = await getEmailContent(gmailMessageId);
        if (!fullEmail) {
          console.error(
            `   ❌ Failed to fetch full content for email with Gmail ID: ${gmailMessageId}. Skipping.`
          );
          failedProcessingCount++;
          continue;
        }
        await processAndSaveEmail(fullEmail);
        successfullyProcessedCount++;
      } catch (emailProcessingError: any) {
        failedProcessingCount++;
        console.error(
          `   ❌ Error during processing pipeline for email with Gmail ID ${gmailMessageId}:`,
          emailProcessingError.message
        );
        // Log stack for more detailed debugging if needed, but keep it concise for general logs
        if (emailProcessingError.stack)
          console.error(emailProcessingError.stack.substring(0, 300));
        // Continue to the next email, this one failed.
      }
    }
    console.log(
      `📊 [${new Date().toISOString()}] Processing summary: ${successfullyProcessedCount} succeeded, ${failedProcessingCount} failed.`
    );

    // IMPORTANT: Update history ID to the latest one received from Gmail *after* attempting to process the batch.
    // This ensures that even if some emails in the batch fail, we don't re-fetch them endlessly on next sync.
    // The historyId from history.list covers all changes up to that point.
    if (newHistoryId) {
      await prisma.oAuthToken.update({
        where: { id: 1 },
        data: { lastHistoryId: newHistoryId },
      });
      console.log(
        `   Updated last processed Gmail History ID to ${newHistoryId}.`
      );
    } else if (messageHeaders.length > 0 && !currentHistoryId) {
      // This case implies we used messages.list (initial sync) and got messages, but messages.list doesn't return a historyId.
      // The *next* sync using history.list will establish the baseline historyId.
      console.warn(
        `   Note: Sync used messages.list (likely initial sync). A new history ID will be established on the next history-based sync.`
      );
    }
    console.log(
      `🏁 [${new Date().toISOString()}] Email synchronization cycle completed.`
    );
  } catch (fatalSyncError: any) {
    console.error(
      `❌ [${new Date().toISOString()}] FATAL ERROR during email synchronization cycle:`,
      fatalSyncError.message
    );
    if (fatalSyncError.stack) console.error(fatalSyncError.stack);
    if (fatalSyncError.response?.data)
      console.error(
        "   Underlying API Error from Google:",
        fatalSyncError.response.data
      );
    // In a production system, such fatal errors (e.g., auth failure, API totally unavailable)
    // should trigger alerts. The history ID is NOT updated in this case to ensure a retry of the same range.
  }
}
