/**
 * Python Master: CertExam Interactive Trainer
 * Full Application Logic & State Controller
 */

// Sound synthesis using Web Audio API
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('python_trainer_sound') !== 'false';
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio not permitted yet
    }
  }

  correct() {
    if (!this.enabled) return;
    this.playTone(523.25, 'sine', 0.12, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 'sine', 0.12, 0.15), 80); // E5
    setTimeout(() => this.playTone(783.99, 'sine', 0.2, 0.15), 160); // G5
  }

  incorrect() {
    if (!this.enabled) return;
    this.playTone(220, 'triangle', 0.2, 0.15);
    setTimeout(() => this.playTone(185, 'triangle', 0.25, 0.15), 100);
  }

  click() {
    this.playTone(400, 'sine', 0.04, 0.05);
  }
}

const sounds = new SoundFX();

// Main Application
class App {
  constructor() {
    this.questions = [];
    this.filteredQuestions = [];
    this.currentIndex = 0;
    this.mode = localStorage.getItem('python_trainer_mode') || 'practice'; // 'practice' | 'exam'
    
    // Persistent user data
    this.bookmarks = new Set(JSON.parse(localStorage.getItem('python_trainer_bookmarks') || '[]'));
    this.mistakes = new Set(JSON.parse(localStorage.getItem('python_trainer_mistakes') || '[]'));
    this.practiceAnswers = JSON.parse(localStorage.getItem('python_trainer_practice_answers') || '{}');
    
    // Filters
    this.activeFilter = 'all'; // 'all', 'mistakes', 'bookmarks', 'sec-1' ... 'sec-6'
    this.searchQuery = '';
    
    // Exam state
    this.exam = {
      active: false,
      questions: [],
      currentIndex: 0,
      answers: {},
      flagged: new Set(),
      durationMinutes: 45,
      timeRemaining: 45 * 60,
      timerInterval: null,
      submitted: false,
      results: null
    };

    this.init();
  }

  async init() {
    this.initTheme();
    this.bindGlobalEvents();
    
    // Load questions
    if (window.QUESTIONS_DATA && Array.isArray(window.QUESTIONS_DATA)) {
      this.questions = window.QUESTIONS_DATA;
    } else {
      try {
        const res = await fetch('questions.json');
        this.questions = await res.json();
      } catch (err) {
        console.error('Failed to load questions:', err);
        document.getElementById('question-card-container').innerHTML = `
          <div class="p-8 text-center text-red-400">
            <h2 class="text-xl font-bold mb-2">Ошибка загрузки вопросов</h2>
            <p>Убедитесь, что файл questions.json или questions.data.js доступен.</p>
          </div>
        `;
        return;
      }
    }

    this.applyFilter('all');
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
    this.renderSectionsList();
  }

  initTheme() {
    const savedTheme = localStorage.getItem('python_trainer_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcon(savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('python_trainer_theme', next);
    this.updateThemeIcon(next);
  }

  updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    if (theme === 'dark') {
      btn.innerHTML = `<svg class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>`;
    } else {
      btn.innerHTML = `<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;
    }
  }

  // Question filtering
  applyFilter(filterKey) {
    this.activeFilter = filterKey;
    
    // Update active filter pills
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active-filter', tab.getAttribute('data-filter') === filterKey);
    });

    let list = this.questions;

    if (filterKey === 'mistakes') {
      list = list.filter(q => this.mistakes.has(q.number));
    } else if (filterKey === 'bookmarks') {
      list = list.filter(q => this.bookmarks.has(q.number));
    } else if (filterKey.startsWith('sec-')) {
      const secPrefix = filterKey.replace('sec-', '');
      list = list.filter(q => q.section.startsWith(secPrefix));
    }

    if (this.searchQuery.trim()) {
      const query = this.searchQuery.trim().toLowerCase();
      const numQuery = parseInt(query);
      list = list.filter(q => {
        if (!isNaN(numQuery) && q.number === numQuery) return true;
        return q.question.toLowerCase().includes(query) || 
               q.section.toLowerCase().includes(query) ||
               (q.explanation && q.explanation.toLowerCase().includes(query));
      });
    }

    this.filteredQuestions = list;
    this.currentIndex = 0;
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
    this.updateStatsCounters();
  }

  getCurrentQuestion() {
    if (this.mode === 'exam' && this.exam.active) {
      return this.exam.questions[this.exam.currentIndex];
    }
    return this.filteredQuestions[this.currentIndex];
  }

  getCurrentList() {
    if (this.mode === 'exam' && this.exam.active) {
      return this.exam.questions;
    }
    return this.filteredQuestions;
  }

  // Navigation
  goToIndex(idx) {
    const list = this.getCurrentList();
    if (idx < 0 || idx >= list.length) return;
    
    if (this.mode === 'exam' && this.exam.active) {
      this.exam.currentIndex = idx;
    } else {
      this.currentIndex = idx;
    }
    
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
    sounds.click();
  }

  nextQuestion() {
    const list = this.getCurrentList();
    const curr = (this.mode === 'exam' && this.exam.active) ? this.exam.currentIndex : this.currentIndex;
    if (curr < list.length - 1) {
      this.goToIndex(curr + 1);
    }
  }

  prevQuestion() {
    const curr = (this.mode === 'exam' && this.exam.active) ? this.exam.currentIndex : this.currentIndex;
    if (curr > 0) {
      this.goToIndex(curr - 1);
    }
  }

  randomQuestion() {
    const list = this.getCurrentList();
    if (list.length <= 1) return;
    const rnd = Math.floor(Math.random() * list.length);
    this.goToIndex(rnd);
  }

  toggleBookmark(qNum) {
    if (this.bookmarks.has(qNum)) {
      this.bookmarks.delete(qNum);
    } else {
      this.bookmarks.add(qNum);
    }
    localStorage.setItem('python_trainer_bookmarks', JSON.stringify([...this.bookmarks]));
    this.updateBookmarkButton();
    this.updateStatsCounters();
    this.renderQuestionPalette();
    sounds.click();
  }

  // Mode switching
  switchMode(newMode) {
    if (this.mode === newMode) return;
    
    if (newMode === 'exam') {
      this.showExamStartModal();
    } else {
      if (this.exam.active && !confirm('Прервать текущий экзамен и перейти в режим тренировки?')) {
        return;
      }
      this.stopExamTimer();
      this.mode = 'practice';
      localStorage.setItem('python_trainer_mode', 'practice');
      this.updateModeUI();
      this.renderQuestionPalette();
      this.renderCurrentQuestion();
    }
  }

  updateModeUI() {
    const practiceBtn = document.getElementById('mode-practice-btn');
    const examBtn = document.getElementById('mode-exam-btn');
    const examTimerBar = document.getElementById('exam-timer-bar');
    const finishExamBtn = document.getElementById('finish-exam-btn');

    if (this.mode === 'practice') {
      practiceBtn.className = "px-4 py-1.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white shadow-md shadow-indigo-500/25 transition";
      examBtn.className = "px-4 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition";
      examTimerBar.classList.add('hidden');
      finishExamBtn.classList.add('hidden');
    } else {
      examBtn.className = "px-4 py-1.5 rounded-lg text-sm font-semibold bg-rose-600 text-white shadow-md shadow-rose-500/25 transition";
      practiceBtn.className = "px-4 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition";
      examTimerBar.classList.remove('hidden');
      finishExamBtn.classList.remove('hidden');
    }
  }

  // Exam Logic
  showExamStartModal() {
    const modal = document.getElementById('exam-modal');
    if (modal) modal.classList.remove('hidden');
  }

  closeExamStartModal() {
    const modal = document.getElementById('exam-modal');
    if (modal) modal.classList.add('hidden');
  }

  startExam(count = 45, durationMinutes = 45) {
    this.closeExamStartModal();
    this.mode = 'exam';
    localStorage.setItem('python_trainer_mode', 'exam');
    this.updateModeUI();

    // Pick random subset of questions
    const shuffled = [...this.questions].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(count, this.questions.length));

    this.exam = {
      active: true,
      questions: selected,
      currentIndex: 0,
      answers: {},
      flagged: new Set(),
      durationMinutes: durationMinutes,
      timeRemaining: durationMinutes * 60,
      timerInterval: null,
      submitted: false,
      results: null
    };

    this.startExamTimer();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
    document.getElementById('exam-results-screen').classList.add('hidden');
    document.getElementById('question-card-container').classList.remove('hidden');
  }

  startExamTimer() {
    this.stopExamTimer();
    this.updateExamTimerDisplay();
    
    this.exam.timerInterval = setInterval(() => {
      this.exam.timeRemaining--;
      this.updateExamTimerDisplay();
      
      if (this.exam.timeRemaining <= 0) {
        this.stopExamTimer();
        alert('Время вышло! Экзамен завершается автоматически.');
        this.submitExam();
      }
    }, 1000);
  }

  stopExamTimer() {
    if (this.exam.timerInterval) {
      clearInterval(this.exam.timerInterval);
      this.exam.timerInterval = null;
    }
  }

  updateExamTimerDisplay() {
    const el = document.getElementById('exam-timer-text');
    if (!el) return;
    const mins = Math.floor(this.exam.timeRemaining / 60);
    const secs = this.exam.timeRemaining % 60;
    el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    if (this.exam.timeRemaining < 300) {
      el.className = "text-rose-400 font-mono font-bold animate-pulse";
    } else {
      el.className = "text-white font-mono font-bold";
    }
  }

  confirmSubmitExam() {
    const total = this.exam.questions.length;
    const answered = Object.keys(this.exam.answers).length;
    const unanswered = total - answered;

    const msg = unanswered > 0 
      ? `У вас осталось неотвеченных вопросов: ${unanswered} из ${total}.\nВы уверены, что хотите завершить экзамен?`
      : `Все ${total} вопросов отвечены. Завершить экзамен и посмотреть результаты?`;

    if (confirm(msg)) {
      this.submitExam();
    }
  }

  submitExam() {
    this.stopExamTimer();
    this.exam.submitted = true;
    this.exam.active = false;

    let correctCount = 0;
    const sectionStats = {};

    this.exam.questions.forEach(q => {
      const sec = q.section;
      if (!sectionStats[sec]) {
        sectionStats[sec] = { total: 0, correct: 0 };
      }
      sectionStats[sec].total++;

      const userAns = this.exam.answers[q.number];
      const isCorrect = this.checkIfAnswerCorrect(q, userAns);

      if (isCorrect) {
        correctCount++;
        sectionStats[sec].correct++;
      } else {
        this.mistakes.add(q.number);
      }
    });

    localStorage.setItem('python_trainer_mistakes', JSON.stringify([...this.mistakes]));

    const scorePercent = Math.round((correctCount / this.exam.questions.length) * 100);
    const passed = scorePercent >= 70; // MTA 70% threshold

    this.exam.results = {
      scorePercent,
      passed,
      correctCount,
      totalCount: this.exam.questions.length,
      timeSpentSeconds: (this.exam.durationMinutes * 60) - this.exam.timeRemaining,
      sectionStats
    };

    sounds.playTone(passed ? 600 : 300, 'sine', 0.4, 0.2);
    this.renderExamResults();
  }

  renderExamResults() {
    const res = this.exam.results;
    if (!res) return;

    document.getElementById('question-card-container').classList.add('hidden');
    const screen = document.getElementById('exam-results-screen');
    screen.classList.remove('hidden');

    const mins = Math.floor(res.timeSpentSeconds / 60);
    const secs = res.timeSpentSeconds % 60;

    let sectionsHtml = '';
    for (const [secName, stats] of Object.entries(res.sectionStats)) {
      const p = Math.round((stats.correct / stats.total) * 100);
      sectionsHtml += `
        <div class="mb-3">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-300 font-medium truncate pr-2">${secName}</span>
            <span class="font-bold ${p >= 70 ? 'text-emerald-400' : 'text-rose-400'}">${stats.correct}/${stats.total} (${p}%)</span>
          </div>
          <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div class="${p >= 70 ? 'bg-emerald-500' : 'bg-rose-500'} h-2 rounded-full transition-all duration-500" style="width: ${p}%"></div>
          </div>
        </div>
      `;
    }

    screen.innerHTML = `
      <div class="glass-card rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto shadow-2xl border border-white/10 text-center animate-fade-in">
        <div class="w-24 h-24 mx-auto rounded-full flex items-center justify-center text-4xl mb-4 ${res.passed ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40 shadow-lg shadow-emerald-500/20' : 'bg-rose-500/20 text-rose-400 border-2 border-rose-500/40 shadow-lg shadow-rose-500/20'}">
          ${res.passed ? '🎉' : '📚'}
        </div>

        <h2 class="text-2xl sm:text-3xl font-extrabold ${res.passed ? 'text-emerald-400' : 'text-rose-400'} mb-2">
          ${res.passed ? 'Поздравляем! Экзамен сдан!' : 'Экзамен не сдан. Требуется повторение'}
        </h2>
        
        <p class="text-gray-300 mb-6 text-sm sm:text-base">
          Проходной балл сертификации Python 98-381: <strong>70%</strong>. Ваш результат: <span class="font-bold ${res.passed ? 'text-emerald-400' : 'text-rose-400'}">${res.scorePercent}%</span>
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div class="bg-gray-800/60 p-4 rounded-xl border border-white/5">
            <div class="text-2xl font-bold text-white">${res.correctCount} / ${res.totalCount}</div>
            <div class="text-xs text-gray-400 mt-1">Правильных ответов</div>
          </div>
          <div class="bg-gray-800/60 p-4 rounded-xl border border-white/5">
            <div class="text-2xl font-bold text-rose-400">${res.totalCount - res.correctCount}</div>
            <div class="text-xs text-gray-400 mt-1">Ошибок</div>
          </div>
          <div class="bg-gray-800/60 p-4 rounded-xl border border-white/5">
            <div class="text-2xl font-bold text-indigo-400">${res.scorePercent}%</div>
            <div class="text-xs text-gray-400 mt-1">Итоговый балл</div>
          </div>
          <div class="bg-gray-800/60 p-4 rounded-xl border border-white/5">
            <div class="text-2xl font-bold text-amber-400">${mins}м ${secs}с</div>
            <div class="text-xs text-gray-400 mt-1">Затраченное время</div>
          </div>
        </div>

        <div class="text-left bg-gray-900/60 p-5 rounded-xl border border-white/5 mb-8">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">Результаты по темам сертификации</h3>
          ${sectionsHtml}
        </div>

        <div class="flex flex-wrap gap-4 justify-center">
          <button id="retry-mistakes-btn" class="px-6 py-3 rounded-xl font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition">
            Работа над ошибками (${this.mistakes.size})
          </button>
          <button id="retry-exam-btn" class="px-6 py-3 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition">
            Пройти новый экзамен
          </button>
          <button id="back-to-practice-btn" class="px-6 py-3 rounded-xl font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition border border-white/10">
            Вернуться в режим тренировки
          </button>
        </div>
      </div>
    `;

    document.getElementById('retry-mistakes-btn')?.addEventListener('click', () => {
      this.mode = 'practice';
      this.updateModeUI();
      document.getElementById('exam-results-screen').classList.add('hidden');
      document.getElementById('question-card-container').classList.remove('hidden');
      this.applyFilter('mistakes');
    });

    document.getElementById('retry-exam-btn')?.addEventListener('click', () => {
      this.startExam(this.exam.questions.length, this.exam.durationMinutes);
    });

    document.getElementById('back-to-practice-btn')?.addEventListener('click', () => {
      this.mode = 'practice';
      this.updateModeUI();
      document.getElementById('exam-results-screen').classList.add('hidden');
      document.getElementById('question-card-container').classList.remove('hidden');
      this.applyFilter('all');
    });
  }

  checkIfAnswerCorrect(q, userAns) {
    if (!userAns) return false;
    
    if (q.type === 'single') {
      const correctIdx = q.correct_answer[0];
      return userAns === correctIdx;
    }
    
    if (q.type === 'multiple') {
      if (!Array.isArray(userAns)) return false;
      const sortedUser = [...userAns].sort().join(',');
      const sortedCorrect = [...q.correct_answer].sort().join(',');
      return sortedUser === sortedCorrect;
    }
    
    if (q.type === 'yes_no') {
      if (!Array.isArray(userAns)) return false;
      return userAns.every((ans, idx) => ans === q.correct_answer[idx]);
    }
    
    if (q.type === 'dropdown') {
      if (!Array.isArray(userAns)) return false;
      return userAns.every((ans, idx) => ans === q.correct_answer[idx]);
    }

    if (q.type === 'matching') {
      if (!Array.isArray(userAns)) return false;
      return userAns.every((ans, idx) => ans === q.correct_answer[idx]);
    }

    return false;
  }

  // Answer selection in Practice Mode
  handleAnswerSelect(optionIndex) {
    const q = this.getCurrentQuestion();
    if (!q) return;

    if (this.mode === 'exam') {
      // In Exam mode: just record choice without checking immediately
      if (q.type === 'single') {
        this.exam.answers[q.number] = optionIndex;
      } else if (q.type === 'multiple') {
        let cur = this.exam.answers[q.number] || [];
        if (cur.includes(optionIndex)) {
          cur = cur.filter(x => x !== optionIndex);
        } else {
          cur.push(optionIndex);
        }
        this.exam.answers[q.number] = cur;
      }
      this.renderQuestionPalette();
      this.renderCurrentQuestion();
      sounds.click();
      return;
    }

    // Practice mode
    if (q.type === 'single') {
      const isCorrect = q.correct_answer.includes(optionIndex);
      this.practiceAnswers[q.number] = {
        selected: [optionIndex],
        isCorrect: isCorrect,
        showExplanation: true
      };

      if (isCorrect) {
        sounds.correct();
        // Remove from mistakes if answered correctly
        this.mistakes.delete(q.number);
      } else {
        sounds.incorrect();
        this.mistakes.add(q.number);
      }

      localStorage.setItem('python_trainer_mistakes', JSON.stringify([...this.mistakes]));
      localStorage.setItem('python_trainer_practice_answers', JSON.stringify(this.practiceAnswers));
      
      this.updateStatsCounters();
      this.renderQuestionPalette();
      this.renderCurrentQuestion();
    } else if (q.type === 'multiple') {
      // Toggle choice
      let cur = this.practiceAnswers[q.number] ? [...this.practiceAnswers[q.number].selected] : [];
      if (cur.includes(optionIndex)) {
        cur = cur.filter(x => x !== optionIndex);
      } else {
        cur.push(optionIndex);
      }
      this.practiceAnswers[q.number] = {
        selected: cur,
        isCorrect: false,
        showExplanation: false
      };
      this.renderCurrentQuestion();
    }
  }

  confirmMultipleAnswer() {
    const q = this.getCurrentQuestion();
    if (!q || q.type !== 'multiple') return;

    const cur = this.practiceAnswers[q.number] ? this.practiceAnswers[q.number].selected : [];
    const isCorrect = this.checkIfAnswerCorrect(q, cur);

    this.practiceAnswers[q.number] = {
      selected: cur,
      isCorrect: isCorrect,
      showExplanation: true
    };

    if (isCorrect) {
      sounds.correct();
      this.mistakes.delete(q.number);
    } else {
      sounds.incorrect();
      this.mistakes.add(q.number);
    }

    localStorage.setItem('python_trainer_mistakes', JSON.stringify([...this.mistakes]));
    localStorage.setItem('python_trainer_practice_answers', JSON.stringify(this.practiceAnswers));
    
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
  }

  handleYesNoSelect(stmtIndex, val) {
    const q = this.getCurrentQuestion();
    if (!q || q.type !== 'yes_no') return;

    if (this.mode === 'exam') {
      let cur = this.exam.answers[q.number] || new Array(q.statements.length).fill(null);
      cur[stmtIndex] = val;
      this.exam.answers[q.number] = cur;
      this.renderQuestionPalette();
      this.renderCurrentQuestion();
      sounds.click();
      return;
    }

    let cur = this.practiceAnswers[q.number]?.selected || new Array(q.statements.length).fill(null);
    cur[stmtIndex] = val;
    
    const allAnswered = cur.every(x => x !== null);
    const isCorrect = allAnswered ? this.checkIfAnswerCorrect(q, cur) : false;

    this.practiceAnswers[q.number] = {
      selected: cur,
      isCorrect: isCorrect,
      showExplanation: allAnswered
    };

    if (allAnswered) {
      if (isCorrect) {
        sounds.correct();
        this.mistakes.delete(q.number);
      } else {
        sounds.incorrect();
        this.mistakes.add(q.number);
      }
      localStorage.setItem('python_trainer_mistakes', JSON.stringify([...this.mistakes]));
    }

    localStorage.setItem('python_trainer_practice_answers', JSON.stringify(this.practiceAnswers));
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
  }

  handleDropdownSelect(ddIndex, selectedOptionIdx) {
    const q = this.getCurrentQuestion();
    if (!q || q.type !== 'dropdown') return;

    const val = isNaN(selectedOptionIdx) ? null : selectedOptionIdx;

    if (this.mode === 'exam') {
      let cur = this.exam.answers[q.number] || new Array(q.dropdowns.length).fill(null);
      cur[ddIndex] = val;
      this.exam.answers[q.number] = cur;
      this.renderQuestionPalette();
      this.renderCurrentQuestion();
      sounds.click();
      return;
    }

    let cur = this.practiceAnswers[q.number]?.selected ? [...this.practiceAnswers[q.number].selected] : new Array(q.dropdowns.length).fill(null);
    cur[ddIndex] = val;

    const allAnswered = cur.length === q.dropdowns.length && cur.every(x => x !== null && x !== undefined && !isNaN(x));
    const isCorrect = allAnswered ? this.checkIfAnswerCorrect(q, cur) : false;

    this.practiceAnswers[q.number] = {
      selected: cur,
      isCorrect: isCorrect,
      showExplanation: allAnswered
    };

    if (allAnswered) {
      if (isCorrect) {
        sounds.correct();
        this.mistakes.delete(q.number);
      } else {
        sounds.incorrect();
        this.mistakes.add(q.number);
      }
      localStorage.setItem('python_trainer_mistakes', JSON.stringify([...this.mistakes]));
    }

    localStorage.setItem('python_trainer_practice_answers', JSON.stringify(this.practiceAnswers));
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
  }

  showHint() {
    const q = this.getCurrentQuestion();
    if (!q || this.mode === 'exam') return;
    
    if (!this.practiceAnswers[q.number]) {
      this.practiceAnswers[q.number] = {
        selected: (q.type === 'dropdown' || q.type === 'yes_no') ? [...q.correct_answer] : (q.type === 'single' ? [q.correct_answer[0]] : [...q.correct_answer]),
        isCorrect: true,
        showExplanation: true
      };
    } else {
      this.practiceAnswers[q.number].showExplanation = true;
      if (q.type === 'dropdown' && (!this.practiceAnswers[q.number].selected || this.practiceAnswers[q.number].selected.some(x => x === null || isNaN(x)))) {
        this.practiceAnswers[q.number].selected = [...q.correct_answer];
      }
    }
    this.renderCurrentQuestion();
    sounds.click();
  }

  resetCurrentQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    if (this.mode === 'exam') {
      delete this.exam.answers[q.number];
    } else {
      delete this.practiceAnswers[q.number];
      localStorage.setItem('python_trainer_practice_answers', JSON.stringify(this.practiceAnswers));
    }
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
  }

  resetAllProgress() {
    if (!confirm('Вы уверены, что хотите полностью сбросить весь прогресс (все ответы, ошибки и статистику)?')) {
      return;
    }

    this.practiceAnswers = {};
    this.mistakes.clear();
    localStorage.removeItem('python_trainer_practice_answers');
    localStorage.removeItem('python_trainer_mistakes');

    if (this.exam.active) {
      this.stopExamTimer();
      this.exam.active = false;
      this.exam.answers = {};
    }

    this.currentIndex = 0;
    this.applyFilter('all');
    this.updateStatsCounters();
    this.renderQuestionPalette();
    this.renderCurrentQuestion();
    this.renderSectionsList();
    sounds.click();
  }

  // UI Rendering
  renderCurrentQuestion() {
    const container = document.getElementById('question-card-container');
    if (!container) return;

    const q = this.getCurrentQuestion();
    const list = this.getCurrentList();
    const currIdx = (this.mode === 'exam' && this.exam.active) ? this.exam.currentIndex : this.currentIndex;

    if (!q) {
      container.innerHTML = `
        <div class="glass-card rounded-2xl p-12 text-center max-w-xl mx-auto animate-fade-in">
          <div class="text-4xl mb-4">🔍</div>
          <h3 class="text-xl font-bold mb-2 text-white">Вопросы не найдены</h3>
          <p class="text-gray-400 text-sm mb-6">В выбранной категории или по текущему запросу нет вопросов.</p>
          <button onclick="app.applyFilter('all')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-white shadow-lg shadow-indigo-600/30 transition">
            Сбросить фильтры
          </button>
        </div>
      `;
      return;
    }

    const isBookmarked = this.bookmarks.has(q.number);
    const pAns = this.practiceAnswers[q.number];
    const isAnswered = this.mode === 'exam' ? (this.exam.answers[q.number] !== undefined) : (pAns && pAns.selected && pAns.selected.length > 0);
    const showExpl = this.mode === 'practice' && pAns && pAns.showExplanation;

    // Type badge text
    let typeBadge = "Один ответ";
    if (q.type === 'multiple') typeBadge = "Несколько ответов";
    else if (q.type === 'yes_no') typeBadge = "Yes / No";
    else if (q.type === 'dropdown') typeBadge = "Выпадающие списки";
    else if (q.type === 'matching') typeBadge = "Сопоставление";

    // Format question text (highlight inline code if needed)
    const formattedPrompt = this.formatQuestionText(q.question);

    // Format images
    let imagesHtml = '';
    if (q.images && q.images.length > 0) {
      imagesHtml = `
        <div class="my-5 p-4 rounded-xl bg-gray-950/60 border border-white/10 flex flex-wrap gap-4 items-center justify-center">
          ${q.images.map(img => `
            <div class="relative group cursor-zoom-in" onclick="app.openImageModal('${img}')">
              <img src="${img}" alt="Иллюстрация к вопросу ${q.number}" class="max-h-64 max-w-full rounded-lg object-contain border border-white/5 shadow-md transition group-hover:scale-[1.02]">
              <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center transition">
                <span class="bg-black/75 px-3 py-1 rounded text-xs text-white font-medium">🔍 Нажмите для увеличения</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Render options based on type
    let optionsHtml = '';
    if (q.type === 'single' || q.type === 'multiple') {
      optionsHtml = `
        <div class="space-y-3 mb-6">
          ${q.options.map((opt, idx) => {
            let stateClass = '';
            let isSelected = false;

            if (this.mode === 'exam') {
              const userChoice = this.exam.answers[q.number];
              isSelected = q.type === 'single' ? (userChoice === idx) : (Array.isArray(userChoice) && userChoice.includes(idx));
              if (isSelected) stateClass = 'selected';
            } else {
              isSelected = pAns && pAns.selected && pAns.selected.includes(idx);
              if (isSelected) stateClass = 'selected';
              
              if (showExpl) {
                if (q.correct_answer.includes(idx)) {
                  stateClass = 'correct';
                } else if (isSelected && !q.correct_answer.includes(idx)) {
                  stateClass = 'incorrect';
                }
              }
            }

            const letter = String.fromCharCode(65 + idx);
            const cleanOptText = opt.replace(/^[A-Ea-e][\.\)]\s*/, '');

            return `
              <button onclick="app.handleAnswerSelect(${idx})" class="option-btn w-full p-4 text-left flex items-start gap-3 ${stateClass}">
                <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${stateClass === 'correct' ? 'bg-emerald-500 text-white' : (stateClass === 'incorrect' ? 'bg-rose-500 text-white' : (isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300'))}">
                  ${letter}
                </div>
                <div class="text-sm sm:text-base text-gray-200 leading-relaxed break-words flex-1 font-normal">
                  ${this.formatCodeSpans(cleanOptText)}
                </div>
              </button>
            `;
          }).join('')}
        </div>
      `;

      if (q.type === 'multiple' && this.mode === 'practice' && !showExpl) {
        optionsHtml += `
          <div class="flex justify-end mb-6">
            <button onclick="app.confirmMultipleAnswer()" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-2">
              <span>Подтвердить выбор</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            </button>
          </div>
        `;
      }
    } else if (q.type === 'yes_no') {
      const curAnswers = this.mode === 'exam' ? (this.exam.answers[q.number] || []) : (pAns?.selected || []);
      optionsHtml = `
        <div class="overflow-x-auto mb-6">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-white/10 text-xs text-gray-400 uppercase tracking-wider">
                <th class="py-3 px-4">Утверждение</th>
                <th class="py-3 px-3 text-center w-24">Yes</th>
                <th class="py-3 px-3 text-center w-24">No</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5 text-sm">
              ${q.statements.map((stmt, sIdx) => {
                const userVal = curAnswers[sIdx];
                const correctVal = q.correct_answer[sIdx];
                let rowStatus = '';

                if (showExpl) {
                  if (userVal === correctVal) {
                    rowStatus = 'bg-emerald-500/5';
                  } else if (userVal !== undefined && userVal !== null) {
                    rowStatus = 'bg-rose-500/5';
                  }
                }

                return `
                  <tr class="${rowStatus} hover:bg-white/[0.02]">
                    <td class="py-3.5 px-4 text-gray-200">${this.formatCodeSpans(stmt)}</td>
                    <td class="py-3.5 px-3 text-center">
                      <button onclick="app.handleYesNoSelect(${sIdx}, 'Yes')" class="w-10 h-8 rounded-lg text-xs font-bold transition ${userVal === 'Yes' ? (showExpl ? (correctVal === 'Yes' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'bg-indigo-600 text-white') : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}">
                        Yes
                      </button>
                    </td>
                    <td class="py-3.5 px-3 text-center">
                      <button onclick="app.handleYesNoSelect(${sIdx}, 'No')" class="w-10 h-8 rounded-lg text-xs font-bold transition ${userVal === 'No' ? (showExpl ? (correctVal === 'No' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'bg-indigo-600 text-white') : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}">
                        No
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (q.type === 'dropdown') {
      const curAnswers = this.mode === 'exam' ? (this.exam.answers[q.number] || []) : (pAns?.selected || []);
      optionsHtml = `
        <div class="space-y-4 mb-6">
          ${q.dropdowns.map((dd, dIdx) => {
            const userVal = curAnswers[dIdx];
            const correctVal = dd.correct;
            let borderClass = 'border-white/10';

            if (showExpl && userVal !== null && userVal !== undefined && !isNaN(userVal)) {
              borderClass = (userVal === correctVal) ? 'border-emerald-500 bg-emerald-500/10' : 'border-rose-500 bg-rose-500/10';
            }

            return `
              <div class="p-3 sm:p-4 rounded-xl bg-gray-900/60 border ${borderClass} flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 transition">
                <span class="text-xs sm:text-sm text-gray-200 font-medium leading-relaxed">${this.formatCodeSpans(dd.prompt)}</span>
                <select onchange="app.handleDropdownSelect(${dIdx}, parseInt(this.value))" class="w-full sm:w-auto min-w-0 sm:min-w-[220px] bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 sm:py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                  <option value="">-- Select option --</option>
                  ${dd.options.map((opt, oIdx) => `
                    <option value="${oIdx}" ${userVal === oIdx ? 'selected' : ''}>${opt}${showExpl && oIdx === correctVal ? ' ✓' : ''}</option>
                  `).join('')}
                </select>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Explanation Card (in Practice mode)
    let explanationHtml = '';
    if (showExpl) {
      const isCorrect = pAns.isCorrect;
      explanationHtml = `
        <div class="mt-5 sm:mt-6 p-4 sm:p-6 rounded-xl sm:rounded-2xl ${isCorrect ? 'bg-emerald-950/30 border border-emerald-500/30' : 'bg-rose-950/30 border border-rose-500/30'} animate-fade-in">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCorrect ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}">
              ${isCorrect ? '✓' : '✗'}
            </span>
            <h4 class="font-bold text-sm sm:text-base ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}">
              ${isCorrect ? 'Правильно!' : 'Неверно'}
            </h4>
            <span class="ml-auto text-xs text-gray-400 truncate max-w-[200px] sm:max-w-none text-right">
              Правильный ответ: <strong class="text-white">${q.answer_display}</strong>
            </span>
          </div>

          <div class="text-xs sm:text-sm text-gray-300 leading-relaxed space-y-2 border-t border-white/10 pt-3">
            <div class="font-semibold text-gray-200">Подробное объяснение:</div>
            <p>${this.formatCodeSpans(q.explanation)}</p>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="glass-card rounded-2xl p-4 sm:p-6 lg:p-8 shadow-xl border border-white/10 relative transition-all">
        <!-- Top bar of question card -->
        <div class="flex items-center justify-between gap-2 mb-4 pb-3 sm:mb-5 sm:pb-4 border-b border-white/10">
          <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span class="px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600/30 text-indigo-300 border border-indigo-500/30">
              Вопрос ${q.number} / ${this.questions.length}
            </span>
            <span class="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[11px] sm:text-xs font-medium bg-gray-800 text-gray-400 border border-white/5">
              ${typeBadge}
            </span>
            <span class="hidden md:inline-block px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800/60 text-gray-400 truncate max-w-xs">
              ${q.subtopic}
            </span>
          </div>

          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onclick="app.toggleBookmark(${q.number})" title="${isBookmarked ? 'Удалить из избранного' : 'Добавить в избранное'}" class="p-1.5 sm:p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-400 transition">
              <svg class="w-4 h-4 sm:w-5 sm:h-5 ${isBookmarked ? 'text-amber-400 fill-amber-400' : 'text-gray-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
              </svg>
            </button>
            <button onclick="app.resetCurrentQuestion()" title="Сбросить ответ" class="p-1.5 sm:p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-400 transition">
              <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
        </div>

        <!-- Question Body -->
        <div class="mb-5 sm:mb-6">
          <div class="text-sm sm:text-base lg:text-lg text-gray-100 font-medium leading-relaxed mb-3 sm:mb-4">
            ${formattedPrompt}
          </div>
          ${imagesHtml}
        </div>

        <!-- Options Area -->
        ${optionsHtml}

        <!-- Explanation Area -->
        ${explanationHtml}

        <!-- Footer Navigation -->
        <div class="flex items-center justify-between gap-2 mt-6 sm:mt-8 pt-4 sm:pt-5 border-t border-white/10">
          <button onclick="app.prevQuestion()" ${currIdx === 0 ? 'disabled' : ''} class="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1 shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            <span>Назад</span>
          </button>

          <div class="flex items-center gap-1.5 sm:gap-2">
            ${this.mode === 'practice' ? `
              <button onclick="app.showHint()" class="px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-xl text-xs font-semibold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 transition flex items-center gap-1">
                <span>💡</span> <span class="hidden sm:inline">Показать ответ</span><span class="sm:hidden">Ответ</span>
              </button>
              <button onclick="app.randomQuestion()" title="Случайный вопрос" class="p-2 sm:px-3 sm:py-2.5 rounded-xl text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition">
                🎲<span class="hidden sm:inline ml-1">Случайный</span>
              </button>
            ` : ''}
          </div>

          <button onclick="app.nextQuestion()" ${currIdx === list.length - 1 ? 'disabled' : ''} class="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-600/25 transition flex items-center gap-1 shrink-0">
            <span>Вперед</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </button>
        </div>
      </div>
    `;
  }

  formatQuestionText(rawText) {
    if (!rawText) return '';
    // Look for code segments like lines starting with numbers, def, for, if, import
    // Split into paragraphs
    const lines = rawText.split('\n');
    let inCode = false;
    let codeBuffer = [];
    let html = '';

    for (const line of lines) {
      const trimmed = line.trim();
      // Check if line looks like code
      const isCodeLine = /^(?:\d+[\)\.\:]|\#|def\s+|class\s+|import\s+|from\s+|if\s+|elif\s+|else\:|for\s+|while\s+|print\(|[a-zA-Z_]\w*\s*=|\s{2,})/.test(line);

      if (isCodeLine) {
        if (!inCode) {
          inCode = true;
          codeBuffer = [];
        }
        codeBuffer.push(line);
      } else {
        if (inCode) {
          html += `<pre class="my-3 font-mono text-xs sm:text-sm"><code>${this.escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
          inCode = false;
          codeBuffer = [];
        }
        if (trimmed) {
          html += `<p class="mb-2">${this.formatCodeSpans(trimmed)}</p>`;
        }
      }
    }

    if (inCode && codeBuffer.length > 0) {
      html += `<pre class="my-3 font-mono text-xs sm:text-sm"><code>${this.escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
    }

    return html;
  }

  formatCodeSpans(text) {
    if (!text) return '';
    // Wrap identifiers, quotes, or code-like tokens in monospace styling
    return this.escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-gray-800 text-indigo-300 font-mono text-xs">$1</code>')
      .replace(/\b(int|float|str|bool|list|tuple|dict|set|def|return|import|from|while|for|break|continue|try|except|finally)\b/g, '<span class="text-indigo-400 font-mono font-medium">$1</span>');
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Question Navigator Palette
  renderQuestionPalette() {
    const container = document.getElementById('question-palette');
    const mobileContainer = document.getElementById('mobile-question-palette');
    if (!container) return;

    const list = this.getCurrentList();
    const currIdx = (this.mode === 'exam' && this.exam.active) ? this.exam.currentIndex : this.currentIndex;

    const html = list.map((q, idx) => {
      let statusClass = '';
      const isCurrent = idx === currIdx;

      if (isCurrent) {
        statusClass = 'current';
      } else if (this.mode === 'exam') {
        if (this.exam.answers[q.number] !== undefined) {
          statusClass = 'answered-exam';
        }
      } else {
        const pAns = this.practiceAnswers[q.number];
        if (pAns && pAns.selected && pAns.selected.length > 0) {
          statusClass = pAns.isCorrect ? 'correct' : 'incorrect';
        }
      }

      const isBookmarked = this.bookmarks.has(q.number);
      const isMistake = this.mistakes.has(q.number);

      return `
        <button onclick="app.goToIndex(${idx}); document.getElementById('mobile-drawer')?.classList.add('hidden')" 
                title="Вопрос ${q.number} (${q.subtopic})" 
                class="q-badge relative ${statusClass} ${isBookmarked ? 'bookmarked' : ''}">
          ${q.number}
          ${isMistake && !isCurrent && this.mode === 'practice' ? '<span class="absolute bottom-0.5 w-1 h-1 rounded-full bg-rose-500"></span>' : ''}
        </button>
      `;
    }).join('');

    container.innerHTML = html;
    if (mobileContainer) mobileContainer.innerHTML = html;
  }

  // Sidebar sections breakdown
  renderSectionsList() {
    const container = document.getElementById('sections-list');
    const mobileContainer = document.getElementById('mobile-sections-list');
    if (!container && !mobileContainer) return;

    // Group questions by section
    const secMap = {};
    this.questions.forEach(q => {
      const m = q.section.match(/^(\d+)\./);
      const secKey = m ? m[1] + '.' : q.section.substring(0, 2).trim();
      
      if (!secMap[secKey]) {
        secMap[secKey] = {
          key: secKey,
          title: q.section,
          total: 0,
          answered: 0,
          correct: 0
        };
      }
      secMap[secKey].total++;
      
      const pAns = this.practiceAnswers[q.number];
      if (pAns && pAns.selected && pAns.selected.length > 0) {
        secMap[secKey].answered++;
        if (pAns.isCorrect) {
          secMap[secKey].correct++;
        }
      }
    });

    // Sort by section number (1..6)
    const sortedSections = Object.values(secMap).sort((a, b) => parseInt(a.key) - parseInt(b.key));

    const html = sortedSections.map(data => {
      const p = Math.round((data.answered / data.total) * 100);
      const isActive = this.activeFilter === `sec-${data.key}`;
      
      return `
        <button onclick="app.applyFilter('sec-${data.key}'); document.getElementById('mobile-drawer')?.classList.add('hidden')" 
                class="w-full text-left p-2.5 sm:p-3 rounded-xl transition group mb-1.5 flex flex-col gap-1.5 border ${isActive ? 'bg-indigo-500/10 border-indigo-500/40 shadow-sm' : 'hover:bg-white/5 border-transparent'}">
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold truncate pr-2 ${isActive ? 'text-indigo-400' : 'text-gray-300 group-hover:text-indigo-400'} transition">
              ${data.title}
            </span>
            <span class="font-bold shrink-0 font-mono text-[11px] ${p > 0 ? (p === 100 ? 'text-emerald-400' : 'text-indigo-400') : 'text-gray-500'}">
              ${data.answered}/${data.total} (${p}%)
            </span>
          </div>
          <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden section-progress-track">
            <div class="h-2 rounded-full transition-all duration-500 ${p === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-500 to-indigo-400'}" 
                 style="width: ${p}%"></div>
          </div>
        </button>
      `;
    }).join('');

    if (container) container.innerHTML = html;
    if (mobileContainer) mobileContainer.innerHTML = html;
  }

  updateStatsCounters() {
    // Total / Answered / Correct / Mistakes
    const totalCount = this.questions.length;
    const bookmarkedCount = this.bookmarks.size;
    const mistakesCount = this.mistakes.size;
    
    let correctCount = 0;
    let answeredCount = 0;

    for (const qNum in this.practiceAnswers) {
      const item = this.practiceAnswers[qNum];
      if (item.selected && item.selected.length > 0) {
        answeredCount++;
        if (item.isCorrect) correctCount++;
      }
    }

    const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

    const elTotal = document.getElementById('stat-total');
    const elAnswered = document.getElementById('stat-answered');
    const elMistakes = document.getElementById('stat-mistakes');
    const elAccuracy = document.getElementById('stat-accuracy');
    const badgeMistakes = document.getElementById('badge-mistakes-count');
    const badgeBookmarks = document.getElementById('badge-bookmarks-count');

    if (elTotal) elTotal.textContent = totalCount;
    if (elAnswered) elAnswered.textContent = answeredCount;
    if (elMistakes) elMistakes.textContent = mistakesCount;
    if (elAccuracy) elAccuracy.textContent = `${accuracy}%`;
    if (badgeMistakes) badgeMistakes.textContent = mistakesCount;
    if (badgeBookmarks) badgeBookmarks.textContent = bookmarkedCount;

    // Progress bar
    const pBar = document.getElementById('top-progress-bar');
    if (pBar) {
      const p = Math.round((answeredCount / totalCount) * 100);
      pBar.style.width = `${p}%`;
    }

    // Always refresh sections breakdown bars so they update in real time!
    this.renderSectionsList();
  }

  updateBookmarkButton() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const isBookmarked = this.bookmarks.has(q.number);
    const starIcon = document.getElementById('bookmark-star-icon');
    if (starIcon) {
      starIcon.className = `w-5 h-5 ${isBookmarked ? 'text-amber-400 fill-amber-400' : 'text-gray-400'}`;
    }
  }

  // Image zoom modal
  openImageModal(imgSrc) {
    const modal = document.getElementById('image-zoom-modal');
    const img = document.getElementById('modal-zoom-img');
    if (!modal || !img) return;
    img.src = imgSrc;
    modal.classList.add('active');
  }

  closeImageModal() {
    const modal = document.getElementById('image-zoom-modal');
    if (modal) modal.classList.remove('active');
  }

  // Keyboard shortcuts
  bindGlobalEvents() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in search input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        this.nextQuestion();
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        this.prevQuestion();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const idx = parseInt(e.key) - 1;
        this.handleAnswerSelect(idx);
      } else if (e.key === 's' || e.key === 'S') {
        const q = this.getCurrentQuestion();
        if (q) this.toggleBookmark(q.number);
      } else if (e.key === 'h' || e.key === 'H') {
        this.showHint();
      } else if (e.key === 'Escape') {
        this.closeImageModal();
        this.closeExamStartModal();
      }
    });

    // Sound toggle
    const soundBtn = document.getElementById('sound-toggle-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        sounds.enabled = !sounds.enabled;
        localStorage.setItem('python_trainer_sound', sounds.enabled);
        soundBtn.innerHTML = sounds.enabled ? '🔊' : '🔇';
      });
    }

    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.applyFilter(this.activeFilter);
      });
    }
  }
}

// Global instance
let app;
window.addEventListener('DOMContentLoaded', () => {
  app = new App();
  window.app = app;
});
