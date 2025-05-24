// src/controllers/oauthController.ts
import { Request, Response } from "express";
import { getAuthUrl, getTokensFromCode } from "../auth/googleAuth"; // Uses the refined googleAuth.ts
import { PrismaClient } from "@prisma/client";
import { encrypt } from "../utils/encryption";

const prisma = new PrismaClient();

/**
 * Redirects the user to Google's OAuth consent screen.
 */
export const serveAuthUrl = (_req: Request, res: Response): void => {
  try {
    const url = getAuthUrl();
    res.redirect(url);
  } catch (error) {
    console.error("Error generating auth URL:", error);
    res
      .status(500)
      .send("Failed to generate authentication URL. Please try again later.");
  }
};

/**
 * Handles the callback from Google after user consent.
 * Exchanges the authorization code for tokens, encrypts the refresh token,
 * and stores them in the database.
 */
export const handleOAuthCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  const code = req.query.code as string;

  if (!code) {
    console.warn("OAuth callback received without an authorization code.");
    res.status(400).send("Missing authorization code parameter from Google.");
    return;
  }

  try {
    // Fetches tokens using the authorization code.
    // getTokensFromCode also sets these initial tokens on a base client instance in googleAuth.ts,
    // which is good practice for activating its 'tokens' event listener early.
    const tokens = await getTokensFromCode(code);

    if (!tokens.access_token) {
      console.error(
        "OAuth error: No access_token received from Google after code exchange."
      );
      res.status(500).send("Failed to retrieve access token from Google.");
      return;
    }

    // Prepare data for database, encrypting refresh token if present.
    const dataToStore: {
      access: string;
      expiry: Date;
      refresh?: string; // Will only be set if tokens.refresh_token is present
    } = {
      access: tokens.access_token,
      expiry: new Date(tokens.expiry_date!),
    };

    if (tokens.refresh_token) {
      console.log(
        "Refresh token received in OAuth callback. Encrypting for storage."
      );
      dataToStore.refresh = encrypt(tokens.refresh_token);
    } else {
      // This can happen if the user has previously authorized and a refresh token already exists,
      // and 'prompt: consent' was not used or was not necessary.
      console.log(
        "No new refresh token received in OAuth callback. If updating, existing refresh token will be preserved."
      );
    }

    // Upsert logic: update if exists, create if not.
    // Assumes a single token record with id: 1 for this application's scope.
    const existingToken = await prisma.oAuthToken.findUnique({
      where: { id: 1 },
    });

    if (existingToken) {
      console.log("Existing OAuth token record found (id: 1). Updating...");
      await prisma.oAuthToken.update({
        where: { id: 1 },
        data: {
          access: dataToStore.access,
          // Only update the 'refresh' field if a new encrypted one was provided.
          // This prevents overwriting an existing valid refresh token with undefined.
          ...(dataToStore.refresh && { refresh: dataToStore.refresh }),
          expiry: dataToStore.expiry,
          // lastHistoryId should be preserved if it exists; not modified here.
        },
      });
      console.log("OAuth token record updated.");
    } else {
      console.log(
        "No existing OAuth token record found (id: 1). Creating new record..."
      );
      // For a new record, a refresh token is essential.
      if (!dataToStore.refresh) {
        console.error(
          "OAuth critical error: Attempting to create a new token record without a refresh token."
        );
        res
          .status(400)
          .send(
            "Failed to obtain a refresh token during initial authorization. " +
              'Ensure "prompt=consent" was used in the auth URL if this is the first authorization, ' +
              'and "access_type=offline" is set.'
          );
        return;
      }
      await prisma.oAuthToken.create({
        data: {
          id: 1, // Hardcoded ID for single-user application
          access: dataToStore.access,
          refresh: dataToStore.refresh, // Encrypted refresh token
          expiry: dataToStore.expiry,
          lastHistoryId: null, // Initialize lastHistoryId for new records
        },
      });
      console.log("New OAuth token record created.");
    }

    res.send(
      "✅ Authentication successful. Tokens stored. Your application is now authorized to sync emails."
    );
  } catch (error: any) {
    console.error(
      "Critical error during OAuth callback processing:",
      error.message,
      error.stack
    );
    if (error.response?.data) {
      // Specific handling for Google API errors passed via Axios-like structure
      console.error("Google API Error details:", error.response.data);
      const errMsg =
        error.response.data.error_description ||
        error.response.data.error ||
        error.message;
      res
        .status(500)
        .send(`OAuth callback failed due to a Google API error: ${errMsg}`);
    } else {
      res
        .status(500)
        .send(`OAuth callback processing failed: ${error.message}`);
    }
  }
};
