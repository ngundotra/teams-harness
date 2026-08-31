export function baseActivity(over: Record<string, unknown>): Record<string, unknown> {
  return {
    channelId: "msteams",
    serviceUrl: "http://127.0.0.1:9",
    from: { id: "29:user-1", name: "User" },
    recipient: { id: "28:bot-1", name: "harness" },
    conversation: { id: "a:personal-1", conversationType: "personal" },
    channelData: { tenant: { id: "tid-1" } },
    timestamp: "2026-08-29T11:00:00.000Z",
    ...over,
  };
}

export function personalMessage(id: string, text: string): Record<string, unknown> {
  return baseActivity({
    type: "message",
    id,
    text,
    conversation: { id: "a:personal-1", conversationType: "personal" },
  });
}

export function groupMessage(id: string, text: string): Record<string, unknown> {
  return baseActivity({
    type: "message",
    id,
    text,
    conversation: {
      id: "19:group-1@thread.v2",
      isGroup: true,
      conversationType: "groupChat",
    },
  });
}

export function teamMessage(id: string, text: string, threadId?: string): Record<string, unknown> {
  const conversationId =
    threadId !== undefined
      ? `19:channel-1@thread.tacv2;messageid=${threadId}`
      : "19:channel-1@thread.tacv2";
  return baseActivity({
    type: "message",
    id,
    text,
    conversation: {
      id: conversationId,
      isGroup: true,
      conversationType: "channel",
    },
    channelData: {
      tenant: { id: "tid-1" },
      channel: { id: "19:channel-1@thread.tacv2" },
      team: { id: "19:team-1@thread.tacv2" },
    },
    ...(threadId !== undefined ? { replyToId: threadId } : {}),
  });
}

export function messageReactionAdded(
  targetMessageId: string,
  emoji: string,
  conversation?: Record<string, unknown>,
): Record<string, unknown> {
  return baseActivity({
    type: "messageReaction",
    id: `rxn-add-${emoji}`,
    reactionsAdded: [{ type: emoji }],
    replyToId: targetMessageId,
    ...(conversation !== undefined ? { conversation } : {}),
  });
}

export function messageReactionRemoved(
  targetMessageId: string,
  emoji: string,
): Record<string, unknown> {
  return baseActivity({
    type: "messageReaction",
    id: `rxn-rm-${emoji}`,
    reactionsRemoved: [{ type: emoji }],
    replyToId: targetMessageId,
  });
}

export function installationUpdate(): Record<string, unknown> {
  return baseActivity({
    type: "installationUpdate",
    action: "add",
    id: "install-1",
  });
}

export function membersAdded(): Record<string, unknown> {
  return baseActivity({
    type: "conversationUpdate",
    id: "cu-1",
    membersAdded: [{ id: "28:bot-1", name: "harness" }],
  });
}
