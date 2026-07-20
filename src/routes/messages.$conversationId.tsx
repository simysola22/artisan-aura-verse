import { createFileRoute, useParams } from "@tanstack/react-router";
import { MessagesLayout } from "./messages";

export const Route = createFileRoute("/messages/$conversationId")({
  head: () => ({ meta: [{ title: "Conversation — PMP" }] }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = useParams({ from: "/messages/$conversationId" });
  return <MessagesLayout activeId={conversationId} />;
}
