(function () {
  var form = document.getElementById('quizForm');
  var timerEl = document.getElementById('timer');
  var answeredCountEl = document.getElementById('answeredCount');
  var qjump = document.getElementById('qjump');
  var storageKey = 'simulasi-test:answers:' + window.QUIZ_TOKEN;
  var submitted = false;

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch (e) {
      return [];
    }
  }

  function save(answers) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch (e) {
      /* ignore (private browsing, quota, etc.) */
    }
  }

  // Saved state is the list of checked inputs as "name=value" strings, so
  // radio, checkbox and true/false answers all restore the same way.
  function currentAnswers() {
    var checked = [];
    form.querySelectorAll('.question-card input:checked').forEach(function (input) {
      checked.push(input.name + '=' + input.value);
    });
    return checked;
  }

  function restoreSaved() {
    var saved = loadSaved();
    if (Array.isArray(saved)) {
      form.querySelectorAll('.question-card input').forEach(function (input) {
        if (saved.indexOf(input.name + '=' + input.value) !== -1) input.checked = true;
      });
    }
    refreshUI();
  }

  function refreshUI() {
    var answered = 0;

    document.querySelectorAll('.option').forEach(function (label) {
      var input = label.querySelector('input');
      label.classList.toggle('selected', input.checked);
    });

    document.querySelectorAll('.question-card').forEach(function (card, i) {
      var answeredThis = !!card.querySelector('input:checked');
      if (answeredThis) answered++;
      var jumpLink = qjump.querySelector('[data-jump="' + (i + 1) + '"]');
      if (jumpLink) jumpLink.classList.toggle('answered', answeredThis);
    });

    answeredCountEl.textContent = answered + ' / ' + window.QUIZ_TOTAL + ' answered';
    save(currentAnswers());
  }

  form.addEventListener('change', refreshUI);

  form.addEventListener('submit', function () {
    submitted = true;
  });

  restoreSaved();

  // Timer
  function tick() {
    var remainingMs = window.QUIZ_DEADLINE_MS - Date.now();
    if (remainingMs <= 0) {
      timerEl.textContent = '00:00';
      if (!submitted) {
        submitted = true;
        try { localStorage.removeItem(storageKey); } catch (e) {}
        form.submit();
      }
      return;
    }
    var totalSeconds = Math.floor(remainingMs / 1000);
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds % 60;
    timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    timerEl.classList.toggle('low', totalSeconds <= 60);
    setTimeout(tick, 1000);
  }
  tick();

  form.addEventListener('submit', function () {
    try { localStorage.removeItem(storageKey); } catch (e) {}
  });
})();
