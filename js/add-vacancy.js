const SUPABASE_URL = 'https://fztkezltyafcmnxtaywe.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dGtlemx0eWFmY21ueHRheXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5ODYyMzYsImV4cCI6MjA2NzU2MjIzNn0.ygDhzO17UoUPPcfOqV9xqPZpHDFws8PMuz8JnlZMSv4';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('add-vacancy-form');
  if (!form) return;

  form.addEventListener('submit', async function(e) {
    e.preventDefault();

    // Получение данных из формы
    const formData = Object.fromEntries(new FormData(this).entries());

    // skills — массив!
    formData.skills = formData.skills
      ? formData.skills.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // is_remote — boolean
    formData.is_remote = !!formData.is_remote;

    // salary_min/max — числа
    formData.salary_min = formData.salary_min ? Number(formData.salary_min) : null;
    formData.salary_max = formData.salary_max ? Number(formData.salary_max) : null;

    // published_at — сейчас
    formData.published_at = new Date().toISOString();

    // expires_at — только если выбрано!
    if (formData.expires_at && formData.expires_at.length === 10) {
      formData.expires_at = formData.expires_at + 'T00:00:00.000Z';
    } else {
      formData.expires_at = null;
    }

    // Отправка в Supabase
    const { data, error } = await client
      .from('vacancies')
      .insert([formData]);

    if (error) {
      alert('Ошибка: ' + error.message);
      return;
    }
    alert('Вакансия успешно добавлена!');
    window.location.href = 'index.html';
  });

  // Кнопка "Назад" — если есть
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = 'index.html';
    });
  }
});
