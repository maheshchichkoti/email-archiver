import { prisma } from "../lib/prisma";
import { Prisma, Email } from "@prisma/client";

/**
 * Saves parsed email data to the database.
 * Handles duplicate email detection based on unique constraints on `gmailId` or `messageId`.
 * @param parsedEmailData Object containing the email data to save.
 * @returns The saved Email object or null if it's a duplicate or a non-critical save error occurs.
 * @throws Error for unexpected database errors not related to unique constraints.
 */
export const saveEmail = async (
  parsedEmailData: Prisma.EmailCreateInput
): Promise<Email | null> => {
  try {
    const email = await prisma.email.create({
      data: parsedEmailData,
    });
    return email;
  } catch (error: any) {
    // P2002 is Prisma's error code for unique constraint violation
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target =
        (error.meta?.target as string[])?.join(", ") || "unique field";
      console.log(
        `⏩ Duplicate email detected by constraint on [${target}]. Gmail ID: ${parsedEmailData.gmailId}, Message-ID: ${parsedEmailData.messageId}. Skipping.`
      );
      return null; // Indicate duplicate, not a critical failure
    } else {
      // For other errors, log them as more critical and re-throw or handle as appropriate
      console.error(
        `❌ Failed to save email (Gmail ID: ${parsedEmailData.gmailId}, Message-ID: ${parsedEmailData.messageId}) to database:`,
        error.message
      );
      if (error.stack) console.error(error.stack.substring(0, 500));
      // Depending on requirements, you might want to re-throw for runEmailSync to catch
      // or return null to indicate failure to save but allow sync to continue with other emails.
      // For now, returning null to prevent one bad email from stopping the whole sync batch.
      return null;
    }
  }
};
