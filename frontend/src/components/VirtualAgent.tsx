import { MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import AssistantChat from "./AssistantChat";
import { cx } from "./ui";

/** Floating entry point to the same assistant. It stays mounted while closed so the conversation is not lost. */
export function VirtualAgent() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed z-30 bottom-4 end-4 h-12 ps-4 pe-5 rounded-full bg-solid text-white shadow-pop inline-flex items-center gap-2 font-semibold hover:bg-solid-hover transition-colors">
          <MessageCircleQuestion size={19} />{t("va.open")}
        </button>
      )}
      <section aria-label={t("va.title")} className={cx("fixed z-40 bottom-0 end-0 sm:bottom-4 sm:end-4 w-full sm:w-[392px] h-[min(640px,100dvh)] sm:h-[min(640px,calc(100dvh-2rem))] bg-surface border border-line sm:rounded-xl shadow-pop animate-rise", !open && "hidden")}>
        <AssistantChat variant="widget" onClose={() => setOpen(false)} />
      </section>
    </>
  );
}
