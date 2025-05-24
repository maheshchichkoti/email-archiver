import { decode } from "html-entities";

export async function parseEmailContent(rawPayload: any) {
  const headers = rawPayload.payload.headers;

  const getHeader = (name: string) =>
    headers.find(
      (header: any) => header.name.toLowerCase() === name.toLowerCase()
    )?.value;

  const subject = getHeader("Subject");
  const from = getHeader("From");
  const to = getHeader("To");
  const cc = getHeader("Cc");
  const bcc = getHeader("Bcc");
  const messageId = getHeader("Message-ID");
  const inReplyTo = getHeader("In-Reply-To");
  const references = getHeader("References");
  const internalDate = Number(rawPayload.internalDate);

  const parts = rawPayload.payload.parts || [];
  const bodyPart = parts.find(
    (part: any) =>
      part.mimeType === "text/html" || part.mimeType === "text/plain"
  );

  let body = bodyPart?.body?.data || "";

  if (body) {
    const buff = Buffer.from(body, "base64");
    body = decode(buff.toString("utf-8"));
  }

  return {
    gmailId: rawPayload.id,
    threadId: rawPayload.threadId,
    subject,
    from,
    to,
    cc,
    bcc,
    messageId,
    inReplyTo,
    references,
    internalDate: new Date(internalDate),
    body,
  };
}
