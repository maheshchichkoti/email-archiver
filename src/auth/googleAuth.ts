// src/auth/googleAuth.ts
import { google, Auth } from "googleapis";
import dotenv from "dotenv";
import { PrismaClient, OAuthToken } from "@prisma/client";
import { encrypt, decrypt } from "../utils/encryption";

dotenv.config();

const prisma = new PrismaClient();

/**
 * Creates and configures a Google OAuth2 client.
 * This client will also have an event listener to automatically save
 * refreshed tokens back to the database.
 * @returns Configured Auth.OAuth2Client instance
 */
const createOAuth2Client = (): Auth.OAuth2Client => {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // CRITICAL: Listen for token refresh events to persist them
  oAuth2Client.on("tokens", async (tokens) => {
    // console.log('OAuth2Client "tokens" event fired:', tokens); // For debugging
    try {
      const updateData: Partial<
        Pick<OAuthToken, "access" | "refresh" | "expiry">
      > = {};

      if (tokens.access_token && tokens.expiry_date) {
        updateData.access = tokens.access_token;
        updateData.expiry = new Date(tokens.expiry_date);
        console.log(
          "Access token refreshed by Google API client. Updating in DB."
        );
      }

      if (tokens.refresh_token) {
        // A new refresh token is rare but can happen (e.g., user revokes and re-grants).
        // It MUST be encrypted before saving.
        console.log(
          "New refresh token received from Google API client. Encrypting and updating in DB."
        );
        updateData.refresh = encrypt(tokens.refresh_token);
      }

      if (Object.keys(updateData).length > 0) {
        // Assuming a single token record with id: 1 for this application's scope
        await prisma.oAuthToken.update({
          where: { id: 1 },
          data: updateData,
        });
        console.log(
          'Successfully updated tokens in DB from "tokens" event listener.'
        );
      }
    } catch (error) {
      console.error(
        'Error saving refreshed tokens from "tokens" event listener to DB:',
        error
      );
      // In a production system, you might add more robust error handling here,
      // like retries or specific alerts if DB update fails.
    }
  });

  return oAuth2Client;
};

// Singleton instance of the OAuth2 client, primarily for initial auth steps.
// For API calls, getAuthenticatedClient() is preferred as it ensures fresh credentials from DB.
const baseOAuth2Client = createOAuth2Client();

/**
 * Generates the Google OAuth consent screen URL.
 * @returns The authorization URL.
 */
export const getAuthUrl = (): string => {
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly", // To read emails
    "https://www.googleapis.com/auth/drive.file", // To upload attachments to Drive
    "https://www.googleapis.com/auth/userinfo.email", // To identify the authenticated user (optional, but good practice)
  ];

  return baseOAuth2Client.generateAuthUrl({
    access_type: "offline", // Essential to get a refresh token
    prompt: "consent", // Ensures refresh token is granted on first auth and on re-auth if scopes change.
    // Can be removed after initial setup if re-prompting is not desired.
    scope: scopes,
  });
};

/**
 * Exchanges an authorization code for OAuth tokens.
 * @param code The authorization code from Google's redirect.
 * @returns The OAuth tokens from Google.
 */
export const getTokensFromCode = async (
  code: string
): Promise<Auth.Credentials> => {
  const { tokens } = await baseOAuth2Client.getToken(code);
  // Set credentials on the base client after initial token retrieval.
  // This is important so that if it's used directly, it has credentials,
  // and also to ensure its 'tokens' event listener is active for any immediate operations.
  // However, getAuthenticatedClient() is generally safer for subsequent API calls.
  baseOAuth2Client.setCredentials(tokens);
  return tokens;
};

/**
 * Retrieves stored tokens from the database, creates an OAuth2 client,
 * sets its credentials (decrypting the refresh token), and returns the client.
 * This client is ready to make authenticated Google API calls and will handle
 * automatic access token refresh.
 * @returns A fully authenticated Auth.OAuth2Client instance.
 * @throws Error if no token is found or refresh token is missing/cannot be decrypted.
 */
export const getAuthenticatedClient = async (): Promise<Auth.OAuth2Client> => {
  // Assuming a single token record with id: 1
  const dbToken = await prisma.oAuthToken.findUnique({ where: { id: 1 } });

  if (!dbToken) {
    throw new Error(
      "OAuth token not found in database. Please complete the authentication flow."
    );
  }
  if (!dbToken.refresh) {
    // This should not happen if the initial auth was successful.
    throw new Error(
      "Refresh token is missing from the database. Re-authentication required."
    );
  }

  let decryptedRefreshToken: string;
  try {
    decryptedRefreshToken = decrypt(dbToken.refresh);
  } catch (error) {
    console.error("Failed to decrypt refresh token:", error);
    throw new Error(
      "Failed to decrypt refresh token. Re-authentication may be required."
    );
  }

  const client = createOAuth2Client(); // Create a new client instance to ensure fresh setup
  client.setCredentials({
    access_token: dbToken.access,
    refresh_token: decryptedRefreshToken,
    expiry_date: dbToken.expiry.getTime(),
  });

  return client;
};
