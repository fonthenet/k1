/** A single message in a crèche's support conversation. */
export interface SupportMessage {
  id: string;
  body: string;
  createdAt: string;
  /** True when Rawdati wrote it, false when the crèche did. */
  fromPlatform: boolean;
  /** Absent for optimistic messages that have not been acknowledged yet. */
  pending?: boolean;
  /** Set when a send failed, so the bubble can offer a retry. */
  failed?: boolean;
}

/** What the widget needs before it opens: the thread and how much is unread. */
export interface SupportSummary {
  threadId: string;
  unread: number;
}

/** One client conversation in the operator's inbox. */
export interface SupportInboxRow {
  threadId: string;
  tenantId: string;
  tenantName: string;
  lastMessageAt: string;
  preview: string | null;
  /** The crèche spoke last and nobody at Rawdati has opened it since. */
  unread: boolean;
}
