import AssistantChat from "../components/AssistantChat";
import { PageHeader } from "../components/ui";
import { useI18n } from "../i18n";

/** Employees' "New ticket": a conversation, not a form. */
export default function NewTicketChat() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("va.page_title")} lede={t("va.page_lede")} />
      <AssistantChat variant="page" />
    </div>
  );
}
