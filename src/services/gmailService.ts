// src/services/gmailService.ts
import { google, gmail_v1 } from "googleapis"; // Import gmail_v1 for types
import { getAuthenticatedClient } from "../auth/googleAuth"; // Assumes this is the robust version

/**
 * Interface for the result of listing new email messages.
 */
interface ListNewEmailMessagesResult {
  messages: gmail_v1.Schema$Message[]; // Array of message objects (often stubs with id and threadId from history.list)
  historyId: string | null | undefined; // The new history ID to be stored for the next sync
}

/**
 * Lists new email messages since a given history ID, or fetches recent messages if no history ID is provided.
 * Uses Gmail's History API for incremental syncs, falling back to Messages API for initial sync.
 * @param startHistoryId The Gmail History ID to start fetching changes from. Undefined for initial sync.
 * @returns An object containing an array of message objects and the new history ID.
 * @throws Error if API calls fail or the authenticated client cannot be obtained.
 */
export async function listNewEmailMessages(
  startHistoryId: string | undefined
): Promise<ListNewEmailMessagesResult> {
  let auth;
  try {
    auth = await getAuthenticatedClient(); // This should handle token refresh internally
  } catch (authError: any) {
    console.error(
      "GmailService: Failed to get authenticated client for listing messages:",
      authError.message
    );
    // Re-throw to be caught by the calling function (e.g., runEmailSync)
    // This allows the caller to decide on overall sync failure.
    throw authError;
  }

  const gmail = google.gmail({ version: "v1", auth });

  try {
    if (startHistoryId) {
      // Incremental sync using history.list
      const params: gmail_v1.Params$Resource$Users$History$List = {
        userId: "me",
        startHistoryId: startHistoryId,
        historyTypes: ["messageAdded"], // Focus only on new messages added
        // labelId: 'INBOX', // Optionally, filter by label if needed
      };
      console.log(`GmailService: Fetching history since ID: ${startHistoryId}`);
      const res = await gmail.users.history.list(params);

      let collectedMessages: gmail_v1.Schema$Message[] = [];
      if (res.data.history) {
        for (const historyRecord of res.data.history) {
          // Messages added appear in the messagesAdded array within a history record
          if (historyRecord.messagesAdded) {
            for (const messageAdded of historyRecord.messagesAdded) {
              if (messageAdded.message) {
                // The message object here usually contains id and threadId.
                // It might contain more depending on Gmail API version and changes.
                collectedMessages.push(messageAdded.message);
              }
            }
          }
        }
      }
      if (collectedMessages.length > 0) {
        console.log(
          `GmailService: Found ${collectedMessages.length} new message(s) via history.list.`
        );
      }

      return {
        messages: collectedMessages,
        historyId: res.data.historyId, // This is the new history ID for the next sync
      };
    } else {
      // Fallback: Initial sync or if historyId was lost. Fetch recent messages using messages.list.
      console.warn(
        "GmailService: No startHistoryId provided. Performing fallback using messages.list for recent emails."
      );
      let messages: gmail_v1.Schema$Message[] = [];
      let nextPageToken: string | undefined | null = undefined;
      const MAX_INITIAL_FETCH_PAGES = 5; // Safety limit for initial fetch to prevent excessive API calls
      let currentPage = 0;

      do {
        currentPage++;
        const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
          userId: "me",
          maxResults: 100, // Fetch a decent batch size
          // Query to fetch recent emails. Adjust as needed.
          // 'newer_than:7d' can be too broad. Consider 'label:inbox newer_than:7d' or similar.
          q: "in:inbox newer_than:7d", // Example: initial fetch for last 7 days in inbox
          pageToken: nextPageToken || undefined,
        };
        console.log(
          `GmailService: Fallback messages.list page ${currentPage} (pageToken: ${
            nextPageToken || "start"
          })`
        );
        const res = await gmail.users.messages.list(listParams);

        if (res.data.messages) {
          // messages.list returns stubs (id, threadId).
          messages = messages.concat(
            res.data.messages as gmail_v1.Schema$Message[]
          );
        }
        nextPageToken = res.data.nextPageToken;
      } while (nextPageToken && currentPage < MAX_INITIAL_FETCH_PAGES);

      if (currentPage >= MAX_INITIAL_FETCH_PAGES && nextPageToken) {
        console.warn(
          `GmailService: Reached MAX_INITIAL_FETCH_PAGES (${MAX_INITIAL_FETCH_PAGES}) during fallback message list. Some older emails might not have been fetched in this run.`
        );
      }
      console.log(
        `GmailService: Fallback messages.list fetched ${messages.length} message stubs.`
      );
      // messages.list does not return a new historyId. The next successful history.list call will establish it.
      return { messages, historyId: null };
    }
  } catch (error: any) {
    console.error(
      "GmailService: Error listing new email messages from Gmail API:",
      error.message
    );
    if (error.response?.data) {
      // Log Google API specific error if available
      console.error(
        "   Google API Error details (Gmail List):",
        JSON.stringify(error.response.data, null, 2)
      );
    } else if (error.errors) {
      // Another common Google API error structure
      console.error(
        "   Google API Error details (Gmail List):",
        JSON.stringify(error.errors, null, 2)
      );
    }
    throw error; // Re-throw for the caller (runEmailSync) to handle as a fatal sync error for this cycle
  }
}

/**
 * Fetches the full content of a specific email message.
 * @param messageId The ID of the Gmail message to fetch.
 * @returns The full Gmail message object, or null if not found or an error occurs that shouldn't halt the batch.
 * @throws Error if a critical API call fails or the authenticated client cannot be obtained.
 */
export async function getEmailContent(
  messageId: string
): Promise<gmail_v1.Schema$Message | null> {
  if (!messageId) {
    console.warn("GmailService: getEmailContent called with no messageId.");
    return null; // Or throw an error if messageId is absolutely expected
  }

  let auth;
  try {
    auth = await getAuthenticatedClient();
  } catch (authError: any) {
    console.error(
      `GmailService: Failed to get authenticated client for fetching email content (ID: ${messageId}):`,
      authError.message
    );
    throw authError;
  }

  const gmail = google.gmail({ version: "v1", auth });

  try {
    console.log(
      `GmailService: Fetching full content for message ID: ${messageId}`
    );
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full", // Request full message payload including headers, body, parts
    });
    return res.data as gmail_v1.Schema$Message;
  } catch (error: any) {
    console.error(
      `GmailService: Error fetching email content for message ID "${messageId}":`,
      error.message
    );
    if (error.code === 404) {
      // Specifically handle "Not Found" errors
      console.warn(
        `   Message ID "${messageId}" not found (404). It might have been deleted.`
      );
      return null; // Return null to indicate the message is gone, allowing sync to continue
    }
    if (error.response?.data) {
      console.error(
        "   Google API Error details (Gmail Get):",
        JSON.stringify(error.response.data, null, 2)
      );
    } else if (error.errors) {
      console.error(
        "   Google API Error details (Gmail Get):",
        JSON.stringify(error.errors, null, 2)
      );
    }
    // For other errors, re-throw so runEmailSync can log it per-email and continue with the batch
    throw error;
  }
}

/**
 * Downloads the base64 encoded data of an email attachment.
 * @param messageId The ID of the Gmail message containing the attachment.
 * @param attachmentId The ID of the attachment within the message.
 * @returns The base64 encoded attachment data, or null if not found or a non-critical error.
 * @throws Error if a critical API call fails or the authenticated client cannot be obtained.
 */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string
): Promise<string | null> {
  if (!messageId || !attachmentId) {
    console.warn(
      "GmailService: downloadAttachment called with missing messageId or attachmentId."
    );
    return null;
  }

  let auth;
  try {
    auth = await getAuthenticatedClient();
  } catch (authError: any) {
    console.error(
      `GmailService: Failed to get authenticated client for downloading attachment (MsgID: ${messageId}, AttID: ${attachmentId}):`,
      authError.message
    );
    throw authError;
  }

  const gmail = google.gmail({ version: "v1", auth });

  try {
    console.log(
      `GmailService: Downloading attachment ID: ${attachmentId} from message ID: ${messageId}`
    );
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: messageId,
      id: attachmentId,
    });
    return res.data.data || null;
  } catch (error: any) {
    console.error(
      `GmailService: Error downloading attachment ID "${attachmentId}" from message ID "${messageId}":`,
      error.message
    );
    if (error.code === 404) {
      console.warn(
        `   Attachment ID "${attachmentId}" (MsgID: "${messageId}") not found (404).`
      );
      return null;
    }
    if (error.response?.data) {
      console.error(
        "   Google API Error details (Gmail Attachment Get):",
        JSON.stringify(error.response.data, null, 2)
      );
    } else if (error.errors) {
      console.error(
        "   Google API Error details (Gmail Attachment Get):",
        JSON.stringify(error.errors, null, 2)
      );
    }
    // Re-throw for processAndSaveEmail to handle per-attachment
    throw error;
  }
}
