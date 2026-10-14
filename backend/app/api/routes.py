"""REST API endpoints for the AI Interview Coach.

The API exposes a compact set of main subjects while preserving the detailed
subtopic on every question. Coding Questions is reserved for DSA problems only;
Python, SQL, RAG, LLM, and MCP implementation questions stay under their own
subjects.
"""

import json
import logging
import random
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.config import QUESTION_BANK_PATH
from app.database import (
    complete_interview,
    create_interview,
    get_dashboard_stats,
    get_interview_details,
    get_interview_history,
    save_answer,
)
from app.schemas import (
    DashboardStats,
    EvaluationResponse,
    InterviewHistoryResponse,
    InterviewSummary,
    MessageResponse,
    StartInterviewRequest,
    StartInterviewResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
)
from app.services.interview_agent import evaluate_candidate_answer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Interview Coach"])


# These are the only subject cards the frontend should display.
MAIN_TOPICS = [
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
    "Statistics",
]

# These topic labels in the `coding_*` group represent DSA problem families.
# Other coding_* entries (Python basics, SQL, and general practical coding) do
# not go into the Coding Questions section.
DSA_SUBTOPICS = {
    "strings",
    "arrays",
    "hash maps and sets",
    "two pointers and sliding window",
    "linked lists",
    "stacks and queues",
    "searching and sorting",
    "recursion and backtracking",
    "binary trees and bst",
    "graphs",
    "dynamic programming",
}

# Statistics has its own question-ID group. A small set of Machine Learning
# Engineering questions under the `aieng_*` IDs is assigned to Machine Learning
# by its detailed subtopic in canonical_topic().
QUESTION_ID_PREFIX_TO_MAIN_TOPIC = {
    "rag": "RAG",
    "agenticai": "Agentic AI",
    "llmgenai": "Generative AI",
    "llm": "LLM",
    "aieng": "AI Engineering",
    "mcp": "MCP",
    "os": "Operating System",
    "networking": "Computer Networks",
    "python": "Python",
    "statistics": "Statistics",
    "deeplearning": "Deep Learning",
    "nlp": "NLP",
}


def canonical_topic(item: dict[str, Any]) -> str | None:
    """Return the compact main subject for a question, or None if unmapped."""
    question_id = str(item.get("question_id", "")).strip().casefold()
    original_topic = str(item.get("topic", "")).strip()
    normalized_topic = original_topic.casefold()

    # Special handling for the separate coding collection.
    if question_id.startswith("coding_"):
        if normalized_topic in DSA_SUBTOPICS:
            return "Coding Questions"
        if normalized_topic == "sql coding" or "sql" in normalized_topic:
            return "SQL"
        if normalized_topic == "python fundamentals":
            return "Python"
        if normalized_topic == "practical coding and debugging":
            # coding_099 is a Python data-cleaning implementation problem;
            # coding_100 is an API rate-limiter design problem.
            if question_id == "coding_100":
                return "AI Engineering"
            return "Python"
        return None

    # A small set of questions in the `aieng_*` group are explicitly about
    # Machine Learning Engineering. Keep them under Machine Learning instead
    # of grouping them all under AI Engineering just because of their ID prefix.
    if normalized_topic == "machine learning engineering":
        return "Machine Learning"

    prefix = question_id.split("_", maxsplit=1)[0]
    return QUESTION_ID_PREFIX_TO_MAIN_TOPIC.get(prefix)


def load_question_bank() -> list[dict[str, Any]]:
    """Load and validate the local question-only JSON bank."""
    if not QUESTION_BANK_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=(
                "Question bank not found. Add "
                "backend/data/raw/question_bank.json first."
            ),
        )

    try:
        raw_data = json.loads(QUESTION_BANK_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.exception("Could not read question bank.")
        raise HTTPException(
            status_code=500,
            detail="Question bank could not be read as valid JSON.",
        ) from exc

    # Accept either a JSON list or {"questions": [...]}.
    if isinstance(raw_data, dict):
        raw_data = raw_data.get("questions", [])

    if not isinstance(raw_data, list):
        raise HTTPException(
            status_code=500,
            detail="Question bank must contain a list of questions.",
        )

    valid_questions: list[dict[str, Any]] = []
    for index, item in enumerate(raw_data):
        if not isinstance(item, dict):
            continue

        question = item.get("question")
        topic = item.get("topic")
        difficulty = item.get("difficulty", "Medium")
        question_id = item.get("question_id", f"q{index + 1}")
        question_type = item.get("question_type", "conceptual")

        if not isinstance(question, str) or not question.strip():
            continue
        if not isinstance(topic, str) or not topic.strip():
            continue
        if difficulty not in ("Easy", "Medium", "Hard"):
            difficulty = "Medium"
        if not isinstance(question_type, str) or not question_type.strip():
            question_type = "conceptual"

        normalized_item = {
            "question_id": str(question_id),
            # Keep the detailed subtopic; the canonical main topic is computed
            # separately so no source information is lost.
            "topic": topic.strip(),
            "difficulty": difficulty,
            "question": question.strip(),
            "question_type": question_type.strip(),
        }
        normalized_item["main_topic"] = canonical_topic(normalized_item)
        valid_questions.append(normalized_item)

    if not valid_questions:
        raise HTTPException(
            status_code=500,
            detail="Question bank contains no valid questions.",
        )

    return valid_questions


def public_question(item: dict[str, Any]) -> dict[str, str]:
    """Expose the original subtopic with the question shown to the candidate."""
    return {
        "question_id": str(item["question_id"]),
        "topic": str(item["topic"]),
        "difficulty": str(item["difficulty"]),
        "question": str(item["question"]),
        "question_type": str(item.get("question_type", "conceptual")),
    }


# SQLite stores interview history and answers. This dictionary tracks the
# question order for active sessions in this single local development server.
active_sessions: dict[int, dict[str, Any]] = {}

# Remember recent randomized starts for each subject/difficulty in this process.
# This prevents the first question from repeating across consecutive practice
# sessions (when the selected set contains more than one question).
recent_first_question_ids: dict[tuple[str, str], list[str]] = {}
last_question_orders: dict[tuple[str, str], tuple[str, ...]] = {}


def randomize_question_order(
    questions: list[dict[str, Any]],
    topic: str,
    difficulty: str,
) -> list[dict[str, Any]]:
    """Shuffle a fresh copy, avoiding recently repeated opening questions.

    All selected questions still appear exactly once in each session. This is
    ordering from the question bank, not LLM-generated question content.
    """
    shuffled = list(questions)
    if len(shuffled) <= 1:
        return shuffled

    rng = random.SystemRandom()
    rng.shuffle(shuffled)
    key = (topic.casefold(), difficulty.casefold())

    # Avoid repeating the exact same full order in back-to-back sessions.
    previous_order = last_question_orders.get(key)
    current_order = tuple(str(item["question_id"]) for item in shuffled)
    if current_order == previous_order:
        shuffled.append(shuffled.pop(0))

    # Avoid repeating one of the recent opening questions, if possible.
    recent_firsts = recent_first_question_ids.setdefault(key, [])
    recent_first_set = set(recent_firsts)
    if str(shuffled[0]["question_id"]) in recent_first_set:
        alternatives = [
            index for index in range(1, len(shuffled))
            if str(shuffled[index]["question_id"]) not in recent_first_set
        ]
        if alternatives:
            swap_index = rng.choice(alternatives)
            shuffled[0], shuffled[swap_index] = shuffled[swap_index], shuffled[0]
        else:
            # If recent history covers the whole set, clear it and still avoid
            # repeating the immediately previous first question.
            previous_first = recent_firsts[-1] if recent_firsts else None
            recent_firsts.clear()
            if str(shuffled[0]["question_id"]) == previous_first:
                rng_index = rng.randrange(1, len(shuffled))
                shuffled[0], shuffled[rng_index] = shuffled[rng_index], shuffled[0]

    first_id = str(shuffled[0]["question_id"])
    recent_firsts.append(first_id)
    del recent_firsts[:-5]  # Retain the last five first questions per quiz.
    last_question_orders[key] = tuple(str(item["question_id"]) for item in shuffled)
    return shuffled


# ---------------------------------------------------------
# Health and configuration
# ---------------------------------------------------------

@router.get("/health")
def health_check() -> dict[str, str]:
    """Basic API health endpoint; it does not call the LLM."""
    return {"status": "ok", "service": "AI Interview Coach API"}


@router.get("/topics")
def get_topics() -> dict[str, list[str]]:
    """Return only the configured main subject categories, in display order."""
    questions = load_question_bank()
    available = {item.get("main_topic") for item in questions}
    return {"topics": [topic for topic in MAIN_TOPICS if topic in available]}


@router.get("/question-counts")
def get_question_counts() -> dict[str, Any]:
    """Count questions by main topic and difficulty, not by subtopic."""
    questions = load_question_bank()
    counts: dict[str, dict[str, int]] = {
        topic: {"Easy": 0, "Medium": 0, "Hard": 0}
        for topic in MAIN_TOPICS
    }

    for item in questions:
        topic = item.get("main_topic")
        if topic not in counts:
            continue
        counts[topic][item["difficulty"]] += 1

    # Omit categories that have no questions in the loaded bank.
    counts = {
        topic: by_difficulty
        for topic, by_difficulty in counts.items()
        if sum(by_difficulty.values()) > 0
    }
    return {"counts": counts}


@router.get("/questions")
def list_topic_questions(
    topic: str = Query(..., min_length=1, description="A main topic from /api/topics"),
) -> dict[str, Any]:
    """Return every question belonging to one main topic for Question Bank browsing.

    The topic filter uses each question's canonical main topic, so detailed
    labels such as Chunking or MCP Security remain visible as subtopics without
    becoming separate top-level categories.
    """
    selected_topic = next(
        (name for name in MAIN_TOPICS if name.casefold() == topic.strip().casefold()),
        None,
    )
    if selected_topic is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported topic '{topic}'. Choose one of: " + ", ".join(MAIN_TOPICS),
        )

    questions = [
        item for item in load_question_bank()
        if item.get("main_topic") == selected_topic
    ]
    if not questions:
        raise HTTPException(
            status_code=404,
            detail=f"No questions found for topic '{selected_topic}'.",
        )

    subtopics = sorted({str(item["topic"]) for item in questions}, key=str.casefold)
    return {
        "topic": selected_topic,
        "total": len(questions),
        "subtopics": subtopics,
        "questions": [
            {
                **public_question(item),
                "main_topic": selected_topic,
            }
            for item in questions
        ],
    }


# ---------------------------------------------------------
# Dashboard
# ---------------------------------------------------------

@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats() -> dict[str, Any]:
    """Return real statistics from SQLite."""
    return get_dashboard_stats()


@router.get("/interviews", response_model=InterviewHistoryResponse)
def list_interviews(
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Return recent saved interview sessions."""
    rows = get_interview_history(limit=limit)
    interviews = [
        InterviewSummary(
            id=row["id"],
            topic=row["topic"],
            difficulty=row["difficulty"],
            started_at=row["started_at"],
            completed_at=row.get("completed_at"),
            total_questions=row["total_questions"],
            average_score=row["average_score"],
            status=row["status"],
        )
        for row in rows
    ]
    return {"interviews": interviews}


@router.get("/interviews/{interview_id}")
def interview_details(interview_id: int) -> dict[str, Any]:
    """Return a saved interview and its evaluated answers."""
    details = get_interview_details(interview_id)
    if details is None:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return details


# ---------------------------------------------------------
# Start interview
# ---------------------------------------------------------

@router.post("/interviews/start", response_model=StartInterviewResponse)
def start_interview(request: StartInterviewRequest) -> dict[str, Any]:
    """Start an interview with all questions belonging to a selected main topic.

    Subtopics are grouped behind their parent subject. The special Coding
    Questions subject includes only the DSA subtopic families defined above.
    If a selected difficulty has no matches, all difficulties for that main
    subject are used as a fallback.
    """
    selected_topic = next(
        (
            topic
            for topic in MAIN_TOPICS
            if topic.casefold() == request.topic.strip().casefold()
        ),
        None,
    )
    if selected_topic is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported topic '{request.topic}'. Choose one of: "
                + ", ".join(MAIN_TOPICS)
            ),
        )

    question_bank = load_question_bank()
    topic_questions = [
        item for item in question_bank
        if item.get("main_topic") == selected_topic
    ]

    if not topic_questions:
        raise HTTPException(
            status_code=404,
            detail=f"No questions found for topic '{selected_topic}'.",
        )

    matching = [
        item for item in topic_questions
        if item["difficulty"].casefold() == request.difficulty.casefold()
    ]
    chosen_questions = randomize_question_order(
        list(matching if matching else topic_questions),
        selected_topic,
        request.difficulty,
    )

    session_id = create_interview(
        topic=selected_topic,
        difficulty=request.difficulty,
        total_questions=len(chosen_questions),
    )

    active_sessions[session_id] = {
        "topic": selected_topic,
        "difficulty": request.difficulty,
        "use_web_search": request.use_web_search,
        "questions": chosen_questions,
        "current_index": 0,
        "answered_question_ids": set(),
    }

    return {
        "session_id": session_id,
        "topic": selected_topic,
        "difficulty": request.difficulty,
        "total_questions": len(chosen_questions),
        "first_question": public_question(chosen_questions[0]),
    }


# ---------------------------------------------------------
# Submit answer and return the next question
# ---------------------------------------------------------

@router.post("/interviews/answer", response_model=SubmitAnswerResponse)
def submit_answer(request: SubmitAnswerRequest) -> dict[str, Any]:
    """Evaluate one answer, save it, and provide interview progress."""
    session_id = request.session_id
    session = active_sessions.get(session_id)

    if session is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Active interview not found. The session may have been "
                "completed or the API server restarted."
            ),
        )

    if request.question_id in session["answered_question_ids"]:
        raise HTTPException(
            status_code=409,
            detail="This question has already been evaluated.",
        )

    questions = session["questions"]
    index = session["current_index"]
    if index >= len(questions):
        raise HTTPException(
            status_code=409,
            detail="All questions in this interview have been answered.",
        )

    current_question = questions[index]
    if str(current_question["question_id"]) != request.question_id:
        raise HTTPException(
            status_code=409,
            detail="The submitted question does not match the current question.",
        )

    if not request.answer.strip():
        raise HTTPException(
            status_code=422,
            detail="Please enter an answer before submitting.",
        )

    try:
        evaluation = evaluate_candidate_answer(
            question=current_question["question"],
            candidate_answer=request.answer.strip(),
            topic=session["topic"],
            search_enabled=session["use_web_search"],
        )
        save_answer(
            interview_id=session_id,
            question_id=str(current_question["question_id"]),
            question=current_question["question"],
            candidate_answer=request.answer.strip(),
            evaluation=evaluation,
        )
    except Exception as exc:
        logger.exception("Answer evaluation failed.")
        raise HTTPException(
            status_code=502,
            detail=(
                "Answer evaluation failed. Check that Ollama is running "
                "and the local model is available, then retry. "
                f"Error type: {type(exc).__name__}"
            ),
        ) from exc

    session["answered_question_ids"].add(request.question_id)
    session["current_index"] += 1
    evaluated_count = session["current_index"]
    total_questions = len(questions)
    interview_completed = evaluated_count >= total_questions

    next_question = None
    if interview_completed:
        complete_interview(session_id)
    else:
        next_question = public_question(questions[session["current_index"]])

    return {
        "session_id": session_id,
        "question_id": request.question_id,
        "evaluation": evaluation,
        "evaluated_count": evaluated_count,
        "total_questions": total_questions,
        "next_question": next_question,
        "interview_completed": interview_completed,
    }


# ---------------------------------------------------------
# Finish interview early
# ---------------------------------------------------------

@router.post("/interviews/{interview_id}/finish", response_model=MessageResponse)
def finish_interview(interview_id: int) -> dict[str, str]:
    """Allow the candidate to finish early and save the partial report."""
    session = active_sessions.get(interview_id)
    if session is None:
        details = get_interview_details(interview_id)
        if details is None:
            raise HTTPException(status_code=404, detail="Interview not found.")
        if details["interview"]["status"] == "completed":
            return {"message": "Interview was already completed."}
        raise HTTPException(
            status_code=404,
            detail="Active interview session not found.",
        )

    complete_interview(interview_id)
    active_sessions.pop(interview_id, None)
    return {"message": "Interview completed and saved."}
