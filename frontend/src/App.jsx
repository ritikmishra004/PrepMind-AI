import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  BrainCircuit,
  History,
  BookOpen,
  Settings,
  Bell,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Target,
  Clock3,
  Trophy,
  Code2,
  Database,
  Network,
  Bot,
  Layers3,
  Zap,
  Play,
  CheckCircle2,
  Menu,
  X,
  Send,
  LoaderCircle,
  CircleAlert,
  ExternalLink,
  RotateCcw,
  Laptop,
  Globe,
  TerminalSquare,
  Workflow,
} from "lucide-react";

const API_BASE = "http://127.0.0.1:8000/api";

// Keep this list aligned with MAIN_TOPICS in backend/app/api/routes.py.
// The backend groups detailed question-bank subtopics into these main subjects.
const MAIN_TOPICS = [
  "RAG",
  "Agentic AI",
  "Generative AI",
  "LLM",
  "AI Engineering",
  "MCP",
  "Operating System",
  "Computer Networks",
  "Python",
  "Coding Questions",
  "Machine Learning",
  "Deep Learning",
  "NLP",
  "SQL",
];

const TOPIC_ICONS = {
  RAG: Database,
  "Agentic AI": Bot,
  "Generative AI": Sparkles,
  LLM: BrainCircuit,
  "AI Engineering": Zap,
  MCP: Network,
  "Operating System": Laptop,
  "Computer Networks": Globe,
  Python: Code2,
  "Coding Questions": TerminalSquare,
  "Machine Learning": Target,
  "Deep Learning": Layers3,
  NLP: BookOpen,
  SQL: Database,
};

const NAVIGATION = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Practice Interview", icon: BrainCircuit },
  { label: "Question Bank", icon: BookOpen },
  { label: "Interview History", icon: History },
];

const CRITERIA = [
  { key: "technical_correctness", label: "Technical correctness" },
  { key: "completeness", label: "Completeness" },
  { key: "clarity", label: "Clarity" },
  { key: "structure", label: "Structure" },
];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg).join(", ")
          : "The request could not be completed.";
    throw new Error(message);
  }
  return data;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function countForTopic(questionCounts, topic) {
  const values = questionCounts?.[topic];
  if (!values) return 0;
  return Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0);
}

function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [topics, setTopics] = useState(MAIN_TOPICS);
  const [questionCounts, setQuestionCounts] = useState({});
  const [selectedTopic, setSelectedTopic] = useState("RAG");
  const [difficulty, setDifficulty] = useState("Medium");
  const [useWebSearch, setUseWebSearch] = useState(false);

  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [apiStatus, setApiStatus] = useState("checking");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  // State for the interview currently being taken.
  const [sessionId, setSessionId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  async function refreshDashboard() {
    const [statsResult, historyResult] = await Promise.allSettled([
      apiRequest("/dashboard/stats"),
      apiRequest("/interviews?limit=20"),
    ]);
    if (statsResult.status === "fulfilled") setStats(statsResult.value);
    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value.interviews ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        await apiRequest("/health");
        if (cancelled) return;
        setApiStatus("online");

        const [topicResult, countsResult] = await Promise.allSettled([
          apiRequest("/topics"),
          apiRequest("/question-counts"),
        ]);

        if (cancelled) return;
        if (topicResult.status === "fulfilled") {
          const apiTopics = topicResult.value.topics ?? [];
          // Preserve the requested display order while using the backend's
          // confirmed available categories. No subtopic is rendered as a card.
          const orderedTopics = MAIN_TOPICS.filter((topic) => apiTopics.includes(topic));
          const visibleTopics = orderedTopics.length ? orderedTopics : MAIN_TOPICS;
          setTopics(visibleTopics);
          setSelectedTopic((current) =>
            visibleTopics.includes(current) ? current : visibleTopics[0]
          );
        }
        if (countsResult.status === "fulfilled") {
          setQuestionCounts(countsResult.value.counts ?? {});
        }
        await refreshDashboard();
      } catch {
        if (!cancelled) setApiStatus("offline");
      }
    }

    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startInterview() {
    setLoading(true);
    setNotice("");
    try {
      const data = await apiRequest("/interviews/start", {
        method: "POST",
        body: JSON.stringify({
          topic: selectedTopic,
          difficulty,
          use_web_search: useWebSearch,
        }),
      });
      setSessionId(data.session_id);
      setCurrentQuestion(data.first_question);
      setAnswer("");
      setEvaluation(null);
      setPendingQuestion(null);
      setEvaluations([]);
      setCompleted(false);
      setActivePage("Practice Interview");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitAnswer() {
    if (!answer.trim()) {
      setNotice("Please enter your answer before submitting.");
      return;
    }
    if (!sessionId || !currentQuestion) {
      setNotice("No active interview found. Please start a new interview.");
      return;
    }

    setLoading(true);
    setNotice("");
    try {
      const data = await apiRequest("/interviews/answer", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          question_id: currentQuestion.question_id,
          answer: answer.trim(),
        }),
      });
      setEvaluation(data.evaluation);
      setEvaluations((previous) => [...previous, data.evaluation]);
      setPendingQuestion(data.next_question ?? null);
      setCompleted(Boolean(data.interview_completed));
      if (data.interview_completed) await refreshDashboard();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  function continueInterview() {
    if (!pendingQuestion) return;
    setCurrentQuestion(pendingQuestion);
    setPendingQuestion(null);
    setAnswer("");
    setEvaluation(null);
    setNotice("");
  }

  async function finishEarly() {
    if (!sessionId) return;
    if (!window.confirm("Are you sure you want to finish this interview early?")) return;
    setLoading(true);
    setNotice("");
    try {
      await apiRequest(`/interviews/${sessionId}/finish`, { method: "POST" });
      setCompleted(true);
      setPendingQuestion(null);
      setEvaluation(null);
      await refreshDashboard();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  function goToPage(page) {
    setActivePage(page);
    setMobileMenu(false);
    setNotice("");
  }

  function startNewInterview() {
    setCompleted(false);
    setEvaluation(null);
    setPendingQuestion(null);
    setEvaluations([]);
    setCurrentQuestion(null);
    setSessionId(null);
    setAnswer("");
    goToPage("Overview");
  }

  const completedCount = Number(stats?.completed_interviews ?? 0);
  const averageScore = Number(stats?.average_score ?? 0);
  const totalAnswered = Number(stats?.total_answers ?? 0);
  const totalQuestionCount = Object.values(questionCounts).reduce(
    (sum, item) => sum + Object.values(item).reduce((subSum, value) => subSum + Number(value || 0), 0),
    0
  );
  const sessionAverage = evaluations.length
    ? evaluations.reduce((sum, item) => sum + Number(item.final_score ?? 0), 0) / evaluations.length
    : 0;

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      {mobileMenu && (
        <button
          aria-label="Close navigation overlay"
          onClick={() => setMobileMenu(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/[0.07] bg-[#0d0d15] transition-transform lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[84px] items-center gap-3 border-b border-white/[0.07] px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent shadow-lg shadow-purple-900/30"><BrainCircuit size={23} /></div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight">Interview<span className="text-purple-400">IQ</span></h1>
            <p className="mt-0.5 text-[11px] text-zinc-500">AI Interview Coach</p>
          </div>
          <button className="ml-auto text-zinc-400 lg:hidden" onClick={() => setMobileMenu(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <div className="px-4 pt-7">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Workspace</p>
          <nav className="space-y-1">
            {NAVIGATION.map(({ label, icon: Icon }) => {
              const active = activePage === label;
              return (
                <button key={label} onClick={() => goToPage(label)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] transition ${active ? "border border-purple-400/15 bg-purple-500/10 font-medium text-purple-300" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}>
                  <Icon size={18} />{label}
                  {label === "Practice Interview" && <span className="ml-auto rounded-md bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-300">AI</span>}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-9 px-4">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Your preparation</p>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between"><span className="text-xs text-zinc-400">Questions answered</span><Target size={15} className="text-purple-400" /></div>
            <p className="text-2xl font-semibold tracking-tight">{totalAnswered}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(totalAnswered, 100)}%` }} /></div>
            <p className="mt-2 text-[10px] text-zinc-600">Keep practicing to improve</p>
          </div>
        </div>

        <div className="mt-auto p-4">
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/[0.06] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-700 text-xs font-bold">IQ</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">Your workspace</p><p className="mt-1 text-[10px] text-zinc-500">Personal preparation</p></div>
            <Settings size={15} className="text-zinc-500" />
          </div>
          <p className="text-center text-[10px] text-zinc-700">InterviewIQ · Local AI powered</p>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/[0.07] bg-[#09090f]/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button className="text-zinc-400 lg:hidden" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={21} /></button>
            <div><p className="text-[10px] text-zinc-600">WORKSPACE /</p><p className="mt-1 text-xs font-medium text-zinc-300">{activePage}</p></div>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <div className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] sm:flex ${apiStatus === "online" ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400" : apiStatus === "offline" ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-white/10 text-zinc-500"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${apiStatus === "online" ? "bg-emerald-400" : apiStatus === "offline" ? "bg-red-400" : "bg-zinc-500"}`} />
              {apiStatus === "online" ? "Backend connected" : apiStatus === "offline" ? "Backend offline" : "Connecting..."}
            </div>
            <Bell size={19} className="text-zinc-500" /><div className="hidden h-7 w-px bg-white/10 sm:block" />
            <button className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full border border-purple-400/20 bg-purple-500/10 text-[11px] font-semibold text-purple-300">IQ</div><ChevronDown size={14} className="text-zinc-500" /></button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
          {activePage === "Overview" && <OverviewPage topics={topics} questionCounts={questionCounts} selectedTopic={selectedTopic} setSelectedTopic={setSelectedTopic} difficulty={difficulty} setDifficulty={setDifficulty} useWebSearch={useWebSearch} setUseWebSearch={setUseWebSearch} stats={{ completedCount, averageScore, totalAnswered, topicCount: topics.length, totalQuestionCount }} history={history} loading={loading} notice={notice} onStart={startInterview} onHistory={() => goToPage("Interview History")} />}

          {activePage === "Practice Interview" && <InterviewPage sessionId={sessionId} topic={selectedTopic} difficulty={difficulty} currentQuestion={currentQuestion} answer={answer} setAnswer={setAnswer} evaluation={evaluation} pendingQuestion={pendingQuestion} evaluations={evaluations} completed={completed} sessionAverage={sessionAverage} loading={loading} notice={notice} onSubmit={submitAnswer} onContinue={continueInterview} onFinish={finishEarly} onStartNew={startNewInterview} onDashboard={() => goToPage("Overview")} />}

          {activePage === "Question Bank" && <QuestionBankPage topics={topics} questionCounts={questionCounts} onSelect={(topic) => { setSelectedTopic(topic); goToPage("Overview"); }} />}

          {activePage === "Interview History" && <HistoryPage history={history} />}
        </div>
      </main>
    </div>
  );
}

function OverviewPage({ topics, questionCounts, selectedTopic, setSelectedTopic, difficulty, setDifficulty, useWebSearch, setUseWebSearch, stats, history, loading, notice, onStart, onHistory }) {
  return (
    <>
      <section className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-3 flex items-center gap-2 text-xs text-purple-300"><Sparkles size={14} />YOUR PERSONAL AI MENTOR</div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prepare with purpose.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">Sharpen your technical skills, practice interview questions, and understand where you can improve.</p></div>
        <div className="flex items-center gap-2 text-xs text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-400" />Your progress is saved locally</div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Interviews completed" value={stats.completedCount} hint="Completed sessions" color="purple" />
        <StatCard icon={Target} label="Average score" value={`${stats.averageScore.toFixed(1)}/10`} hint="Across your answers" color="blue" />
        <StatCard icon={BookOpen} label="Questions answered" value={stats.totalAnswered} hint="Total practice answers" color="green" />
        <StatCard icon={Layers3} label="Questions available" value={stats.totalQuestionCount || "—"} hint={`${stats.topicCount} main topics`} color="amber" />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.85fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-surface p-5 sm:p-7">
          <div className="mb-7 flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2 text-xs text-purple-300"><BrainCircuit size={15} />MOCK INTERVIEW</div><h3 className="text-lg font-semibold">Start a practice session</h3><p className="mt-1 text-xs leading-5 text-zinc-500">All matching questions across the selected topic's subtopics will be asked one at a time.</p></div><div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10 text-purple-300 sm:flex"><Sparkles size={21} /></div></div>

          <label className="mb-3 block text-xs font-medium text-zinc-400">Select a topic</label>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {topics.map((topic) => {
              const Icon = TOPIC_ICONS[topic] || BrainCircuit;
              const selected = selectedTopic === topic;
              const count = countForTopic(questionCounts, topic);
              return <button key={topic} onClick={() => setSelectedTopic(topic)} className={`flex min-h-[105px] flex-col items-start justify-between rounded-xl border p-3 text-left transition ${selected ? "border-purple-400/50 bg-purple-500/[0.09] text-purple-200" : "border-white/[0.07] bg-white/[0.015] text-zinc-400 hover:border-white/20"}`}>
                <div className="flex w-full items-start justify-between gap-2"><Icon size={19} />{count > 0 && <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-zinc-500">{count}</span>}</div>
                <span className="mt-3 text-[11px] font-medium leading-4">{topic}</span>
              </button>;
            })}
          </div>

          {selectedTopic === "Coding Questions" && <p className="-mt-3 mb-5 text-[11px] leading-5 text-zinc-500">This section contains DSA practice only: arrays, strings, linked lists, stacks, queues, trees, graphs, searching, sorting, recursion, and dynamic programming.</p>}

          <label className="mb-3 block text-xs font-medium text-zinc-400">Difficulty level</label>
          <div className="mb-6 grid grid-cols-3 gap-3">{["Easy", "Medium", "Hard"].map((level) => <button key={level} onClick={() => setDifficulty(level)} className={`rounded-xl border py-3 text-xs font-medium transition ${difficulty === level ? "border-purple-400/40 bg-purple-500/10 text-purple-200" : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"}`}>{level}</button>)}</div>

          <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"><input type="checkbox" checked={useWebSearch} onChange={(event) => setUseWebSearch(event.target.checked)} className="mt-0.5 accent-purple-500" /><span><span className="flex items-center gap-2 text-xs font-medium text-zinc-300">Enable web research<span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] text-purple-300">OPTIONAL</span></span><span className="mt-1 block text-[11px] leading-5 text-zinc-500">Search for supporting references during answer evaluation.</span></span></label>

          <button onClick={onStart} disabled={loading || topics.length === 0} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-60">{loading ? <LoaderCircle size={17} className="animate-spin" /> : <Play size={16} fill="currentColor" />}{loading ? "Preparing interview..." : "Start interview"}{!loading && <ArrowRight size={16} />}</button>
          {notice && <ErrorNotice message={notice} />}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/[0.07] bg-surface p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><h3 className="text-sm font-semibold">Recent interviews</h3><button onClick={onHistory} className="flex items-center gap-1 text-[11px] text-purple-300">View all <ArrowUpRight size={13} /></button></div>
            {history.length ? <div className="space-y-4">{history.slice(0, 5).map((item, index) => <div key={item.id ?? index} className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400"><BrainCircuit size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{item.topic}</p><p className="mt-1 text-[10px] text-zinc-600">{item.difficulty} · {item.total_questions ?? 0} questions</p></div><span className="text-xs font-semibold">{Number(item.average_score ?? 0).toFixed(1)}</span></div>)}</div> : <EmptyState icon={Clock3} title="No interviews yet" description="Your completed sessions will appear here." />}
          </div>
          <div className="rounded-2xl border border-purple-400/15 bg-gradient-to-br from-purple-950/70 via-[#171127] to-surface p-6"><Sparkles size={23} className="mb-4 text-purple-300" /><h3 className="text-sm font-semibold">Feedback that helps you grow</h3><p className="mt-2 text-xs leading-6 text-zinc-400">Understand your strengths, identify missing concepts, and learn how to structure stronger answers.</p><div className="mt-4 flex items-center gap-2 text-[10px] text-purple-300"><CheckCircle2 size={13} />Evaluated using your local AI model</div></div>
        </div>
      </section>
    </>
  );
}

function InterviewPage({ sessionId, topic, difficulty, currentQuestion, answer, setAnswer, evaluation, pendingQuestion, evaluations, completed, sessionAverage, loading, notice, onSubmit, onContinue, onFinish, onStartNew, onDashboard }) {
  if (!sessionId) return <div className="mx-auto max-w-xl py-20 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-purple-400/20 bg-purple-500/10 text-purple-300"><BrainCircuit size={30} /></div><h2 className="text-xl font-semibold">Ready to practice?</h2><p className="mt-3 text-sm leading-6 text-zinc-500">Start an interview from the overview to receive questions and personalized AI feedback.</p><button onClick={onDashboard} className="mt-6 rounded-xl bg-purple-600 px-5 py-3 text-xs font-semibold hover:bg-purple-500">Configure interview</button></div>;

  if (completed) return <section className="mx-auto max-w-3xl">
    <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-7 sm:p-10"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300"><Trophy size={29} /></div><p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">Interview report</p><h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Interview completed!</h2><p className="mt-2 text-sm text-zinc-400">{topic} · {difficulty} difficulty</p><div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3"><ReportStat label="Questions evaluated" value={evaluations.length} /><ReportStat label="Average score" value={`${sessionAverage.toFixed(1)}/10`} /><ReportStat label="Session ID" value={sessionId} /></div></div>
    <div className="mb-6 rounded-2xl border border-white/[0.07] bg-surface p-6"><h3 className="mb-5 text-sm font-semibold">Answer breakdown</h3>{evaluations.length ? <div className="space-y-4">{evaluations.map((item, index) => <div key={`${index}-${item.final_score}`} className="flex items-center gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-xs text-zinc-400">{index + 1}</span><div className="flex-1"><div className="mb-2 flex justify-between gap-3 text-xs"><span className="text-zinc-300">Question {index + 1}</span><span className="font-semibold text-purple-300">{Number(item.final_score ?? 0).toFixed(1)}/10</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.max(0, Math.min(Number(item.final_score ?? 0) * 10, 100))}%` }} /></div></div></div>)}</div> : <p className="text-xs text-zinc-500">No answers were evaluated in this session.</p>}</div>
    <div className="flex flex-wrap gap-3"><button onClick={onStartNew} className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-xs font-semibold hover:bg-purple-500"><RotateCcw size={15} />Start another interview</button><button onClick={onDashboard} className="rounded-xl border border-white/10 px-5 py-3 text-xs text-zinc-300 hover:bg-white/[0.04]">Return to overview</button></div>
  </section>;

  return <section className="mx-auto max-w-4xl">
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><button onClick={onDashboard} className="mb-4 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-200"><ArrowLeft size={14} />Back to overview</button><h2 className="text-2xl font-semibold tracking-tight">Practice Interview</h2><p className="mt-2 text-sm text-zinc-500">{topic} <span className="mx-2 text-zinc-700">/</span> {difficulty}</p></div><div className="flex items-center gap-2 self-start rounded-full border border-purple-400/20 bg-purple-500/[0.07] px-3 py-2 text-xs text-purple-300"><Sparkles size={14} />AI Interview Session</div></div>
    <div className="mb-6 rounded-2xl border border-white/[0.07] bg-surface p-5 sm:p-7"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">Current question</p><p className="mt-2 text-xs text-zinc-400">Question {evaluations.length + 1}</p></div><div className="flex items-center gap-2"><span className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-400">{currentQuestion?.topic ?? topic}</span><span className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-400">{currentQuestion?.difficulty ?? difficulty}</span><span className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-400">{currentQuestion?.question_type ?? "conceptual"}</span></div></div>
      <h3 className="text-lg font-medium leading-8 sm:text-xl">{currentQuestion?.question ?? "No question is currently available. Please start a new interview."}</h3>
      {!evaluation && <><label htmlFor="candidate-answer" className="mb-3 mt-7 block text-xs font-medium text-zinc-400">Your answer</label><textarea id="candidate-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={loading} placeholder="Explain your approach and include examples where helpful..." rows={9} className="w-full resize-y rounded-xl border border-white/10 bg-[#0c0c14] p-4 text-sm leading-7 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-purple-400/50 disabled:opacity-60" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-zinc-600">Take your time. Clear, well-structured answers work best.</p><span className="text-[10px] text-zinc-600">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words</span></div>{notice && <ErrorNotice message={notice} />}<div className="mt-6 flex flex-wrap gap-3"><button onClick={onSubmit} disabled={loading || !currentQuestion} className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-xs font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}{loading ? "Evaluating your answer..." : "Submit answer"}</button><button onClick={onFinish} disabled={loading || evaluations.length === 0} className="rounded-xl border border-white/10 px-5 py-3 text-xs text-zinc-400 hover:bg-white/[0.04] disabled:opacity-40">Finish early</button></div></>}
    </div>
    {evaluation && <EvaluationPanel evaluation={evaluation} loading={loading} hasNext={Boolean(pendingQuestion)} onContinue={onContinue} onFinish={onFinish} />}
  </section>;
}

function EvaluationPanel({ evaluation, loading, hasNext, onContinue, onFinish }) {
  const score = Number(evaluation.final_score ?? 0);
  return <section className="space-y-6">
    <div className="rounded-2xl border border-purple-400/20 bg-gradient-to-br from-purple-950/40 to-surface p-6 sm:p-7"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="text-xs text-purple-300">AI EVALUATION</p><h3 className="mt-2 text-lg font-semibold">Your answer has been evaluated</h3><p className="mt-2 text-xs text-zinc-500">Review the feedback before moving on.</p></div><div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border border-purple-400/20 bg-purple-500/10"><span className="text-3xl font-bold text-purple-200">{score.toFixed(1)}</span><span className="text-[10px] text-zinc-500">out of 10</span></div></div>
      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">{CRITERIA.map(({ key, label }) => { const criterion = evaluation[key] ?? {}; const criterionScore = Number(criterion.score ?? 0); return <div key={key} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="mb-2 flex justify-between gap-3 text-xs"><span className="text-zinc-300">{label}</span><span className="font-semibold text-purple-300">{criterionScore}/5</span></div><div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(Math.max(criterionScore, 0) * 20, 100)}%` }} /></div><p className="text-[11px] leading-5 text-zinc-500">{criterion.reason || "No additional feedback provided."}</p></div>; })}</div>
    </div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><FeedbackList title="Strengths" icon={CheckCircle2} items={evaluation.strengths} emptyText="No specific strengths were returned." color="green" /><FeedbackList title="Areas to improve" icon={Target} items={evaluation.missing_points} emptyText="No missing points were identified." color="amber" /></div>
    <TextPanel title="Reference answer" text={evaluation.reference_answer} /><TextPanel title="How to improve your answer" text={evaluation.improved_answer} />
    {evaluation.search_note && <div className="rounded-xl border border-white/[0.07] bg-surface p-4 text-xs leading-6 text-zinc-400"><p className="mb-1 font-medium text-zinc-300">Research notes</p>{evaluation.search_note}</div>}
    {Array.isArray(evaluation.sources) && evaluation.sources.length > 0 && <div className="rounded-2xl border border-white/[0.07] bg-surface p-5"><h3 className="mb-4 text-sm font-semibold">Supporting sources</h3><div className="space-y-3">{evaluation.sources.map((source, index) => <a key={source.url || index} href={source.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 text-xs text-purple-300 hover:text-purple-200"><ExternalLink size={14} className="mt-0.5 shrink-0" /><span className="break-words">{source.title || source.url}{source.snippet && <span className="mt-1 block leading-5 text-zinc-500">{source.snippet}</span>}</span></a>)}</div></div>}
    <div className="flex flex-wrap gap-3">{hasNext ? <button onClick={onContinue} disabled={loading} className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-xs font-semibold hover:bg-purple-500 disabled:opacity-50">Next question <ArrowRight size={15} /></button> : <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-4 py-3 text-xs text-emerald-300"><CheckCircle2 size={15} className="mr-2 inline" />Interview completed. Your report is ready.</div>}<button onClick={onFinish} disabled={loading} className="rounded-xl border border-white/10 px-5 py-3 text-xs text-zinc-400 hover:bg-white/[0.04] disabled:opacity-40">Finish early</button></div>
  </section>;
}

function FeedbackList({ title, icon: Icon, items, emptyText, color }) {
  const accent = color === "green" ? "text-emerald-300" : "text-amber-300";
  return <div className="rounded-2xl border border-white/[0.07] bg-surface p-5"><h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Icon size={17} className={accent} />{title}</h3>{Array.isArray(items) && items.length > 0 ? <ul className="space-y-3">{items.map((item, index) => <li key={`${index}-${item}`} className="flex items-start gap-3 text-xs leading-6 text-zinc-400"><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${color === "green" ? "bg-emerald-400" : "bg-amber-400"}`} />{item}</li>)}</ul> : <p className="text-xs leading-6 text-zinc-500">{emptyText}</p>}</div>;
}

function TextPanel({ title, text }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-surface p-5 sm:p-6"><h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} className="text-purple-300" />{title}</h3><p className="whitespace-pre-wrap text-xs leading-7 text-zinc-400">{text || "No answer was provided by the evaluator."}</p></div>;
}

function QuestionBankPage({ topics, questionCounts, onSelect }) {
  return <section><PageHeading title="Question Bank" description="Browse your 14 main preparation areas. Their detailed subtopics are grouped under the relevant main topic." /><div className="mb-5 rounded-xl border border-white/[0.07] bg-surface p-4 text-xs leading-6 text-zinc-400"><strong className="text-zinc-200">Coding Questions</strong> is reserved for DSA practice only. Python, SQL, RAG, LLM, and MCP implementation questions remain in their respective main topics.</div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{topics.map((topic) => { const Icon = TOPIC_ICONS[topic] || BookOpen; const counts = questionCounts[topic] ?? {}; const total = countForTopic(questionCounts, topic); return <button key={topic} onClick={() => onSelect(topic)} className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-surface p-5 text-left transition hover:border-purple-400/30"><div className="rounded-xl bg-purple-500/10 p-3 text-purple-300"><Icon size={21} /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{topic}</p><p className="mt-1 text-xs text-zinc-500">{total} questions · Easy {counts.Easy ?? 0} · Medium {counts.Medium ?? 0} · Hard {counts.Hard ?? 0}</p></div><ArrowRight size={16} className="text-zinc-600" /></button>; })}</div></section>;
}

function HistoryPage({ history }) {
  return <section><PageHeading title="Interview History" description="Review your saved practice sessions and scores." />{history.length > 0 ? <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-surface"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-white/[0.07] text-zinc-500"><tr><th className="p-4 font-medium">Topic</th><th className="p-4 font-medium">Difficulty</th><th className="p-4 font-medium">Questions</th><th className="p-4 font-medium">Average score</th><th className="p-4 font-medium">Status</th><th className="p-4 font-medium">Date</th></tr></thead><tbody>{history.map((item, index) => <tr key={item.id ?? index} className="border-b border-white/[0.04] last:border-0"><td className="p-4 font-medium">{item.topic}</td><td className="p-4 text-zinc-400">{item.difficulty}</td><td className="p-4 text-zinc-400">{item.total_questions ?? 0}</td><td className="p-4 text-zinc-300">{Number(item.average_score ?? 0).toFixed(1)}/10</td><td className="p-4"><span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-zinc-400">{item.status ?? "in progress"}</span></td><td className="p-4 text-zinc-500">{formatDate(item.started_at)}</td></tr>)}</tbody></table></div> : <EmptyState icon={History} title="No interview history yet" description="Complete a practice session to see it here." />}</section>;
}

function StatCard({ icon: Icon, label, value, hint, color }) {
  const colorClasses = { purple: "bg-purple-500/10 text-purple-300", blue: "bg-blue-500/10 text-blue-300", green: "bg-emerald-500/10 text-emerald-300", amber: "bg-amber-500/10 text-amber-300" };
  return <div className="rounded-2xl border border-white/[0.07] bg-surface p-5 transition hover:border-white/[0.13]"><div className="flex items-center justify-between"><div className={`rounded-xl p-2.5 ${colorClasses[color]}`}><Icon size={18} /></div><ArrowUpRight size={15} className="text-zinc-700" /></div><p className="mt-5 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-zinc-400">{label}</p><p className="mt-2 text-[10px] text-zinc-600">{hint}</p></div>;
}

function ReportStat({ label, value }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><p className="text-[10px] text-zinc-500">{label}</p><p className="mt-2 break-words text-xl font-semibold">{value}</p></div>;
}

function PageHeading({ title, description }) {
  return <div className="mb-7"><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="mt-2 text-sm text-zinc-500">{description}</p></div>;
}

function EmptyState({ icon: Icon, title, description }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-surface px-5 py-12 text-center"><Icon size={25} className="mx-auto mb-3 text-zinc-600" /><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-xs text-zinc-500">{description}</p></div>;
}

function ErrorNotice({ message }) {
  return <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-500/[0.06] p-3 text-xs leading-5 text-red-300"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span>{message}</span></div>;
}

export default App;
