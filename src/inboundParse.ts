import { conversationKeyFromSurface, parseSurface, surfaceFromFields } from "./surface.js";
import {
  type InboundMessage,
  brandConversationKey,
  brandMessageId,
  isRecord,
  readString,
} from "./types.js";

export function parseInboundMessage(value: unknown): InboundMessage {
  if (!isRecord(value)) {
    throw new Error("message payload is not an object");
  }
  const kind = readString(value.kind);
  if (kind !== "message") {
    throw new Error("message payload missing kind=message");
  }
  const messageId = readString(value.messageId);
  const text = readString(value.text);
  const conversationKey = readString(value.conversationKey);
  const conversationId = readString(value.conversationId);
  const serviceUrl = readString(value.serviceUrl);
  const fromId = readString(value.fromId);
  const conversationType = readString(value.conversationType);
  if (
    messageId === undefined ||
    text === undefined ||
    conversationKey === undefined ||
    conversationId === undefined ||
    serviceUrl === undefined ||
    fromId === undefined ||
    conversationType === undefined
  ) {
    throw new Error("message payload missing required fields");
  }
  const replyRaw = readString(value.replyToId);
  const teamId = readString(value.teamId);
  const channelId = readString(value.channelId);
  const parsedSurface = parseSurface(value.surface);
  const surface =
    parsedSurface ??
    surfaceFromFields({
      conversationId,
      conversationType,
      messageId,
      replyToId: replyRaw,
      teamId,
      channelId,
    });
  const msg: InboundMessage = {
    kind: "message",
    messageId: brandMessageId(messageId),
    text,
    conversationKey: brandConversationKey(conversationKey),
    conversationId,
    serviceUrl,
    fromId,
    conversationType,
    surface,
  };
  if (replyRaw !== undefined && replyRaw.length > 0) {
    msg.replyToId = brandMessageId(replyRaw);
  }
  if (teamId !== undefined && teamId.length > 0) {
    msg.teamId = teamId;
  }
  if (channelId !== undefined && channelId.length > 0) {
    msg.channelId = channelId;
  }
  if (msg.conversationKey.length === 0) {
    msg.conversationKey = conversationKeyFromSurface(surface);
  }
  return msg;
}
