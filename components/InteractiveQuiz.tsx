'use client';

import { useState } from 'react';

interface Question {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  option_explanations?: Record<string, string>;
}

interface InteractiveQuizProps {
  quizData: Question[];
}

export default function InteractiveQuiz({ quizData }: InteractiveQuizProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isFinished, setIsFinished] = useState(false);

  const currentQuestion = quizData[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === quizData.length - 1;
  const hasAnswered = selectedAnswer !== null;

  const normalizeAnswerLetter = (value: string) => {
    const match = String(value).toUpperCase().match(/[A-D]/);
    return match ? match[0] : '';
  };

  const stripOptionPrefix = (value: string) => {
    return String(value).replace(/^\s*[A-Da-d]\s*[)\.:-]\s*/, '').trim();
  };

  const correctAnswerLetter = normalizeAnswerLetter(currentQuestion.answer);
  const optionExplanations = currentQuestion.option_explanations ?? {};

  const getExplanationForLetter = (letter: string): string => {
    const normalizedLetter = normalizeAnswerLetter(letter);
    if (!normalizedLetter) return '';
    return String(optionExplanations[normalizedLetter] ?? '').trim();
  };

  const selectedOptionExplanation = selectedAnswer ? getExplanationForLetter(selectedAnswer) : '';
  const correctOptionExplanation = getExplanationForLetter(correctAnswerLetter);
  const genericCorrectExplanation = String(currentQuestion.explanation ?? '').trim();
  const correctAnswerExplanation = correctOptionExplanation || genericCorrectExplanation;

  const handleOptionClick = (optionIndex: number) => {
    if (hasAnswered) return;

    const selectedLetter = String.fromCharCode(65 + optionIndex);
    setSelectedAnswer(selectedLetter);

    if (selectedLetter === correctAnswerLetter) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    if (isLastQuestion) {
      setIsFinished(true);
      return;
    }

    setCurrentQuestionIndex((prev) => prev + 1);
    setSelectedAnswer(null);
  };

  const handleRetakeQuiz = () => {
    setCurrentQuestionIndex(0);
    setScore(0);
    setSelectedAnswer(null);
    setIsFinished(false);
  };

  const getOptionButtonClass = (optionIndex: number): string => {
    const optionLetter = String.fromCharCode(65 + optionIndex);
    let className =
      'flex w-full items-center rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors';

    if (!hasAnswered) {
      className +=
        ' border-slate-300 bg-white text-slate-700 hover:border-gtGold hover:bg-gtGold/10 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-gtGold dark:hover:bg-gtGold/10';
      return className;
    }

    if (optionLetter === correctAnswerLetter) {
      className +=
        ' border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-200';
    } else if (optionLetter === selectedAnswer) {
      className +=
        ' border-red-300 bg-red-50 text-red-800 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-200';
    } else {
      className +=
        ' border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }

    return className;
  };

  const getOptionLabelClass = (optionIndex: number): string => {
    const optionLetter = String.fromCharCode(65 + optionIndex);

    if (!hasAnswered) {
      return 'mr-3 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200';
    }

    if (optionLetter === correctAnswerLetter) {
      return 'mr-3 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-100';
    }

    if (optionLetter === selectedAnswer) {
      return 'mr-3 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-100 text-xs font-semibold text-red-700 dark:bg-red-500/25 dark:text-red-100';
    }

    return 'mr-3 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300';
  };

  if (isFinished) {
    return (
      <div className="mx-5 mt-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-100">Quiz Completed!</h2>
        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-6 py-8 dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-3 text-base font-medium text-slate-700 dark:text-slate-200">
            Your Score: <span className="text-3xl font-bold text-gtNavy dark:text-gtGold">{score}</span> / {quizData.length}
          </p>
          <p className="text-xl font-semibold text-slate-700 dark:text-slate-200">{Math.round((score / quizData.length) * 100)}%</p>
        </div>
        <button
          onClick={handleRetakeQuiz}
          className="rounded-lg bg-gtGold px-6 py-3 text-sm font-semibold text-gtNavy transition-colors hover:bg-[#c7b887]"
        >
          Retake Quiz
        </button>
      </div>
    );
  }

  return (
    <div className="mx-5 mt-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8">
      <div className="mb-7 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
          Question {currentQuestionIndex + 1} of {quizData.length}
        </span>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">Score: {score}/{quizData.length}</span>
      </div>

      <h2 className="mb-6 text-lg font-semibold leading-relaxed text-slate-900 dark:text-slate-100">{currentQuestion.question}</h2>

      <div className="mb-5 flex flex-col gap-2.5">
        {currentQuestion.options.map((option, index) => (
          <button
            key={index}
            className={getOptionButtonClass(index)}
            onClick={() => handleOptionClick(index)}
            disabled={hasAnswered}
          >
            <span className={getOptionLabelClass(index)}>{String.fromCharCode(65 + index)}.</span>
            <span className="flex-1">{stripOptionPrefix(option)}</span>
          </button>
        ))}
      </div>

      {hasAnswered && (
        <div className="mb-5 text-center">
          {selectedAnswer === correctAnswerLetter ? (
            <>
              <p className="rounded-md bg-emerald-50 p-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Correct!</p>
              {correctAnswerExplanation && (
                <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-left text-sm text-emerald-800 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-200">
                  Why this is correct: {correctAnswerExplanation}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="rounded-md bg-red-50 p-2.5 text-sm font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-200">
                Incorrect - The correct answer is {correctAnswerLetter}
              </p>
              {selectedOptionExplanation && (
                <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-left text-sm text-red-800 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-200">
                  Why your answer is incorrect: {selectedOptionExplanation}
                </p>
              )}
              {correctAnswerExplanation && (
                <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-left text-sm text-emerald-800 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-200">
                  Why the correct answer is right: {correctAnswerExplanation}
                </p>
              )}
              {!selectedOptionExplanation && !correctAnswerExplanation && (
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-300">
                  The correct answer is highlighted in green above.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {hasAnswered && (
        <button
          onClick={handleNextQuestion}
          className="w-full rounded-lg bg-gtGold px-4 py-3 text-sm font-semibold text-gtNavy transition-colors hover:bg-[#c7b887]"
        >
          {isLastQuestion ? 'View Results' : 'Next Question'}
        </button>
      )}
    </div>
  );
}
