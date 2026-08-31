// Shapes for the floating conversations panel.
//
// The panel shows two kinds of conversation that are stored in different
// tables — family threads (`kg_threads`) and the crèche's own line to Rawdatik
// (`kg_support_threads`) — so everything below is the shape they are flattened
// into. `kind` is the discriminator every action switches on; nothing else in
// the widget needs to know which table a row came from.

export type InboxKind = "family" | "support";

export interface InboxThread {
  kind: InboxKind;
  /** Thread id in that kind's own table. Unique across both in practice (uuid). */
  id: string;
  /** Null for the support row, which the widget titles from its translations. */
  subject: string | null;
  childName: string | null;
  /** Null for the support row, and for family threads not about one child. */
  childId: string | null;
  preview: string | null;
  lastMessageAt: string | null;
  /**
   * Messages waiting in this conversation. The bubble's badge is the sum of
   * these, so a row and the badge can never tell different stories.
   */
  unreadCount: number;
}

export interface InboxMessage {
  id: string;
  body: string;
  createdAt: string;
  /** Written by the person reading it — draws on the right, in primary. */
  mine: boolean;
  /**
   * Who wrote it, for the label above the bubble. Null when it is mine, and
   * null throughout the support thread: that conversation has exactly two
   * sides and naming them on every bubble is noise.
   */
  authorName: string | null;
  /**
   * `kg_memberships.role` of the author, for the caption beside their name.
   * Null when the message is mine, on the support thread, and whenever the
   * role could not be read.
   */
  authorRole: string | null;
  /** Optimistic message the server has not acknowledged yet. */
  pending?: boolean;
  /** The send failed. Kept on screen so nothing anyone typed is lost. */
  failed?: boolean;
}

/** What the bubble needs before it is opened. */
export interface InboxSummary {
  /** Conversations waiting, counted in conversations — not in messages. */
  unread: number;
  /** Present only for admins; the vendor relationship is not an educator's business. */
  supportThreadId: string | null;
}
