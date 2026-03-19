'use client';

import { useState } from 'react';
import './InteractiveQuiz.css';

interface Question {
  question: string;
  options: string[];
  answer: string;
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
    let className = 'option-button';

    if (!hasAnswered) {
      className += ' inactive';
      return className;
    }

    if (optionLetter === correctAnswerLetter) {
      className += ' correct';
    } else if (optionLetter === selectedAnswer) {
      className += ' incorrect';
    }

    return className;
  };

  if (isFinished) {
    return (
      <div className="results-card">
        <h2>Quiz Completed!</h2>
        <div className="score-display">
          <p className="final-score">
            Your Score: <span className="score-number">{score}</span> / {quizData.length}
          </p>
          <p className="percentage">{Math.round((score / quizData.length) * 100)}%</p>
        </div>
        <button onClick={handleRetakeQuiz} className="restart-button">
          Retake Quiz
        </button>
      </div>
    );
  }

  return (
    <div className="quiz-card">
      <div className="quiz-header">
        <span className="question-counter">
          Question {currentQuestionIndex + 1} of {quizData.length}
        </span>
        <span className="score-counter">Score: {score}/{quizData.length}</span>
      </div>

      <h2 className="question-text">{currentQuestion.question}</h2>

      <div className="options-container">
        {currentQuestion.options.map((option, index) => (
          <button
            key={index}
            className={getOptionButtonClass(index)}
            onClick={() => handleOptionClick(index)}
            disabled={hasAnswered}
          >
            <span className="option-label">{String.fromCharCode(65 + index)}.</span>
            <span className="option-text">{stripOptionPrefix(option)}</span>
          </button>
        ))}
      </div>

      {hasAnswered && (
        <div className="feedback-section">
          {selectedAnswer === correctAnswerLetter ? (
            <p className="feedback correct-feedback">Correct!</p>
          ) : (
            <>
              <p className="feedback incorrect-feedback">
                Incorrect - The correct answer is {correctAnswerLetter}
              </p>
              <p style={{ fontSize: '13px', marginTop: '6px', color: '#6b7280' }}>
                The correct answer is highlighted in green above.
              </p>
            </>
          )}
        </div>
      )}

      {hasAnswered && (
        <button onClick={handleNextQuestion} className="nav-button">
          {isLastQuestion ? 'View Results' : 'Next Question'}
        </button>
      )}
    </div>
  );
}
