// ---- Mock Prisma Client ----
// We mock the specific functions runEmailSync will call on prisma.oAuthToken
const mockOAuthTokenFindUnique = jest.fn();
const mockOAuthTokenUpdate = jest.fn();

jest.mock("@prisma/client", () => {
  // console.log('Mocking PrismaClient'); // For debugging mock execution
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      // console.log('PrismaClient constructor called in mock'); // For debugging
      return {
        oAuthToken: {
          findUnique: mockOAuthTokenFindUnique,
          update: mockOAuthTokenUpdate,
        },
        // If runEmailSync directly used other models, mock them here too.
        // e.g., $transaction: jest.fn() if you were using transactions directly in runEmailSync
      };
    }),
  };
});

// ---- Mock Services ----
const mockListNewEmailMessages = jest.fn();
const mockGetEmailContent = jest.fn();

jest.mock("../../src/services/gmailService", () => {
  // console.log('Mocking gmailService'); // For debugging
  return {
    // Ensure all exported members from the actual module are listed,
    // even if not all are used in this specific test suite.
    // Mock the ones you need to control.
    listNewEmailMessages: mockListNewEmailMessages,
    getEmailContent: mockGetEmailContent,
    downloadAttachment: jest.fn(), // If exported, mock it even if not directly used by runEmailSync
  };
});

// ---- Mock Job Processors ----
// runEmailSync calls processAndSaveEmail. We mock this entire function
// as its internal workings would be tested in its own integration/unit tests.
const mockProcessAndSaveEmail = jest.fn();
jest.mock("../../src/jobs/processEmail", () => {
  // console.log('Mocking processEmail'); // For debugging
  return {
    processAndSaveEmail: mockProcessAndSaveEmail,
  };
});

// ---- Import the System Under Test (SUT) AFTER all mocks are defined ----
import { runEmailSync } from "../../jobs/syncGmail";

describe("runEmailSync Integration Test", () => {
  beforeEach(() => {
    // Reset all mock function calls and implementations before each test
    jest.clearAllMocks();

    // Optionally mock console methods to prevent test output clutter and allow assertions on logs
    global.console = {
      ...global.console,
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    };
  });

  test("should log an error and exit if no OAuth token is found in DB", async () => {
    mockOAuthTokenFindUnique.mockResolvedValue(null); // Simulate no token found

    await runEmailSync();

    expect(mockOAuthTokenFindUnique).toHaveBeenCalledTimes(1);
    expect(mockOAuthTokenFindUnique).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(console.error).toHaveBeenCalledWith(
      "❌ No OAuth token found in DB. Please authenticate first."
    );
    expect(mockListNewEmailMessages).not.toHaveBeenCalled();
  });

  test('should log "no new emails" and update historyId if listNewEmailMessages returns no messages but a new historyId', async () => {
    const fakeToken = {
      id: 1,
      access: "access",
      refresh: "refresh",
      expiry: new Date(),
      lastHistoryId: "old-history-id",
    };
    mockOAuthTokenFindUnique.mockResolvedValue(fakeToken);
    mockListNewEmailMessages.mockResolvedValue({
      messages: [],
      historyId: "new-history-id",
    });

    await runEmailSync();

    expect(mockListNewEmailMessages).toHaveBeenCalledWith("old-history-id");
    expect(console.log).toHaveBeenCalledWith("✅ No new emails to sync.");
    expect(mockGetEmailContent).not.toHaveBeenCalled();
    expect(mockProcessAndSaveEmail).not.toHaveBeenCalled();
    expect(mockOAuthTokenUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastHistoryId: "new-history-id" },
    });
  });

  test("should process emails, call processAndSaveEmail for each, and update historyId", async () => {
    const fakeToken = {
      id: 1,
      access: "access",
      refresh: "refresh",
      expiry: new Date(),
      lastHistoryId: "hist-100",
    };
    const emailHeaders = [
      { id: "msg1", threadId: "thread1" },
      { id: "msg2", threadId: "thread2" },
    ];
    const fullEmail1 = {
      id: "msg1",
      internalDate: Date.now().toString(),
    };
    const fullEmail2 = {
      id: "msg2",
      internalDate: Date.now().toString(),
    };

    mockOAuthTokenFindUnique.mockResolvedValue(fakeToken);
    mockListNewEmailMessages.mockResolvedValue({
      messages: emailHeaders,
      historyId: "hist-101",
    });
    mockGetEmailContent.mockImplementation(async (messageId) => {
      if (messageId === "msg1") return fullEmail1;
      if (messageId === "msg2") return fullEmail2;
      return null;
    });
    mockProcessAndSaveEmail.mockResolvedValue(undefined);

    await runEmailSync();

    expect(mockListNewEmailMessages).toHaveBeenCalledWith("hist-100");
    expect(mockGetEmailContent).toHaveBeenCalledTimes(2);
    expect(mockGetEmailContent).toHaveBeenCalledWith("msg1");
    expect(mockGetEmailContent).toHaveBeenCalledWith("msg2");
    expect(mockProcessAndSaveEmail).toHaveBeenCalledTimes(2);
    expect(mockProcessAndSaveEmail).toHaveBeenCalledWith(fullEmail1);
    expect(mockProcessAndSaveEmail).toHaveBeenCalledWith(fullEmail2);
    expect(mockOAuthTokenUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastHistoryId: "hist-101" },
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Email sync completed. Updated history ID to hist-101."
      )
    );
  });

  test("should handle errors during getEmailContent for one email and continue with others", async () => {
    const fakeToken = { lastHistoryId: "hist-200" };
    const emailHeaders = [{ id: "msg-fail" }, { id: "msg-success" }];
    const fullEmailSuccess = {
      id: "msg-success",
      internalDate: Date.now().toString(),
    };
    const fetchError = new Error("Failed to fetch msg-fail");

    mockOAuthTokenFindUnique.mockResolvedValue(fakeToken);
    mockListNewEmailMessages.mockResolvedValue({
      messages: emailHeaders,
      historyId: "hist-201",
    });
    mockGetEmailContent.mockImplementation(async (messageId) => {
      if (messageId === "msg-fail") throw fetchError;
      if (messageId === "msg-success") return fullEmailSuccess;
      return null;
    });
    mockProcessAndSaveEmail.mockResolvedValue(undefined);

    await runEmailSync();

    expect(mockGetEmailContent).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Error processing email ID msg-fail:"),
      fetchError.message,
      expect.any(String)
    );
    expect(mockProcessAndSaveEmail).toHaveBeenCalledTimes(1);
    expect(mockProcessAndSaveEmail).toHaveBeenCalledWith(fullEmailSuccess);
    expect(mockOAuthTokenUpdate).toHaveBeenCalledWith({
      // History ID should still update
      where: { id: 1 },
      data: { lastHistoryId: "hist-201" },
    });
  });

  test("should handle fatal errors from listNewEmailMessages and not update historyId", async () => {
    const fakeToken = { lastHistoryId: "hist-300" };
    const apiError = new Error("Gmail API limit reached");
    mockOAuthTokenFindUnique.mockResolvedValue(fakeToken);
    mockListNewEmailMessages.mockRejectedValue(apiError);

    await runEmailSync();

    expect(console.error).toHaveBeenCalledWith(
      "❌ Fatal error during email sync:",
      apiError.message,
      expect.any(String)
    );
    expect(mockGetEmailContent).not.toHaveBeenCalled();
    expect(mockProcessAndSaveEmail).not.toHaveBeenCalled();
    expect(mockOAuthTokenUpdate).not.toHaveBeenCalled();
  });
});
