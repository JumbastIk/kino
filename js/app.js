// Не забудь: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js"></script> в HTML

const SUPABASE_URL = 'https://fztkezltyafcmnxtaywe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dGtlemx0eWFmY21ueHRheXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5ODYyMzYsImV4cCI6MjA2NzU2MjIzNn0.ygDhzO17UoUPPcfOqV9xqPZpHDFws8PMuz8JnlZMSv4';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', () => {
  const tabVac = document.getElementById('tab-vacancies');
  const tabRes = document.getElementById('tab-resumes');
  const vacancyList = document.getElementById('vacancy-list');
  const resumeList = document.getElementById('resume-list');
  const addBtn = document.getElementById('add-vacancy-btn');

  // Карточка вакансии
  function vacancyCard(vac) {
    let salary = '';
    if (vac.salary_text) salary = vac.salary_text;
    else if (vac.salary_min || vac.salary_max)
      salary = [vac.salary_min, vac.salary_max].filter(Boolean).join(' – ') + ' ₽';
    else salary = '—';
    const meta = [vac.company, vac.city, vac.experience].filter(Boolean).join(' • ');
    return `
      <div class="card">
        <div class="card-title">${vac.title || ''}</div>
        <div class="card-sub">${salary}</div>
        <div class="card-meta">${meta}</div>
        <div class="card-footer">Опубликовано ${vac.published_at ? new Date(vac.published_at).toLocaleDateString() : ''}</div>
      </div>
    `;
  }

  // Получение и отображение вакансий
  async function fetchAndRenderVacancies() {
    vacancyList.innerHTML = '<div style="text-align:center;padding:40px 0;color:#999;">Загрузка...</div>';
    const { data, error } = await supabase
      .from('vacancies')
      .select('*')
      .order('published_at', { ascending: false });
    if (error) {
      vacancyList.innerHTML = `<div style="color:#d33;padding:24px 0;text-align:center">Ошибка загрузки: ${error.message}</div>`;
      return;
    }
    if (!data || !data.length) {
      vacancyList.innerHTML = '<div style="color:#999;padding:24px 0;text-align:center">Пока нет вакансий</div>';
      return;
    }
    vacancyList.innerHTML = data.map(vacancyCard).join('');
  }

  // Отображение нужной вкладки
  function showTab(tab) {
    if (tab === 'vacancies') {
      tabVac.classList.add('active');
      tabRes.classList.remove('active');
      vacancyList.classList.add('visible');
      resumeList.classList.remove('visible');
      fetchAndRenderVacancies();
    } else {
      tabRes.classList.add('active');
      tabVac.classList.remove('active');
      resumeList.classList.add('visible');
      vacancyList.classList.remove('visible');
      resumeList.innerHTML = `<div style="color:#999;padding:24px 0;text-align:center">Раздел скоро будет</div>`;
    }
  }

  // Слушатели вкладок
  if (tabVac) tabVac.addEventListener('click', () => showTab('vacancies'));
  if (tabRes) tabRes.addEventListener('click', () => showTab('resumes'));

  // Кнопка "Добавить вакансию"
  if (addBtn) {
    addBtn.onclick = function () {
      window.location.href = 'add-vacancy.html';
    };
  }

  // Первый рендер
  showTab('vacancies');
});
