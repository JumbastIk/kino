const SUPABASE_URL = 'https://fztkezltyafcmnxtaywe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dGtlemx0eWFmY21ueHRheXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5ODYyMzYsImV4cCI6MjA2NzU2MjIzNn0.ygDhzO17UoUPPcfOqV9xqPZpHDFws8PMuz8JnlZMSv4';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', function () {
  // Селектим все шаги
  const steps = Array.from(document.querySelectorAll('.wizard-step'));
  const progressBar = document.querySelector('.progress-bar');
  let currentStep = 0;

  // Всегда показываем только текущий step
  function showStep(idx) {
    steps.forEach((step, i) => {
      step.classList.toggle('active', i === idx);
    });
    // Прогресс-бар (проценты по числу шагов)
    if (progressBar) {
      const progress = ((idx + 1) / steps.length) * 100;
      progressBar.style.width = progress + '%';
    }
  }

  // Кнопки "Дальше"
  steps.forEach((step, idx) => {
    const next = step.querySelector('.next-btn');
    if (next) {
      next.addEventListener('click', function (e) {
        e.preventDefault();
        // Можно добавить валидацию, если нужно
        if (idx < steps.length - 1) {
          currentStep = idx + 1;
          showStep(currentStep);
        }
      });
    }
    // Кнопки "Назад"
    const prev = step.querySelector('.prev-btn');
    if (prev) {
      prev.addEventListener('click', function (e) {
        e.preventDefault();
        if (idx > 0) {
          currentStep = idx - 1;
          showStep(currentStep);
        }
      });
    }
  });

  // Сабмит только на последнем шаге!
  const lastForm = steps[steps.length - 1];
  if (lastForm) {
    lastForm.addEventListener('submit', async function(e) {
      e.preventDefault();

      // Собираем ВСЕ поля со всех форм!
      let allFields = {};
      steps.forEach(step => {
        const fd = new FormData(step);
        for (let [key, value] of fd.entries()) {
          allFields[key] = value;
        }
      });

      // skills — массив!
      allFields.skills = allFields.skills
        ? allFields.skills.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // is_remote — boolean
      allFields.is_remote = !!allFields.is_remote;

      // salary_min/max — числа
      allFields.salary_min = allFields.salary_min ? Number(allFields.salary_min) : null;
      allFields.salary_max = allFields.salary_max ? Number(allFields.salary_max) : null;

      // published_at — сейчас
      allFields.published_at = new Date().toISOString();

      // expires_at — только если выбрано!
      if (allFields.expires_at && allFields.expires_at.length === 10) {
        allFields.expires_at = allFields.expires_at + 'T00:00:00.000Z';
      } else {
        allFields.expires_at = null;
      }

      // Отправка в Supabase
      const { data, error } = await client
        .from('vacancies')
        .insert([allFields]);

      if (error) {
        alert('Ошибка: ' + error.message);
        return;
      }
      alert('Вакансия успешно добавлена!');
      window.location.href = 'index.html';
    });
  }

  // Показываем первый шаг
  showStep(currentStep);

  // Кнопка "Назад" в хедере
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = 'index.html';
    });
  }
});
