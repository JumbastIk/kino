const SUPABASE_URL = 'https://XXX.supabase.co';           // тот же url и key
const SUPABASE_KEY = 'your-anon-key';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

document.getElementById('add-vacancy-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(this).entries());

  // skills — массив!
  formData.skills = formData.skills ? formData.skills.split(',').map(s => s.trim()) : [];

  // is_remote — boolean
  formData.is_remote = !!formData.is_remote;

  // convert salary_min, salary_max к числу
  formData.salary_min = formData.salary_min ? Number(formData.salary_min) : null;
  formData.salary_max = formData.salary_max ? Number(formData.salary_max) : null;

  // даты
  if (formData.expires_at && formData.expires_at.length < 12) {
    formData.expires_at = formData.expires_at + 'T00:00:00.000Z';
  }

  const { data, error } = await supabase
    .from('vacancies')
    .insert([formData]);
  if (error) {
    alert('Ошибка: ' + error.message);
    return;
  }
  alert('Вакансия успешно добавлена!');
  window.location.href = 'index.html';
});
