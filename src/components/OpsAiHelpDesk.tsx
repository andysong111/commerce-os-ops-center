"use client";

import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";

type HelpSource = {
  id: string;
  title: string;
  route: string | null;
  version: string;
};

type HelpAnswer = {
  status: "answered" | "out_of_scope" | "insufficient_evidence";
  answer: string;
  steps: string[];
  warnings: string[];
  sources: HelpSource[];
  cached: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: HelpAnswer;
};

const QUICK_QUESTIONS = [
  "이 화면은 무엇을 하는 곳이야?",
  "어떤 순서로 사용하면 돼?",
  "실행 전에 주의할 점은 무엇이야?",
];

function messageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceHref(route: string | null) {
  if (!route) return null;
  if (route.startsWith("/")) return route;
  try {
    return new URL(route).toString();
  } catch {
    return null;
  }
}

export function OpsAiHelpDesk() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const heading = document.querySelector("main h1")?.textContent?.trim();
      setPageTitle(heading || document.title || "OPS Center");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open, pending]);

  const history = useMemo(
    () =>
      messages.slice(-6).map((message) => ({
        role: message.role,
        text: message.text,
      })),
    [messages],
  );

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || pending) return;

    const userMessage: ChatMessage = {
      id: messageId("user"),
      role: "user",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/ops-ai-help", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          question: trimmed,
          page: {
            pathname,
            title: pageTitle,
            url: window.location.href,
          },
          history,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<HelpAnswer> & {
        message?: string;
      };
      if (!response.ok || !body.answer) {
        throw new Error(body.message || "AI 사용상담 답변을 받지 못했습니다.");
      }
      const answer = body as HelpAnswer;
      setMessages((current) => [
        ...current,
        {
          id: messageId("assistant"),
          role: "assistant",
          text: answer.answer,
          answer,
        },
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "AI 사용상담 중 오류가 발생했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="fixed bottom-4 right-4 z-[80] sm:bottom-6 sm:right-6">
      {open ? (
        <section
          aria-label="AI 사용상담"
          className="flex h-[min(720px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black tracking-[0.16em] text-cyan-300">
                  READ ONLY
                </p>
                <h2 className="mt-1 text-lg font-black">AI 사용상담</h2>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  현재 화면 사용법과 오류 확인만 안내합니다.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setError("");
                  }}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
                >
                  초기화
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
                  aria-label="AI 사용상담 닫기"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-300">
              현재 화면 · {pageTitle || pathname}
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-slate-700">
                  버튼 의미, 입력 순서, 오류 원인, 실행 전 주의사항을 물어보세요.
                  기능 개발이나 실제 주문·가격·재고 변경은 처리하지 않습니다.
                </div>
                <div className="grid gap-2">
                  {QUICK_QUESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => void ask(item)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-10 rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white"
                        : "mr-3 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800"
                    }
                  >
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    {message.answer?.steps?.length ? (
                      <ol className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                        {message.answer.steps.map((step, index) => (
                          <li key={`${message.id}-step-${index}`} className="flex gap-2">
                            <span className="font-black text-slate-500">{index + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {message.answer?.warnings?.length ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                        {message.answer.warnings.map((warning, index) => (
                          <p key={`${message.id}-warning-${index}`}>주의 · {warning}</p>
                        ))}
                      </div>
                    ) : null}
                    {message.answer?.sources?.length ? (
                      <div className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500">
                        <p className="font-black text-slate-600">답변 근거</p>
                        {message.answer.sources.map((source) => {
                          const href = sourceHref(source.route);
                          const label = `${source.title} · ${source.version}`;
                          return href ? (
                            <a
                              key={`${message.id}-${source.id}`}
                              href={href}
                              target={href.startsWith("http") ? "_blank" : undefined}
                              rel={href.startsWith("http") ? "noreferrer" : undefined}
                              className="block truncate underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
                            >
                              {label}
                            </a>
                          ) : (
                            <p key={`${message.id}-${source.id}`} className="truncate">
                              {label}
                            </p>
                          );
                        })}
                        <p className="mt-1">
                          {message.answer.cached ? "반복질문 캐시 사용" : "새 AI 답변 생성"}
                        </p>
                      </div>
                    ) : null}
                  </article>
                ))}
                {pending ? (
                  <div className="mr-16 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                    현재 화면과 운영 근거를 확인하고 있습니다…
                  </div>
                ) : null}
              </div>
            )}
            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
                {error}
              </div>
            ) : null}
          </div>

          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-4">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (question.trim()) void ask(question);
                }
              }}
              rows={3}
              maxLength={1_000}
              placeholder="예: 발주안 확정을 누르면 실제 주문되는 거야?"
              className="w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6 text-slate-900 outline-none ring-cyan-500 placeholder:text-slate-400 focus:ring-2"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-slate-500">
                읽기 전용 · 기능 실행 및 개발 불가
              </p>
              <button
                type="submit"
                disabled={pending || !question.trim()}
                className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-black text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                질문하기
              </button>
            </div>
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-950 text-sm font-black text-white shadow-xl hover:bg-slate-800 sm:h-auto sm:w-auto sm:gap-3 sm:px-5 sm:py-3.5"
          aria-label="AI 사용상담 열기"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-slate-950">
            AI
          </span>
          <span className="hidden sm:inline">사용법 물어보기</span>
        </button>
      )}
    </div>
  );
}
