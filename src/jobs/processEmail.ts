// src/jobs/processEmail.ts
import { prisma } from "../lib/prisma"; // Use the shared Prisma client
import { parseEmailContent } from "../utils/emailParser";
import { saveEmail } from "../models/emailModel";
import { uploadToDrive } from "../services/driveService";
import { downloadAttachment as downloadGmailAttachment } from "../services/gmailService";
import { Email } from "@prisma/client"; // Import type for savedEmail

// Helper function to recursively find attachments in email parts
function findAttachments(parts: any[] = [], collected: any[] = []): any[] {
  for (const part of parts) {
    // Ensure filename exists and is not empty, and attachmentId is present
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      collected.push(part);
    }
    // Recursively search in nested parts
    if (part.parts?.length) {
      findAttachments(part.parts, collected);
    }
  }
  return collected;
}

/**
 * Processes a raw email object: parses it, saves its metadata,
 * and handles its attachments (downloading from Gmail, uploading to Drive, linking in DB).
 * @param rawEmail The full raw email object from the Gmail API.
 */
export async function processAndSaveEmail(rawEmail: any): Promise<void> {
  if (!rawEmail || !rawEmail.id) {
    console.warn(
      "processAndSaveEmail received invalid or incomplete rawEmail object. Skipping."
    );
    return;
  }

  let parsedEmailData;
  try {
    parsedEmailData = await parseEmailContent(rawEmail);
  } catch (error) {
    console.error(
      `❌ Error parsing email content for Gmail ID ${rawEmail.id}:`,
      error
    );
    return; // Cannot proceed without parsed data
  }

  let savedEmail: Email | null | undefined;
  try {
    // saveEmail uses the shared Prisma client and handles duplicate checks
    savedEmail = await saveEmail(parsedEmailData);
  } catch (error) {
    console.error(
      `❌ Critical error during saveEmail for Gmail ID ${rawEmail.id}:`,
      error
    );
    // Depending on the error, you might want to retry or escalate, but for now, we stop processing this email.
    return;
  }

  if (!savedEmail) {
    // This means the email was a duplicate (handled by saveEmail) or another non-critical save error occurred.
    // saveEmail should log the specifics if it's a duplicate.
    console.log(
      `⏩ Email with Gmail ID ${parsedEmailData.gmailId} (Message-ID: ${parsedEmailData.messageId}) was not saved (likely a duplicate or minor save issue). Skipping attachment processing.`
    );
    return;
  }

  console.log(
    `📧 Email ${savedEmail.id} ("${
      savedEmail.subject?.substring(0, 30) || "No Subject"
    }...") metadata saved to DB.`
  );

  const payload = rawEmail.payload;
  if (!payload) {
    console.warn(
      `Email with Gmail ID ${rawEmail.id} has no payload. Skipping attachment processing.`
    );
    return;
  }

  const attachmentsToProcess = findAttachments(payload.parts || []);

  if (attachmentsToProcess.length > 0) {
    console.log(
      `📎 Found ${attachmentsToProcess.length} attachment(s) for email ID ${savedEmail.id} (Gmail ID: ${rawEmail.id}).`
    );

    for (const part of attachmentsToProcess) {
      // Validate essential attachment part properties
      if (!part.body?.attachmentId || !part.filename || !part.mimeType) {
        console.warn(
          `Skipping malformed attachment part for email ${savedEmail.id}: Missing attachmentId, filename, or mimeType. Part details:`,
          part
        );
        continue;
      }

      const attachmentFilename = part.filename; // Store for logging

      try {
        console.log(
          `   Downloading attachment: "${attachmentFilename}" for email ${savedEmail.id}...`
        );
        const base64data = await downloadGmailAttachment(
          rawEmail.id!,
          part.body.attachmentId!
        );

        if (!base64data) {
          console.error(
            `   ❌ Failed to download attachment data for "${attachmentFilename}" from email ${savedEmail.id}. Attachment ID: ${part.body.attachmentId}. Skipping this attachment.`
          );
          continue;
        }

        console.log(
          `   Uploading "${attachmentFilename}" to Drive for email ${savedEmail.id}...`
        );
        const uploadedFile = await uploadToDrive(
          attachmentFilename,
          part.mimeType!,
          base64data
        );

        if (!uploadedFile || !uploadedFile.id || !uploadedFile.webViewLink) {
          console.error(
            `   ❌ Failed to upload "${attachmentFilename}" to Drive or received incomplete data from Drive API. Skipping DB record for this attachment.`
          );
          continue;
        }

        await prisma.attachment.create({
          data: {
            emailId: savedEmail.id,
            filename: attachmentFilename,
            mimeType: part.mimeType!,
            driveId: uploadedFile.id!,
            driveUrl: uploadedFile.webViewLink!,
          },
        });
        console.log(
          `   ✅ Successfully processed attachment "${attachmentFilename}" for email ${savedEmail.id}. Linked to Drive file ID: ${uploadedFile.id}.`
        );
      } catch (attachmentError: any) {
        console.error(
          `   ❌ Error processing attachment "${attachmentFilename}" for email ${savedEmail.id}:`,
          attachmentError.message
        );
        if (attachmentError.stack)
          console.error(attachmentError.stack.substring(0, 500)); // Log part of the stack
        // Continue to the next attachment
      }
    }
  } else {
    console.log(
      `No attachments found to process for email ID ${savedEmail.id} (Gmail ID: ${rawEmail.id}).`
    );
  }
}
