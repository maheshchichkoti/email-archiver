import { google, drive_v3 } from "googleapis";
import { getAuthenticatedClient } from "../auth/googleAuth";
import { Readable } from "stream";

/**
 * Uploads a file to Google Drive.
 * @param filename The desired filename in Google Drive.
 * @param mimeType The MIME type of the file.
 * @param base64data The base64 encoded content of the file.
 * @returns The Google Drive API response data for the created file (id, webViewLink).
 */
export async function uploadToDrive(
  filename: string,
  mimeType: string,
  base64data: string
): Promise<drive_v3.Schema$File> {
  if (!filename || !mimeType || !base64data) {
    throw new Error(
      "uploadToDrive: Missing filename, mimeType, or base64data."
    );
  }

  let auth;
  try {
    auth = await getAuthenticatedClient();
  } catch (authError: any) {
    console.error(
      "DriveService: Failed to get authenticated client for Drive upload:",
      authError.message
    );
    throw authError;
  }

  const drive = google.drive({ version: "v3", auth });
  const buffer = Buffer.from(base64data, "base64");

  // Convert Buffer to a Readable stream
  const readableStream = new Readable();
  readableStream.push(buffer);
  readableStream.push(null);

  try {
    const res = await drive.files.create({
      media: {
        mimeType,
        body: readableStream,
      },
      requestBody: {
        name: filename,
      },
      fields: "id, webViewLink",
    });

    if (!res.data || !res.data.id || !res.data.webViewLink) {
      console.error(
        "DriveService: Drive API files.create response missing id or webViewLink:",
        res.data
      );
      throw new Error(
        "Google Drive API did not return expected file details (id, webViewLink)."
      );
    }
    return res.data as drive_v3.Schema$File;
  } catch (error: any) {
    console.error(
      `DriveService: Error uploading file "${filename}" to Google Drive:`,
      error.message
    );
    if (error.response?.data)
      console.error(
        "   Google API Error (Drive Upload):",
        JSON.stringify(error.response.data, null, 2)
      );
    else if (error.errors)
      console.error(
        "   Google API Error (Drive Upload):",
        JSON.stringify(error.errors, null, 2)
      );
    throw error;
  }
}
