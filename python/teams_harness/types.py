from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias, TypedDict, TYPE_CHECKING

if TYPE_CHECKING:
    from .surface import Surface

TurnId: TypeAlias = str
MessageId: TypeAlias = str
ConversationKey: TypeAlias = str
JsonRpcId: TypeAlias = str | int


def brand_turn_id(value: str) -> TurnId:
    if not value:
        raise ValueError("turn id must be non-empty")
    return value


def brand_message_id(value: str) -> MessageId:
    if not value:
        raise ValueError("message id must be non-empty")
    return value


def brand_conversation_key(value: str) -> ConversationKey:
    if not value:
        raise ValueError("conversation key must be non-empty")
    return value


@dataclass(slots=True)
class InboundMessage:
    kind: Literal["message"]
    message_id: MessageId
    text: str
    conversation_key: ConversationKey
    conversation_id: str
    service_url: str
    from_id: str
    conversation_type: str
    surface: Surface
    reply_to_id: MessageId | None = None
    team_id: str | None = None
    channel_id: str | None = None


@dataclass(slots=True)
class InboundReaction:
    kind: Literal["reaction"]
    message_id: MessageId
    emoji: str
    action: Literal["add", "remove"]
    from_id: str
    conversation_key: ConversationKey
    conversation_id: str
    service_url: str


@dataclass(slots=True)
class InboundIgnored:
    kind: Literal["ignored"]
    type: str
    reason: str


InboundEvent: TypeAlias = InboundMessage | InboundReaction | InboundIgnored


@dataclass(slots=True)
class InboxFollowup:
    kind: Literal["followup"]
    message: InboundMessage


@dataclass(slots=True)
class InboxReaction:
    kind: Literal["reaction"]
    message_id: MessageId
    emoji: str
    action: Literal["add", "remove"]
    from_id: str


InboxItem: TypeAlias = InboxFollowup | InboxReaction


@dataclass(slots=True)
class StoredReaction:
    message_id: MessageId
    emoji: str
    action: Literal["add", "remove"]
    from_id: str


@dataclass(slots=True)
class SetReaction:
    message_id: MessageId
    emoji: str


@dataclass(slots=True)
class AckRecord:
    conversation_key: str
    text: str
    at: float


@dataclass
class TurnRunning:
    kind: Literal["running"]
    turn_id: TurnId
    conversation_key: ConversationKey
    start_message: InboundMessage
    followups: list[InboundMessage] = field(default_factory=list)
    inbound_reactions: list[StoredReaction] = field(default_factory=list)
    set_reactions: list[SetReaction] = field(default_factory=list)
    pid: int = -1
    started_at: float = 0.0
    grok_session_id: str | None = None


@dataclass
class TurnDone:
    kind: Literal["done"]
    turn_id: TurnId
    conversation_key: ConversationKey
    start_message: InboundMessage
    followups: list[InboundMessage] = field(default_factory=list)
    inbound_reactions: list[StoredReaction] = field(default_factory=list)
    set_reactions: list[SetReaction] = field(default_factory=list)
    final_reply: str | None = None


TurnState: TypeAlias = TurnRunning | TurnDone


@dataclass(slots=True, frozen=True)
class DispatchStarted:
    kind: Literal["started"]
    turn_id: TurnId


@dataclass(slots=True, frozen=True)
class DispatchEnqueued:
    kind: Literal["enqueued"]
    turn_id: TurnId


@dataclass(slots=True, frozen=True)
class DispatchFerried:
    kind: Literal["ferried"]
    turn_id: TurnId


@dataclass(slots=True, frozen=True)
class DispatchDropped:
    kind: Literal["dropped"]
    reason: str


@dataclass(slots=True, frozen=True)
class DispatchIgnored:
    kind: Literal["ignored"]
    reason: str


DispatchResult: TypeAlias = (
    DispatchStarted | DispatchEnqueued | DispatchFerried | DispatchDropped | DispatchIgnored
)


class AcpEnvVar(TypedDict):
    name: str
    value: str


class AcpMcpServerStdio(TypedDict):
    type: Literal["stdio"]
    name: str
    command: str
    args: list[str]
    env: list[AcpEnvVar]


def is_record(value: object) -> bool:
    return isinstance(value, dict)


def read_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def read_number(value: object) -> float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def read_boolean(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def as_record(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None
