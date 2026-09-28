const loginView = document.querySelector('#login-view');
const recoveryView = document.querySelector('#recovery-view');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

document.querySelector('#year').textContent = new Date().getFullYear();

// Cambiar entre login y recuperación
document.querySelectorAll('[data-view]').forEach(button =>
  button.addEventListener('click', () => {
    const recovery = button.dataset.view === 'recovery';
    loginView.hidden = recovery;
    recoveryView.hidden = !recovery;
    document.querySelector(recovery ? '#recovery-email' : '#email').focus();
  })
);

// Mostrar / ocultar contraseña
document.querySelector('.toggle').addEventListener('click', event => {
  const password = document.querySelector('#password');
  const hidden = password.type === 'password';
  password.type = hidden ? 'text' : 'password';
  event.currentTarget.textContent = hidden ? 'Ocultar' : 'Mostrar';
  event.currentTarget.setAttribute('aria-label', hidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  event.currentTarget.setAttribute('aria-pressed', String(hidden));
});

// Validaciones
function error(input, message) {
  document.querySelector(`#${input.id}-error`).textContent = message;
  input.classList.toggle('invalid', Boolean(message));
  return !message;
}

function emailValid(input) {
  const value = input.value.trim();
  return error(
    input,
    !value
      ? 'El correo electrónico es obligatorio.'
      : !emailPattern.test(value)
      ? 'Escribe un correo electrónico válido.'
      : ''
  );
}

// Login conectado al backend
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();

  const email = document.querySelector('#email');
  const password = document.querySelector('#password');
  const message = document.querySelector('#login-message');

  const validPassword = error(
    password,
    !password.value
      ? 'La contraseña es obligatoria.'
      : password.value.length < 8
      ? 'La contraseña debe tener al menos 8 caracteres.'
      : ''
  );

  message.className = 'message';
  message.textContent = '';

  if (!(emailValid(email) && validPassword)) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value })
    });
    const data = await res.json();

    if (data.ok) {
      message.className = 'message success';
      message.textContent = `Bienvenido, ${data.usuario.nombre}`;
      // Más adelante: window.location.href = 'dashboard.html';
    } else {
      message.textContent = data.mensaje;
    }
  } catch {
    message.textContent = 'No se pudo conectar con el servidor.';
  }
});

// Recuperación de contraseña (por ahora solo valida el correo)
document.querySelector('#recovery-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = document.querySelector('#recovery-email');
  const message = document.querySelector('#recovery-message');

  if (emailValid(email)) {
    message.className = 'message success';
    message.textContent = 'Si existe una cuenta asociada, recibirás las instrucciones en tu correo.';
  } else {
    message.className = 'message';
    message.textContent = '';
  }
});

// Quitar el estado de error al escribir
document.querySelectorAll('input[type=email],input[type=password]').forEach(input =>
  input.addEventListener('input', () => input.classList.remove('invalid'))
);